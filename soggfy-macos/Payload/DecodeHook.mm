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
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <chrono>
#include <thread>
#include <atomic>
#include <cstring>
#include <sstream>
#include <unordered_map>
#include <unistd.h>

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
static std::atomic<int> g_ogg_pagein_success_return{1};
static std::mutex g_ogg_preroll_mutex;
static OggPreRollBuffer g_ogg_preroll;
static OggStreamSelection g_ogg_stream_selection;
static std::atomic<uint64_t> g_last_gated_sync_ms{0};
static std::mutex g_gated_sync_mutex;

// Investigation-only attribution state. In Spotify 1.3.0.277 the two
// ogg_stream_pagein() call sites inside DecodeAudioData pass decoder + 0x88 as
// the ogg_stream_state pointer. We still verify that invariant at runtime and
// never use thread identity as the stream identity.
static thread_local void* g_investigation_current_decoder = nullptr;
static constexpr uintptr_t kSpotify130277OggStateOffset = 0x88;
static constexpr size_t kMaxInvestigationStreams = 16;
static constexpr uint64_t kInvestigationStreamStaleMs = 5 * 60 * 1000;
static std::atomic<bool> g_investigation_context_layout_valid{false};
static std::atomic<uint64_t> g_investigation_stream_generation{0};

static uint64_t InvestigationNowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

struct InvestigationOggKey {
    uintptr_t decoder = 0;
    uintptr_t os = 0;
    uint32_t serial = 0;

    bool operator==(const InvestigationOggKey& other) const {
        return decoder == other.decoder && os == other.os && serial == other.serial;
    }
};

struct InvestigationOggKeyHash {
    size_t operator()(const InvestigationOggKey& key) const {
        size_t h = std::hash<uintptr_t>{}(key.decoder);
        h ^= std::hash<uintptr_t>{}(key.os) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<uint32_t>{}(key.serial) + 0x9e3779b9 + (h << 6) + (h >> 2);
        return h;
    }
};

struct InvestigationOggFile {
    std::ofstream stream;
    std::string path;
    uint64_t bytes = 0;
    uint64_t pages = 0;
    uint64_t generation = 0;
    uint64_t startedAtMs = 0;
};

static std::mutex g_investigation_ogg_mutex;
static std::unordered_map<InvestigationOggKey, InvestigationOggFile, InvestigationOggKeyHash>
    g_investigation_ogg_files;

static bool InvestigationOggRequested() {
    static const bool requested = [] {
        const char* value = std::getenv("SOGGFY_INVESTIGATE_OGG_CONTEXT");
        return value && value[0] != '\0' && strcmp(value, "0") != 0;
    }();
    return requested;
}

static bool InvestigationOggEnabled() {
    return InvestigationOggRequested() && g_investigation_context_layout_valid.load();
}

static std::filesystem::path InvestigationBasePath() {
    const char* save = std::getenv("SOGGFY_SAVE_PATH");
    return std::filesystem::path(save && save[0] ? save : "/tmp/Soggfy_cli") /
        "investigation-ogg-context";
}

static void InvestigationAppendEvent(
    const char* event,
    const InvestigationOggKey& key,
    const InvestigationOggFile* file,
    bool relationOk
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"" << event << "\""
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"decoder\":\"0x" << std::hex << key.decoder << "\""
        << ",\"oggState\":\"0x" << std::hex << key.os << "\""
        << ",\"serial\":\"0x" << std::hex << key.serial << "\""
        << std::dec
        << ",\"decoderToOggOffset\":"
        << (key.os >= key.decoder ? key.os - key.decoder : 0)
        << ",\"relationOk\":" << (relationOk ? "true" : "false");
    if (file) {
        out << ",\"path\":\"" << file->path << "\""
            << ",\"generation\":" << file->generation
            << ",\"bytes\":" << file->bytes
            << ",\"pages\":" << file->pages;
    }
    out << "}\n";
}

