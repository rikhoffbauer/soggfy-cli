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
extern std::atomic<bool> g_ogg_stream_active;
extern std::atomic<bool> g_decoder_hooks_ready;
extern uint32_t g_active_ogg_serial;
