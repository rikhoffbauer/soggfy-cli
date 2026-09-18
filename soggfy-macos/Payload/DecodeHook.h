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
void MarkAudioActivity();
bool SetCaptureDecodeSpeed(double speed);
double GetCaptureDecodeSpeed();
extern std::atomic<bool> g_decoder_hooks_ready;