static void InvestigationCaptureOggPage(
    void* decoder,
    void* os,
    uint32_t serial,
    bool isVorbisBos,
    bool isEos,
    const unsigned char* hdr,
    size_t hlen,
    const unsigned char* body,
    size_t blen
) {
    if (!InvestigationOggEnabled() || !decoder || !os || !hdr || hlen == 0) return;

    const uintptr_t decoderPtr = reinterpret_cast<uintptr_t>(decoder);
    const uintptr_t osPtr = reinterpret_cast<uintptr_t>(os);
    const bool relationOk = osPtr == decoderPtr + kSpotify130277OggStateOffset;
    InvestigationOggKey key{decoderPtr, osPtr, serial};

    std::lock_guard<std::mutex> lock(g_investigation_ogg_mutex);
    auto it = g_investigation_ogg_files.find(key);
    if (isVorbisBos) {
        const uint64_t now = InvestigationNowMs();
        for (auto stale = g_investigation_ogg_files.begin(); stale != g_investigation_ogg_files.end();) {
            if (now - stale->second.startedAtMs < kInvestigationStreamStaleMs) {
                ++stale;
                continue;
            }
            stale->second.stream.flush();
            stale->second.stream.close();
            InvestigationAppendEvent("stale", stale->first, &stale->second,
                stale->first.os == stale->first.decoder + kSpotify130277OggStateOffset);
            stale = g_investigation_ogg_files.erase(stale);
        }

        it = g_investigation_ogg_files.find(key);
        if (it != g_investigation_ogg_files.end()) {
            it->second.stream.flush();
            it->second.stream.close();
            InvestigationAppendEvent("replaced", key, &it->second, relationOk);
            g_investigation_ogg_files.erase(it);
        }

        if (g_investigation_ogg_files.size() >= kMaxInvestigationStreams) {
            auto oldest = std::min_element(
                g_investigation_ogg_files.begin(),
                g_investigation_ogg_files.end(),
                [](const auto& a, const auto& b) {
                    return a.second.startedAtMs < b.second.startedAtMs;
                });
            if (oldest != g_investigation_ogg_files.end()) {
                oldest->second.stream.flush();
                oldest->second.stream.close();
                InvestigationAppendEvent("evicted", oldest->first, &oldest->second,
                    oldest->first.os == oldest->first.decoder + kSpotify130277OggStateOffset);
                g_investigation_ogg_files.erase(oldest);
            }
        }

        const auto base = InvestigationBasePath();
        std::error_code ec;
        std::filesystem::create_directories(base / "streams", ec);

        const uint64_t generation = g_investigation_stream_generation.fetch_add(1) + 1;
        std::ostringstream name;
        name << "pid-" << getpid()
             << "-decoder-" << std::hex << decoderPtr
             << "-os-" << osPtr
             << "-serial-" << serial << std::dec
             << "-generation-" << generation << ".ogg";
        InvestigationOggFile capture;
        capture.path = (base / "streams" / name.str()).string();
        capture.generation = generation;
        capture.startedAtMs = now;
        capture.stream.open(capture.path, std::ios::binary | std::ios::trunc);
        if (capture.stream.is_open()) {
            auto [inserted, _] = g_investigation_ogg_files.insert_or_assign(
                key, std::move(capture));
            it = inserted;
            InvestigationAppendEvent("bos", key, &it->second, relationOk);
        }
    }

    if (it == g_investigation_ogg_files.end() || !it->second.stream.is_open()) return;
    it->second.stream.write(reinterpret_cast<const char*>(hdr), static_cast<std::streamsize>(hlen));
    if (body && blen > 0) {
        it->second.stream.write(reinterpret_cast<const char*>(body), static_cast<std::streamsize>(blen));
    }
    it->second.bytes += hlen + blen;
    it->second.pages += 1;

    if (!it->second.stream.good()) {
        it->second.stream.close();
        InvestigationAppendEvent("write_error", key, &it->second, relationOk);
        g_investigation_ogg_files.erase(it);
        return;
    }

    if (isEos) {
        it->second.stream.flush();
        it->second.stream.close();
        InvestigationAppendEvent("eos", key, &it->second, relationOk);
        g_investigation_ogg_files.erase(it);
    }
}

