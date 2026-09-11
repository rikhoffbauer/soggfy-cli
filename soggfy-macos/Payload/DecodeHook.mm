#include <os/log.h>
#include "CapturePolicy.h"
#include "DecodeHook.h"
#include "OggPreRoll.h"
#include "Scanner.h"
#include "StateManager.h"
#include "SpotifyHookTargets.h"
#include <dobby.h>
#include <vector>
#import <Foundation/Foundation.h>
#include <algorithm>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <mutex>
#include <chrono>
#include <thread>
#include <atomic>
#include <cstring>

struct ogg_page_sys {
    unsigned char *header;
    long header_len;
    unsigned char *body;
    long body_len;
};

static int (*orig_ogg_stream_pagein)(void* os, ogg_page_sys* og) = nullptr;

extern std::mutex g_track_mutex;
extern std::string g_active_track_id;
extern std::atomic<bool> g_capture_gated;

// ARM64 DecodeAudioData; image-relative address is selected per validated Spotify build.
// x0: this (Decoder)
// x1: float* sampleBuffer (PCM output)
// x2: size_t* sampleCount (in: capacity, out: samplesDecoded)
// x3: const char* encodedBuffer (Ogg packet stream)
// x4: size_t* encodedSize (in: input bytes, out: bytesRead)
// x5: int flags
typedef int (*DecodeAudioData_t)(void* x0, float* x1, size_t* x2, const char* x3, size_t* x4, int x5);
static DecodeAudioData_t orig_DecodeAudioData = nullptr;

std::atomic<bool> g_decoder_hooks_ready{false};
static std::mutex g_ogg_preroll_mutex;
static OggPreRollBuffer g_ogg_preroll;
static OggStreamSelection g_ogg_stream_selection;

void ResetOggCaptureState(const std::string& trackId) {
    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
    g_ogg_preroll.Reset(trackId);
    g_ogg_stream_selection.Reset();
}

void DiscardPendingOggCapture() {
    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
    g_ogg_preroll.Discard();
}

