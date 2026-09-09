#include "StateManager.h"
#include "CapturePolicy.h"

#include <cctype>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <system_error>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace fs = std::filesystem;

static std::string SanitizePlaybackIdForPath(const std::string& playbackId) {
    std::string safe;
    safe.reserve(playbackId.size());
    for (unsigned char ch : playbackId) {
        if (std::isalnum(ch) || ch == '_' || ch == '-') safe.push_back(static_cast<char>(ch));
    }
    return safe.empty() ? "track" : safe;
}

static void WritePrivateTextFile(const fs::path& path, const std::string& value) {
    int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return;
    const char* data = value.data();
    size_t remaining = value.size();
    while (remaining > 0) {
        const ssize_t written = write(fd, data, remaining);
        if (written <= 0) break;
        data += written;
        remaining -= static_cast<size_t>(written);
    }
    close(fd);
}

StateManager::Playback::Playback(const std::string& playbackId) : id(playbackId) {}

StateManager::Playback::~Playback() {
    if (fileStream.is_open()) fileStream.close();
    if (oggFileStream.is_open()) oggFileStream.close();
}

StateManager& StateManager::Instance() {
    static StateManager instance;
    return instance;
}

StateManager::StateManager() {
    const char* envSavePath = std::getenv("SOGGFY_SAVE_PATH");
    _baseSavePath = envSavePath ? envSavePath : "/tmp/Soggfy_cli";
    try {
        fs::create_directories(_baseSavePath);
        std::error_code ec;
        fs::permissions(_baseSavePath, fs::perms::owner_all, fs::perm_options::replace, ec);
        printf("[Soggfy-INFO] StateManager initialized. Base save path: %s\n", _baseSavePath.c_str());
    } catch (const std::exception& e) {
        printf("[Soggfy-ERROR] Failed to initialize save path: %s\n", e.what());
    }
}

StateManager::~StateManager() {
    std::lock_guard<std::mutex> lock(_mutex);
    for (auto& pair : _playbacks) delete pair.second;
}

void StateManager::SetBaseSavePath(const std::string& path) {
    std::lock_guard<std::mutex> lock(_mutex);
    _baseSavePath = path;
    fs::create_directories(_baseSavePath);
    std::error_code ec;
    fs::permissions(_baseSavePath, fs::perms::owner_all, fs::perm_options::replace, ec);
}

StateManager::Playback* StateManager::GetPlayback(const std::string& playbackId) {
    auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) {
        it = _playbacks.emplace(playbackId, new Playback(playbackId)).first;
    }
    if (it->second->discard) it->second->discard = false;
    return it->second;
}

std::string StateManager::SharedPath(const std::string& playbackId, const char* suffix) const {
    return (fs::path(_baseSavePath) / (SanitizePlaybackIdForPath(playbackId) + suffix)).string();
}

void StateManager::PersistStatus(const std::string& playbackId, const std::string& status) const {
    WritePrivateTextFile(SharedPath(playbackId, ".status"), status);
}

std::string StateManager::ReadSharedStatus(const std::string& playbackId) const {
    std::ifstream in(SharedPath(playbackId, ".status"));
    std::string status;
    if (in) std::getline(in, status);
    return status;
}

void StateManager::ClearSharedFiles(const std::string& playbackId) {
    std::error_code ec;
    for (const char* suffix : {".status", ".duration", ".finish", ".cancel"}) {
        fs::remove(SharedPath(playbackId, suffix), ec);
        ec.clear();
    }
    fs::remove(fs::path(_baseSavePath) / ".capture-owner", ec);
}