static uint64_t SteadyNowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

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
    if (ret != g_ogg_pagein_success_return.load() || !og || !g_decoder_hooks_ready.load()) return ret;

    unsigned char* hdr = og->header;
    long hlen = og->header_len;
    unsigned char* bdy = og->body;
    long blen = og->body_len;
    if (blen < 0 || blen >= 1048576 || (blen > 0 && bdy == nullptr)) return ret;

    if (hdr != nullptr && hlen >= 27 && hdr[0] == 'O' && hdr[1] == 'g' && hdr[2] == 'g' && hdr[3] == 'S') {
        uint8_t flags = hdr[5];
        bool is_bos = (flags & 0x02) != 0;
        bool is_eos = (flags & 0x04) != 0;
        uint32_t serial = 0;
        memcpy(&serial, hdr + 14, sizeof(serial));

        // Helper-process polling is intentionally coarse. Always refresh at a
        // stream boundary, but rate-limit gated page refreshes to avoid doing
        // filesystem synchronization on every Ogg page.
        if (is_bos) {
            SyncSharedCaptureStateNow();
        } else {
            const uint64_t now = SteadyNowMs();
            const uint64_t previous = g_last_gated_sync_ms.load();
            if (now - previous >= 200) {
                std::lock_guard<std::mutex> sync_lock(g_gated_sync_mutex);
                const uint64_t refreshed_now = SteadyNowMs();
                if (refreshed_now - g_last_gated_sync_ms.load() >= 200) {
                    SyncSharedCaptureStateNow();
                    g_last_gated_sync_ms.store(refreshed_now);
                }
            }
        }

        std::string track_id;
        {
            std::lock_guard<std::mutex> lock(g_track_mutex);
            track_id = g_active_track_id;
        }

        bool is_vorbis_bos = is_bos && (bdy != nullptr) && (blen >= 7) &&
                             (bdy[0] == 0x01) && (memcmp(bdy + 1, "vorbis", 6) == 0);

        InvestigationCaptureOggPage(
            g_investigation_current_decoder,
            os,
            serial,
            is_vorbis_bos,
            is_eos,
            hdr,
            static_cast<size_t>(hlen),
            bdy,
            static_cast<size_t>(blen));

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
                        bdy, (size_t)blen);
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
                    MarkAudioActivity();
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
                MarkAudioActivity();
                state.ReceiveOggData(track_id, (const char*)bdy, (size_t)blen);
                MarkAudioActivity();

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

    void* previousInvestigationDecoder = g_investigation_current_decoder;
    if (InvestigationOggEnabled()) g_investigation_current_decoder = x0;
    int ret = orig_DecodeAudioData(x0, x1, x2, x3, x4, x5);
    if (InvestigationOggEnabled()) g_investigation_current_decoder = previousInvestigationDecoder;
    if (!g_decoder_hooks_ready.load()) return ret;

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
    if (InvestigationOggRequested()) {
        const bool exactInvestigationBuild = version && strcmp(version, "1.3.0.277") == 0;
        g_investigation_context_layout_valid.store(exactInvestigationBuild);
        if (!exactInvestigationBuild) {
            printf("[Soggfy-WARN] Ogg context investigation disabled: decoder+0x88 is only validated for Spotify 1.3.0.277.\n");
            fflush(stdout);
        }
    }
    SpotifyHookTargets compatibilityTargets{};
    const SpotifyHookTargets *targets = SpotifyHookTargetsForVersion(version);
    if (!targets && SpotifyHookTargetsForCompatibilityEnvironment(version, &compatibilityTargets)) {
        targets = &compatibilityTargets;
        printf("[Soggfy-WARN] Using compatibility-only discovered hook targets for %s\n", version);
        fflush(stdout);
    }
    if (!targets) {
        printf("[Soggfy-ERROR] Unsupported Spotify build: no native hook targets for %s\n",
               version ? version : "unknown");
        fflush(stdout);
        return;
    }

    printf("[Soggfy-DEBUG] Found Spotify image base = 0x%lx (version %s)\n",
           base, targets->version);
    const SpotifyHookFamilyConfig familyConfig =
        SpotifyHookFamilyConfigForFamily(targets->family);
    g_ogg_pagein_success_return.store(familyConfig.oggPageinSuccessReturn);
    printf("[Soggfy-DEBUG] Hook family %u uses ogg_stream_pagein success return %d\n",
           static_cast<unsigned>(targets->family), familyConfig.oggPageinSuccessReturn);

    fflush(stdout);

    switch (targets->family) {
        case SpotifyHookFamily::OggV1: {
            // OggV1 is the existing capture implementation shared by all builds
            // whose ABI and hook prologues have been validated end to end.
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
            }
            return;
        }
        case SpotifyHookFamily::Unsupported:
            break;
    }

    printf("[Soggfy-ERROR] Unsupported Spotify hook family for %s\n",
           version ? version : "unknown");
    fflush(stdout);
}