static int my_ogg_stream_pagein(void* os, ogg_page_sys* og) {
    if (!orig_ogg_stream_pagein) return 0;

    int ret = orig_ogg_stream_pagein(os, og);
    if (ret != 1 || !og) return ret;

    unsigned char* hdr = og->header;
    long hlen = og->header_len;
    unsigned char* bdy = og->body;
    long blen = og->body_len;

    if (hdr != nullptr && hlen >= 27 && hdr[0] == 'O' && hdr[1] == 'g' && hdr[2] == 'g' && hdr[3] == 'S') {
        uint8_t flags = hdr[5];
        bool is_bos = (flags & 0x02) != 0;
        bool is_eos = (flags & 0x04) != 0;
        uint32_t serial = 0;
        memcpy(&serial, hdr + 14, sizeof(serial));

        // Helper-process polling is intentionally coarse. Refresh synchronously
        // at a stream boundary (and while gated) so the first BOS cannot race
        // ahead of a newly published set_track/capture-gate generation.
        if (is_bos || g_capture_gated.load()) SyncSharedCaptureStateNow();

        std::string track_id;
        {
            std::lock_guard<std::mutex> lock(g_track_mutex);
            track_id = g_active_track_id;
        }

        bool is_vorbis_bos = is_bos && (bdy != nullptr) && (blen >= 7) &&
                             (bdy[0] == 0x01) && (memcmp(bdy + 1, "vorbis", 6) == 0);

        if (!track_id.empty() && track_id != "prototype_track" &&
            CaptureBackendAllowsSource("ogg")) {
            auto &state = StateManager::Instance();
            const bool gated = g_capture_gated.load();

            if (gated) {
                bool buffered = false;
                {
                    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                    buffered = g_ogg_preroll.BufferPage(
                        track_id, serial, is_vorbis_bos,
                        hdr, (size_t)hlen,
                        bdy, (bdy != nullptr && blen > 0 && blen < 1048576) ? (size_t)blen : 0);
                }
                if (is_vorbis_bos && buffered) {
                    printf("[Soggfy-OGG] Buffered gated Vorbis BOS for %s (serial 0x%x)\n",
                           track_id.c_str(), serial);
                    fflush(stdout);
                }
                return ret;
            }

            OggStreamSnapshot selection;
            {
                std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                selection = g_ogg_stream_selection.Snapshot();
            }
            if (!selection.active) {
                std::optional<BufferedOggStream> pending;
                {
                    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                    pending = g_ogg_preroll.TakeForSerial(track_id, serial);
                    if (!pending && is_vorbis_bos) g_ogg_preroll.Discard();
                }

                if (pending && state.TryClaimWriter(track_id, "ogg")) {
                    {
                        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                        g_ogg_stream_selection.Activate(serial);
                        selection = g_ogg_stream_selection.Snapshot();
                    }
                    state.ReceiveOggData(
                        track_id,
                        reinterpret_cast<const char*>(pending->bytes.data()),
                        pending->bytes.size());
                    printf("[Soggfy-OGG] Promoted %zu pre-roll bytes for %s (serial 0x%x)\n",
                           pending->bytes.size(), track_id.c_str(), serial);
                    fflush(stdout);
                } else if (is_vorbis_bos && state.TryClaimWriter(track_id, "ogg")) {
                    {
                        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                        g_ogg_stream_selection.Activate(serial);
                        selection = g_ogg_stream_selection.Snapshot();
                    }
                    printf("[Soggfy-OGG] Claimed Vorbis stream for %s (serial 0x%x)\n",
                           track_id.c_str(), serial);
                    fflush(stdout);
                }
            }

            if (selection.active && serial == selection.serial &&
                state.OwnsWriter(track_id, "ogg")) {
                uint64_t eos_granule = 0;
                double eos_audio_sec = 0.0;
                if (is_eos) {
                    memcpy(&eos_granule, hdr + 6, sizeof(eos_granule));
                    eos_audio_sec = (double)eos_granule / 44100.0;
                    if (eos_audio_sec <= 5.0) {
                        state.RestartOggCapture(track_id);
                        {
                            std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                            g_ogg_stream_selection.Reset();
                        }
                        printf("[Soggfy-OGG] Discarded aborted stream for %s (serial 0x%x, %.1fs EOS); waiting for replacement BOS\n",
                               track_id.c_str(), serial, eos_audio_sec);
                        fflush(stdout);
                        return ret;
                    }
                }

                state.ReceiveOggData(track_id, (const char*)hdr, (size_t)hlen);
                if (bdy != nullptr && blen > 0 && blen < 1048576) {
                    state.ReceiveOggData(track_id, (const char*)bdy, (size_t)blen);
                }

                if (is_eos) {
                    printf("[Soggfy-OGG] Stream EOS reached for %s (serial 0x%x, %.1fs audio). Finalizing!\n",
                           track_id.c_str(), serial, eos_audio_sec);
                    fflush(stdout);
                    {
                        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                        g_ogg_stream_selection.Reset();
                    }
                    state.FinishPlayback(track_id);
                }
            }
        }
    }

    return ret;
}

static int my_DecodeAudioData(void* x0, float* x1, size_t* x2, const char* x3, size_t* x4, int x5) {
    if (!orig_DecodeAudioData) return 0;


    int ret = orig_DecodeAudioData(x0, x1, x2, x3, x4, x5);

    size_t samplesDecoded = (x2 != nullptr) ? *x2 : 0;

    std::string track;
    {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        track = g_active_track_id;
    }

    OggStreamSnapshot selection;
    {
        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
        selection = g_ogg_stream_selection.Snapshot();
    }
    if (CaptureBackendAllowsDecoderMutation() && !g_capture_gated.load() &&
        selection.active && !track.empty() && track != "prototype_track" &&
        StateManager::Instance().OwnsWriter(track, "ogg")) {
        // Accelerate only after the selected Ogg backend has claimed this track.
        constexpr double playSpeed = 12.0;
        if (samplesDecoded > 0 && x2 != nullptr) {
            *x2 = std::max((size_t)1, (size_t)(samplesDecoded / playSpeed));
        }
    }

    return ret;
}