bool StateManager::TryClaimWriter(const std::string& playbackId, const std::string& source) {
    if (!CaptureBackendAllowsSource(source)) return false;

    std::lock_guard<std::mutex> lock(_mutex);
    const int pid = static_cast<int>(getpid());
    if (_ownerPid == pid && _ownedTrack == playbackId && _ownedSource == source) return true;

    const fs::path ownerPath = fs::path(_baseSavePath) / ".capture-owner";
    int fd = open(ownerPath.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd >= 0) {
        const std::string payload = std::to_string(pid) + " " + playbackId + " " + source + "\n";
        (void)write(fd, payload.data(), payload.size());
        close(fd);
        _ownerPid = pid;
        _ownedTrack = playbackId;
        _ownedSource = source;
        printf("[Soggfy-INFO] PID %d claimed capture for %s via %s\n",
               pid, playbackId.c_str(), source.c_str());
        return true;
    }

    std::ifstream in(ownerPath);
    int ownerPid = 0;
    std::string ownerTrack;
    std::string ownerSource;
    in >> ownerPid >> ownerTrack >> ownerSource;
    if (ownerPid == pid && ownerTrack == playbackId && ownerSource == source) {
        _ownerPid = pid;
        _ownedTrack = playbackId;
        _ownedSource = source;
        return true;
    }
    return false;
}

bool StateManager::OwnsWriter(const std::string& playbackId, const std::string& source) const {
    std::lock_guard<std::mutex> lock(_mutex);
    const int pid = static_cast<int>(getpid());
    return _ownerPid == pid && _ownedTrack == playbackId &&
           (source.empty() || _ownedSource == source);
}

void StateManager::WriteWavHeader(
    std::ofstream& stream,
    uint64_t dataSize,
    uint32_t sampleRate,
    uint16_t channels
) {
    const uint32_t wavDataSize = dataSize > std::numeric_limits<uint32_t>::max()
        ? std::numeric_limits<uint32_t>::max()
        : static_cast<uint32_t>(dataSize);
    const uint16_t bitsPerSample = 32;
    const uint16_t blockAlign = channels * (bitsPerSample / 8);
    const uint32_t byteRate = sampleRate * blockAlign;
    const uint32_t chunkSize = 36 + wavDataSize;
    const uint32_t subchunk1Size = 16;
    const uint16_t audioFormat = 3;

    stream.write("RIFF", 4);
    stream.write(reinterpret_cast<const char*>(&chunkSize), 4);
    stream.write("WAVEfmt ", 8);
    stream.write(reinterpret_cast<const char*>(&subchunk1Size), 4);
    stream.write(reinterpret_cast<const char*>(&audioFormat), 2);
    stream.write(reinterpret_cast<const char*>(&channels), 2);
    stream.write(reinterpret_cast<const char*>(&sampleRate), 4);
    stream.write(reinterpret_cast<const char*>(&byteRate), 4);
    stream.write(reinterpret_cast<const char*>(&blockAlign), 2);
    stream.write(reinterpret_cast<const char*>(&bitsPerSample), 2);
    stream.write("data", 4);
    stream.write(reinterpret_cast<const char*>(&wavDataSize), 4);
}

void StateManager::ReceiveAudioData(
    const std::string& playbackId,
    const char* data,
    size_t length
) {
    if (!data || length == 0) return;
    std::lock_guard<std::mutex> lock(_mutex);
    auto* playback = GetPlayback(playbackId);
    if (!playback || playback->discard) return;

    if (!playback->initialized) {
        playback->fileName = (fs::path(_baseSavePath) /
            (SanitizePlaybackIdForPath(playbackId) + ".wav")).string();
        playback->fileStream.open(playback->fileName, std::ios::binary | std::ios::trunc);
        if (!playback->fileStream.is_open()) {
            printf("[Soggfy-ERROR] Failed to open file: %s\n", playback->fileName.c_str());
            return;
        }
        playback->initialized = true;
        WriteWavHeader(playback->fileStream, 0, playback->sampleRate, playback->channels);
        PersistStatus(playbackId, "downloading");
        printf("[Soggfy-INFO] Started PCM WAV: %s\n", playback->fileName.c_str());
    }

    playback->fileStream.write(data, length);
    playback->totalBytesWritten += length;
    if (playback->limitBytes > 0 && playback->totalBytesWritten >= playback->limitBytes) {
        playback->fileStream.flush();
        playback->fileStream.seekp(0, std::ios::beg);
        WriteWavHeader(
            playback->fileStream,
            playback->totalBytesWritten,
            playback->sampleRate,
            playback->channels
        );
        playback->fileStream.close();
        playback->discard = true;
        PersistStatus(playbackId, "completed");
        printf("[Soggfy-INFO] Reached PCM byte limit for %s: %llu/%llu\n",
               playbackId.c_str(),
               static_cast<unsigned long long>(playback->totalBytesWritten),
               static_cast<unsigned long long>(playback->limitBytes));
    }
}

