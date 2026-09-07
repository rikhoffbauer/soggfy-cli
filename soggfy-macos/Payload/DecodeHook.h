#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string>

struct Buffer {
    uint8_t* data;
    size_t size;
};

#include <atomic>

void InstallDecoderHook();
bool CaptureAudioBuffer(const char *source, const std::string &trackId, const char *data, size_t length);
extern std::atomic<bool> g_decoder_active;
extern std::atomic<bool> g_ogg_stream_active;
extern uint32_t g_active_ogg_serial;