static bool MatchesPrologue(uintptr_t address, const uint8_t* expected, size_t length) {
    if (!address || !expected || length == 0) return false;
    return memcmp(reinterpret_cast<const void*>(address), expected, length) == 0;
}

static bool InstallCheckedHook(
    const char* name,
    uintptr_t address,
    const uint8_t* expected,
    size_t expectedLength,
    void* replacement,
    void** original
) {
    if (!MatchesPrologue(address, expected, expectedLength)) {
        printf("[Soggfy-ERROR] Unsupported Spotify build: %s prologue mismatch at 0x%lx\n",
               name, address);
        fflush(stdout);
        return false;
    }
    const int result = DobbyHook(reinterpret_cast<void*>(address), replacement, original);
    if (result != 0 || !*original) {
        printf("[Soggfy-ERROR] Failed to hook %s at 0x%lx (result=%d)\n",
               name, address, result);
        fflush(stdout);
        *original = nullptr;
        return false;
    }
    printf("[Soggfy-INFO] Hooked %s at 0x%lx with validated prologue\n", name, address);
    fflush(stdout);
    return true;
}

void InstallDecoderHook() {
    static bool installed = false;
    if (installed) return;
    installed = true;

    uintptr_t base = Scanner::GetImageBaseAddress("Spotify");
    if (!base) {
        printf("[Soggfy-DEBUG] Spotify image not found, skipping decoder hook.\n");
        fflush(stdout);
        return;
    }
    NSString *bundleVersion = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    const char *version = bundleVersion.UTF8String;
    const SpotifyHookTargets *targets = SpotifyHookTargetsForVersion(version);
    if (!targets) {
        printf("[Soggfy-ERROR] Unsupported Spotify build: no native hook targets for %s\n",
               version ? version : "unknown");
        fflush(stdout);
        return;
    }

    printf("[Soggfy-DEBUG] Found Spotify image base = 0x%lx (version %s)\n",
           base, targets->version);
    fflush(stdout);

    // Prologues are validated again at runtime. Unknown builds fail closed above.
    static constexpr uint8_t decodePrologue[] = {
        0xff, 0xc3, 0x01, 0xd1, 0xfc, 0x6f, 0x01, 0xa9,
        0xfa, 0x67, 0x02, 0xa9, 0xf8, 0x5f, 0x03, 0xa9,
    };
    static constexpr uint8_t oggPageinPrologue[] = {
        0x08, 0x08, 0x40, 0xb9, 0x88, 0x02, 0xf8, 0x37,
        0xf4, 0x4f, 0xbe, 0xa9, 0xfd, 0x7b, 0x01, 0xa9,
    };

    const uintptr_t decodeAddr = base + targets->decodeAudioDataOffset;
    const uintptr_t oggPageinAddr = base + targets->oggStreamPageinOffset;
    const bool decodeOk = InstallCheckedHook(
        "DecodeAudioData", decodeAddr, decodePrologue, sizeof(decodePrologue),
        reinterpret_cast<void*>(my_DecodeAudioData),
        reinterpret_cast<void**>(&orig_DecodeAudioData));
    const bool oggOk = InstallCheckedHook(
        "ogg_stream_pagein", oggPageinAddr, oggPageinPrologue, sizeof(oggPageinPrologue),
        reinterpret_cast<void*>(my_ogg_stream_pagein),
        reinterpret_cast<void**>(&orig_ogg_stream_pagein));

    g_decoder_hooks_ready.store(decodeOk && oggOk);
    if (!decodeOk || !oggOk) {
        printf("[Soggfy-ERROR] Ogg backend disabled for this Spotify build.\n");
        orig_DecodeAudioData = nullptr;
        orig_ogg_stream_pagein = nullptr;
    }
}