void StateManager::ReceiveOggData(
    const std::string& playbackId,
    const char* data,
    size_t length
) {
    if (!data || length == 0) return;
    std::lock_guard<std::mutex> lock(_mutex);
    auto* playback = GetPlayback(playbackId);
    if (!playback || playback->discard) return;

    if (!playback->oggInitialized) {
        playback->oggFileName = (fs::path(_baseSavePath) /
            (SanitizePlaybackIdForPath(playbackId) + ".ogg")).string();
        playback->oggFileStream.open(playback->oggFileName, std::ios::binary | std::ios::trunc);
        if (!playback->oggFileStream.is_open()) {
            printf("[Soggfy-ERROR] Failed to open Ogg file: %s\n", playback->oggFileName.c_str());
            return;
        }
        playback->oggInitialized = true;
        PersistStatus(playbackId, "downloading");
        printf("[Soggfy-INFO] Started raw Ogg stream: %s\n", playback->oggFileName.c_str());
    }

    playback->oggFileStream.write(data, length);
    playback->oggBytesWritten += length;
}

void StateManager::RestartOggCapture(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) return;
    auto* playback = it->second;

    if (playback->oggFileStream.is_open()) {
        playback->oggFileStream.close();
    }
    if (!playback->oggFileName.empty()) {
        std::error_code ec;
        fs::remove(playback->oggFileName, ec);
    }
    playback->oggInitialized = false;
    playback->oggBytesWritten = 0;
    playback->discard = false;
}

void StateManager::FinishPlayback(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end() || it->second->discard) return;
    auto* playback = it->second;

    if (playback->fileStream.is_open()) {
        playback->fileStream.flush();
        playback->fileStream.seekp(0, std::ios::beg);
        WriteWavHeader(
            playback->fileStream,
            playback->totalBytesWritten,
            playback->sampleRate,
            playback->channels
        );
        playback->fileStream.close();
    }
    if (playback->oggFileStream.is_open()) {
        playback->oggFileStream.flush();
        playback->oggFileStream.close();
    }

    playback->discard = true;
    PersistStatus(playbackId, "completed");
    printf("[Soggfy-INFO] Finalized capture for %s\n", playbackId.c_str());
}

std::string StateManager::GetPlaybackStatus(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const std::string shared = ReadSharedStatus(playbackId);
    if (!shared.empty()) return shared;

    const auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) return "idle";
    if (it->second->discard) return "completed";
    if (it->second->initialized || it->second->oggInitialized) return "downloading";
    return "idle";
}

uint64_t StateManager::GetPlaybackBytes(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _playbacks.find(playbackId);
    if (it != _playbacks.end()) {
        if (it->second->oggBytesWritten > 0) return it->second->oggBytesWritten;
        if (it->second->totalBytesWritten > 0) return it->second->totalBytesWritten;
    }

    std::error_code ec;
    const fs::path ogg = SharedPath(playbackId, ".ogg");
    if (fs::exists(ogg, ec)) return fs::file_size(ogg, ec);
    const fs::path wav = SharedPath(playbackId, ".wav");
    if (fs::exists(wav, ec)) {
        const auto size = fs::file_size(wav, ec);
        return size > 44 ? size - 44 : 0;
    }
    return 0;
}

uint64_t StateManager::GetPlaybackLimitBytes(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _playbacks.find(playbackId);
    if (it != _playbacks.end()) return it->second->limitBytes;

    std::ifstream durationFile(SharedPath(playbackId, ".duration"));
    uint64_t durationMs = 0;
    durationFile >> durationMs;
    return durationMs > 0 ? durationMs * 44100ULL * 2ULL * sizeof(float) / 1000ULL : 0;
}

std::string StateManager::GetPlaybackFileName(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _playbacks.find(playbackId);
    if (it != _playbacks.end()) {
        if (!it->second->oggFileName.empty()) return it->second->oggFileName;
        if (!it->second->fileName.empty()) return it->second->fileName;
    }

    const fs::path ogg = SharedPath(playbackId, ".ogg");
    if (fs::exists(ogg)) return ogg.string();
    const fs::path wav = SharedPath(playbackId, ".wav");
    if (fs::exists(wav)) return wav.string();
    return "";
}

