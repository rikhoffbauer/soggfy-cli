#pragma once
#include <string>
#include <vector>
#include <fstream>
#include <mutex>
#include <unordered_map>
#include <cstdint>

class StateManager {
public:
    struct Playback {
        std::string id;
        std::string fileName;
        std::ofstream fileStream;
        bool discard = false;
        bool initialized = false;
        uint64_t totalBytesWritten = 0;
        uint32_t sampleRate = 44100;
        uint16_t channels = 2;
        uint32_t durationMs = 0;
        bool isRawOgg = false;
        uint64_t limitBytes = 0; // 0 means no limit
        bool active = false;

        std::string oggFileName;
        std::ofstream oggFileStream;
        bool oggInitialized = false;
        uint64_t oggBytesWritten = 0;

        Playback(const std::string& playbackId);
        ~Playback();
    };

    static StateManager& Instance();

    void MarkPlaybackActive(const std::string& playbackId);
    void ReceiveAudioData(const std::string& playbackId, const char* data, size_t length);
    void ReceiveOggData(const std::string& playbackId, const char* data, size_t length);
    void FinishPlayback(const std::string& playbackId);
    void SetBaseSavePath(const std::string& path);
    std::string GetPlaybackStatus(const std::string& playbackId);
    uint64_t GetPlaybackBytes(const std::string& playbackId);
    uint64_t GetPlaybackLimitBytes(const std::string& playbackId);
    std::string GetPlaybackFileName(const std::string& playbackId);
    void ResetPlayback(const std::string& playbackId);
    void CancelPlayback(const std::string& playbackId);
    void SetPlaybackDuration(const std::string& playbackId, uint32_t durationMs);

private:
    StateManager();
    ~StateManager();

    Playback* GetPlayback(const std::string& playbackId);
    void WriteWavHeader(std::ofstream& stream, uint64_t dataSize, uint32_t sampleRate, uint16_t channels);

    std::string _baseSavePath;
    std::mutex _mutex;
    std::unordered_map<std::string, Playback*> _playbacks;
};
