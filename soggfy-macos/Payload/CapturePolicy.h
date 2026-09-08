#pragma once

#include <string>

enum class CaptureBackend {
    Disabled,
    Ogg,
    Invalid,
};

CaptureBackend ParseCaptureBackend(const std::string& value);
CaptureBackend SelectedCaptureBackend();
const char* CaptureBackendName(CaptureBackend backend);
bool CaptureBackendAllowsSource(CaptureBackend backend, const std::string& source);
bool CaptureBackendAllowsSource(const std::string& source);
bool CaptureBackendAllowsDecoderMutation();
