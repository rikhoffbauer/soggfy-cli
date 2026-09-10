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
void ResetOggCaptureState(const std::string& trackId);
void DiscardPendingOggCapture();
void SyncSharedCaptureStateNow();
extern std::atomic<bool> g_decoder_hooks_ready;