void StateManager::ResetLocalPlayback(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _playbacks.find(playbackId);
    if (it != _playbacks.end()) {
        delete it->second;
        _playbacks.erase(it);
    }
    if (_ownerPid == static_cast<int>(getpid()) && _ownedTrack == playbackId) {
        _ownerPid = 0;
        _ownedTrack.clear();
        _ownedSource.clear();
    }
}

void StateManager::ResetPlayback(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const std::string safeId = SanitizePlaybackIdForPath(playbackId);
    std::error_code ec;
    fs::remove(fs::path(_baseSavePath) / (safeId + ".ogg"), ec);
    ec.clear();
    fs::remove(fs::path(_baseSavePath) / (safeId + ".wav"), ec);
    ClearSharedFiles(playbackId);

    const auto it = _playbacks.find(playbackId);
    if (it != _playbacks.end()) {
        delete it->second;
        _playbacks.erase(it);
    }
    _ownerPid = 0;
    _ownedTrack.clear();
    _ownedSource.clear();
}

void StateManager::CancelPlayback(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    const auto it = _playbacks.find(playbackId);
    if (it != _playbacks.end()) {
        if (it->second->fileStream.is_open()) it->second->fileStream.close();
        if (it->second->oggFileStream.is_open()) it->second->oggFileStream.close();
        delete it->second;
        _playbacks.erase(it);
    }

    std::error_code ec;
    fs::remove(SharedPath(playbackId, ".wav"), ec);
    ec.clear();
    fs::remove(SharedPath(playbackId, ".ogg"), ec);
    PersistStatus(playbackId, "cancelled");
}

void StateManager::SetPlaybackDuration(const std::string& playbackId, uint32_t durationMs) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto* playback = GetPlayback(playbackId);
    if (!playback || playback->durationMs == durationMs) return;

    playback->durationMs = durationMs;
    playback->limitBytes = static_cast<uint64_t>(
        playback->sampleRate * playback->channels * sizeof(float) * (durationMs / 1000.0)
    );
    printf("[Soggfy-INFO] Set playback duration: %u ms, limitBytes: %llu\n",
           durationMs, static_cast<unsigned long long>(playback->limitBytes));

    if (playback->initialized && !playback->discard &&
        playback->totalBytesWritten >= playback->limitBytes) {
        playback->fileStream.flush();
        playback->fileStream.seekp(0, std::ios::beg);
        WriteWavHeader(
            playback->fileStream,
            playback->totalBytesWritten,
            playback->sampleRate,
            playback->channels
        );
        playback->fileStream.close();
        playback->discard = true;
        PersistStatus(playbackId, "completed");
    }
}

void StateManager::PublishDuration(const std::string& playbackId, uint32_t durationMs) {
    WritePrivateTextFile(SharedPath(playbackId, ".duration"), std::to_string(durationMs));
}

void StateManager::PublishFinish(const std::string& playbackId) {
    WritePrivateTextFile(SharedPath(playbackId, ".finish"), "1");
}

void StateManager::PublishCancel(const std::string& playbackId) {
    WritePrivateTextFile(SharedPath(playbackId, ".cancel"), "1");
}

void StateManager::ApplySharedControls(const std::string& playbackId) {
    if (!OwnsWriter(playbackId)) return;

    std::ifstream durationFile(SharedPath(playbackId, ".duration"));
    uint32_t durationMs = 0;
    if (durationFile >> durationMs) SetPlaybackDuration(playbackId, durationMs);

    const std::string cancelPath = SharedPath(playbackId, ".cancel");
    if (fs::exists(cancelPath)) {
        CancelPlayback(playbackId);
        std::error_code ec;
        fs::remove(cancelPath, ec);
        return;
    }
    const std::string finishPath = SharedPath(playbackId, ".finish");
    if (fs::exists(finishPath)) {
        FinishPlayback(playbackId);
        std::error_code ec;
        fs::remove(finishPath, ec);
    }
}
