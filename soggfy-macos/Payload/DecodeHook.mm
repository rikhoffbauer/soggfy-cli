#include <os/log.h>
#include "DecodeHook.h"
#include "Scanner.h"
#include "StateManager.h"
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

struct ogg_page_sys {
    unsigned char *header;
    long header_len;
    unsigned char *body;
    long body_len;
};

static int (*orig_ogg_stream_pagein)(void* os, ogg_page_sys* og) = nullptr;
uint32_t g_active_ogg_serial = 0;

extern std::mutex g_track_mutex;
extern std::string g_active_track_id;
extern std::atomic<bool> g_capture_gated;

// ARM64 DecodeAudioData (0x10127fe94 in Spotify ARM64)
// x0: this (Decoder)
// x1: float* sampleBuffer (PCM output)
// x2: size_t* sampleCount (in: capacity, out: samplesDecoded)
// x3: const char* encodedBuffer (Ogg packet stream)
// x4: size_t* encodedSize (in: input bytes, out: bytesRead)
// x5: int flags
typedef int (*DecodeAudioData_t)(void* x0, float* x1, size_t* x2, const char* x3, size_t* x4, int x5);
static DecodeAudioData_t orig_DecodeAudioData = nullptr;

std::atomic<bool> g_decoder_active{false};
std::atomic<bool> g_ogg_stream_active{false};

static int my_ogg_stream_pagein(void* os, ogg_page_sys* og) {
    if (!orig_ogg_stream_pagein || !og) return 0;

    unsigned char* hdr = og->header;
    long hlen = og->header_len;
    unsigned char* bdy = og->body;
    long blen = og->body_len;

    if (hdr != nullptr && hlen >= 27 && hdr[0] == 'O' && hdr[1] == 'g' && hdr[2] == 'g' && hdr[3] == 'S') {
        uint8_t flags = hdr[5];
        bool is_bos = (flags & 0x02) != 0;
        bool is_eos = (flags & 0x04) != 0;
        uint32_t serial = *(uint32_t*)(hdr + 14);

        std::string track_id;
        {
            std::lock_guard<std::mutex> lock(g_track_mutex);
            track_id = g_active_track_id;
        }

        // Check if this page is the beginning of a genuine Vorbis audio stream:
        // A genuine Vorbis stream BOS page has a body starting with \x01vorbis (identification header)
        bool is_vorbis_bos = is_bos && (bdy != nullptr) && (blen >= 7) &&
                             (bdy[0] == 0x01) && (memcmp(bdy + 1, "vorbis", 6) == 0);

        if (!track_id.empty() && track_id != "prototype_track") {
            if (is_vorbis_bos) {
                g_ogg_stream_active.store(true);
                g_active_ogg_serial = serial;
                g_capture_gated.store(false);
                printf("[Soggfy-OGG] Found Vorbis audio stream (BOS) for %s (serial 0x%x)\n", track_id.c_str(), serial);
                fflush(stdout);
            }

            // Only capture pages belonging to the active Vorbis audio stream
            if (g_ogg_stream_active.load() && serial == g_active_ogg_serial) {
                StateManager::Instance().ReceiveOggData(track_id, (const char*)hdr, (size_t)hlen);
                if (bdy != nullptr && blen > 0 && blen < 1048576) {
                    StateManager::Instance().ReceiveOggData(track_id, (const char*)bdy, (size_t)blen);
                }

                if (is_eos) {
                    uint64_t granule = *(uint64_t*)(hdr + 6);
                    double audio_sec = (double)granule / 44100.0;
                    printf("[Soggfy-OGG] Stream EOS reached for %s (serial 0x%x, %.1fs audio). Finalizing!\n",
                           track_id.c_str(), serial, audio_sec);
                    fflush(stdout);
                    g_ogg_stream_active.store(false);
                    StateManager::Instance().FinishPlayback(track_id);
                }
            }
        }
    }

    return orig_ogg_stream_pagein(os, og);
}

static int my_DecodeAudioData(void* x0, float* x1, size_t* x2, const char* x3, size_t* x4, int x5) {
    if (!orig_DecodeAudioData) return 0;

    size_t in_samples = (x2 != nullptr) ? *x2 : 0;
    size_t in_bytes = (x4 != nullptr) ? *x4 : 0;

    int ret = orig_DecodeAudioData(x0, x1, x2, x3, x4, x5);

    size_t samplesDecoded = (x2 != nullptr) ? *x2 : 0;
    size_t bytesRead = (x4 != nullptr) ? *x4 : 0;

    static int call_count = 0;
    if (++call_count <= 5 || call_count % 200 == 0) {
        printf("[Soggfy-DECODE] DecodeAudioData #%d: in_bytes=%zu bytesRead=%zu in_samples=%zu samplesDecoded=%zu\n",
               call_count, in_bytes, bytesRead, in_samples, samplesDecoded);
        fflush(stdout);
    }

    std::string track;
    {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        track = g_active_track_id;
    }

    if (!g_capture_gated.load() && !track.empty() && track != "prototype_track") {
        g_decoder_active.store(true);

        // Soggfy 12x fast-decoding speedup trick:
        // By reporting that only 1/playSpeed of the requested buffer was filled,
        // Spotify is tricked into decoding the next buffer chunk immediately without pausing!
        double playSpeed = 12.0;
        if (samplesDecoded > 0 && playSpeed > 1.0 && x2 != nullptr) {
            *x2 = std::max((size_t)1, (size_t)(samplesDecoded / playSpeed));
        }
    }

    return ret;
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
    printf("[Soggfy-DEBUG] Found Spotify image base = 0x%lx\n", base);
    fflush(stdout);

    uintptr_t decode_addr = base + 0x127fe94;
    if (decode_addr) {
        printf("[Soggfy-DEBUG] Fast-hooked DecodeAudioData at 0x%lx\n", decode_addr);
        fflush(stdout);
        DobbyHook((void*)decode_addr, (void*)my_DecodeAudioData, (void**)&orig_DecodeAudioData);
    }

    uintptr_t ogg_pagein_addr = base + 0x12b32c8;
    if (ogg_pagein_addr) {
        printf("[Soggfy-DEBUG] Fast-hooked ogg_stream_pagein at 0x%lx\n", ogg_pagein_addr);
        fflush(stdout);
        DobbyHook((void*)ogg_pagein_addr, (void*)my_ogg_stream_pagein, (void**)&orig_ogg_stream_pagein);
    }
}
