#include "CapturePolicy.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>

static std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

CaptureBackend ParseCaptureBackend(const std::string& rawValue) {
    const std::string value = Lower(rawValue);
    if (value.empty() || value == "ogg") return CaptureBackend::Ogg;
    if (value == "disabled") return CaptureBackend::Disabled;
    return CaptureBackend::Invalid;
}

CaptureBackend SelectedCaptureBackend() {
    const char* raw = std::getenv("SOGGFY_CAPTURE_BACKEND");
    return ParseCaptureBackend(raw ? raw : "ogg");
}

const char* CaptureBackendName(CaptureBackend backend) {
    switch (backend) {
    case CaptureBackend::Disabled: return "disabled";
    case CaptureBackend::Ogg: return "ogg";
    case CaptureBackend::Invalid: return "invalid";
    }
    return "invalid";
}

bool CaptureBackendAllowsSource(CaptureBackend backend, const std::string& source) {
    return backend == CaptureBackend::Ogg && source == "ogg";
}

bool CaptureBackendAllowsSource(const std::string& source) {
    return CaptureBackendAllowsSource(SelectedCaptureBackend(), source);
}

bool CaptureBackendAllowsDecoderMutation() {
    return SelectedCaptureBackend() == CaptureBackend::Ogg;
}
