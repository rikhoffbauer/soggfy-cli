#include "StateManager.h"
#include "CapturePolicy.h"

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <sys/wait.h>
#include <unistd.h>

namespace fs = std::filesystem;

static uint32_t read_u32(std::ifstream& in) {
    uint32_t value = 0;
    in.read(reinterpret_cast<char*>(&value), sizeof(value));
    return value;
}

static bool expect_tag(std::ifstream& in, const char* tag) {
    char buf[4] = {0};
    in.read(buf, 4);
    return std::string(buf, 4) == std::string(tag, 4);
}

int main() {
    const fs::path base = fs::temp_directory_path() / "soggfy-state-manager-fixture";
    fs::remove_all(base);
    fs::create_directories(base);
    setenv("SOGGFY_SAVE_PATH", base.string().c_str(), 1);

    const std::string trackId = "fixture-track_01";
    constexpr uint32_t sampleRate = 44100;
    constexpr uint32_t channels = 2;
    constexpr double seconds = 1.0;
    constexpr uint32_t frames = static_cast<uint32_t>(sampleRate * seconds);
    std::vector<float> pcm(frames * channels);
    for (uint32_t i = 0; i < frames; ++i) {
        float sample = static_cast<float>(std::sin((2.0 * M_PI * 440.0 * i) / sampleRate) * 0.25);
        pcm[i * 2] = sample;
        pcm[i * 2 + 1] = sample;
    }

    auto& manager = StateManager::Instance();
    manager.SetBaseSavePath(base.string());

    setenv("SOGGFY_CAPTURE_BACKEND", "disabled", 1);
    if (CaptureBackendAllowsSource("avasset") || CaptureBackendAllowsSource("ogg") ||
        CaptureBackendAllowsDecoderMutation()) return 10;

    setenv("SOGGFY_CAPTURE_BACKEND", "pcm", 1);
    if (SelectedCaptureBackend() != CaptureBackend::Invalid ||
        CaptureBackendAllowsSource("avasset") || CaptureBackendAllowsDecoderMutation()) return 11;

    setenv("SOGGFY_CAPTURE_BACKEND", "ogg", 1);
    if (!CaptureBackendAllowsSource("ogg") || CaptureBackendAllowsSource("avasset") ||
        !CaptureBackendAllowsDecoderMutation()) return 12;

    const std::string ownerTrack = "owner-track";
    manager.ResetPlayback(ownerTrack);
    if (!manager.TryClaimWriter(ownerTrack, "ogg")) return 13;
    if (manager.TryClaimWriter(ownerTrack, "avasset")) return 14;
    const pid_t child = fork();
    if (child == 0) _exit(manager.TryClaimWriter(ownerTrack, "ogg") ? 1 : 0);
    int childStatus = 0;
    if (child < 0 || waitpid(child, &childStatus, 0) != child || !WIFEXITED(childStatus) ||
        WEXITSTATUS(childStatus) != 0) return 15;
    manager.ResetPlayback(ownerTrack);

    const std::string restartedOggTrack = "restarted-ogg-track";
    manager.ResetPlayback(restartedOggTrack);
    if (!manager.TryClaimWriter(restartedOggTrack, "ogg")) return 16;
    manager.ReceiveOggData(restartedOggTrack, "aborted-prefix", 14);
    manager.RestartOggCapture(restartedOggTrack);
    if (!manager.OwnsWriter(restartedOggTrack, "ogg")) return 18;
    manager.ReceiveOggData(restartedOggTrack, "replacement-stream", 18);
    manager.FinishPlayback(restartedOggTrack);
    const fs::path restartedOgg = base / (restartedOggTrack + ".ogg");
    std::ifstream restartedIn(restartedOgg, std::ios::binary);
    const std::string restartedContents(
        (std::istreambuf_iterator<char>(restartedIn)),
        std::istreambuf_iterator<char>()
    );
    if (restartedContents != "replacement-stream") return 17;
    manager.ResetPlayback(restartedOggTrack);

    manager.SetPlaybackDuration(trackId, 1000);
    manager.ReceiveAudioData(trackId, reinterpret_cast<const char*>(pcm.data()), pcm.size() * sizeof(float));
    manager.FinishPlayback(trackId);

    const fs::path wav = base / (trackId + ".wav");
    if (!fs::exists(wav)) {
        std::cerr << "missing WAV: " << wav << "\n";
        return 1;
    }
    if (fs::file_size(wav) != 44 + pcm.size() * sizeof(float)) {
        std::cerr << "unexpected file size: " << fs::file_size(wav) << "\n";
        return 1;
    }

    std::ifstream in(wav, std::ios::binary);
    if (!expect_tag(in, "RIFF")) return 2;
    (void)read_u32(in);
    if (!expect_tag(in, "WAVE")) return 3;
    if (!expect_tag(in, "fmt ")) return 4;
    in.seekg(36);
    if (!expect_tag(in, "data")) return 5;
    const uint32_t dataBytes = read_u32(in);
    if (dataBytes != pcm.size() * sizeof(float)) {
        std::cerr << "unexpected data bytes: " << dataBytes << "\n";
        return 6;
    }

    std::cout << wav << "\n";
    return 0;
}
