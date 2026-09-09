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
        uint64_t limitBytes = 0; // 0 means no limit

        std::string oggFileName;
        std::ofstream oggFileStream;
        bool oggInitialized = false;
        uint64_t oggBytesWritten = 0;

        Playback(const std::string& playbackId);
        ~Playback();
    };

    static StateManager& Instance();

    void ReceiveAudioData(const std::string& playbackId, const char* data, size_t length);
    void ReceiveOggData(const std::string& playbackId, const char* data, size_t length);
    void RestartOggCapture(const std::string& playbackId);
    void FinishPlayback(const std::string& playbackId);
    void SetBaseSavePath(const std::string& path);
    std::string GetPlaybackStatus(const std::string& playbackId);
    uint64_t GetPlaybackBytes(const std::string& playbackId);
    uint64_t GetPlaybackLimitBytes(const std::string& playbackId);
    std::string GetPlaybackFileName(const std::string& playbackId);
    void ResetPlayback(const std::string& playbackId);
    void CancelPlayback(const std::string& playbackId);
    void SetPlaybackDuration(const std::string& playbackId, uint32_t durationMs);
    bool TryClaimWriter(const std::string& playbackId, const std::string& source);
    bool OwnsWriter(const std::string& playbackId, const std::string& source = "") const;
    void ResetLocalPlayback(const std::string& playbackId);
    void PublishDuration(const std::string& playbackId, uint32_t durationMs);
    void PublishFinish(const std::string& playbackId);
    void PublishCancel(const std::string& playbackId);
    void ApplySharedControls(const std::string& playbackId);

private:
    StateManager();
    ~StateManager();

    Playback* GetPlayback(const std::string& playbackId);
    void WriteWavHeader(std::ofstream& stream, uint64_t dataSize, uint32_t sampleRate, uint16_t channels);
    std::string SharedPath(const std::string& playbackId, const char* suffix) const;
    void PersistStatus(const std::string& playbackId, const std::string& status) const;
    std::string ReadSharedStatus(const std::string& playbackId) const;
    void ClearSharedFiles(const std::string& playbackId);

    std::string _baseSavePath;
    mutable std::mutex _mutex;
    std::unordered_map<std::string, Playback*> _playbacks;
    std::string _ownedTrack;
    std::string _ownedSource;
    int _ownerPid = 0;
};
