#include "StateManager.h"
#include <iostream>
#include <filesystem>
#include <cstring>
#include <limits>
#include <system_error>
#include <cctype>
#include <cstdlib>

namespace fs = std::filesystem;

static std::string SanitizePlaybackIdForPath(const std::string& playbackId) {
    std::string safe;
    safe.reserve(playbackId.size());
    for (unsigned char ch : playbackId) {
        if (std::isalnum(ch) || ch == '_' || ch == '-') safe.push_back(static_cast<char>(ch));
    }
    if (safe.empty()) return "track";
    return safe;
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
    const char* env_save_path = getenv("SOGGFY_SAVE_PATH");
    _baseSavePath = env_save_path ? env_save_path : "/tmp/Soggfy_cli";
    try {
        fs::create_directories(_baseSavePath);
        printf("[Soggfy-INFO] StateManager initialized. Base save path: %s\n", _baseSavePath.c_str());
    } catch (const std::exception& e) {
        printf("[Soggfy-ERROR] Failed to create directories: %s\n", e.what());
    }
}

StateManager::~StateManager() {
    std::lock_guard<std::mutex> lock(_mutex);
    for (auto& pair : _playbacks) {
        delete pair.second;
    }
}

void StateManager::SetBaseSavePath(const std::string& path) {
    std::lock_guard<std::mutex> lock(_mutex);
    _baseSavePath = path;
    fs::create_directories(_baseSavePath);
}

StateManager::Playback* StateManager::GetPlayback(const std::string& playbackId) {
    if (_playbacks.find(playbackId) == _playbacks.end()) {
        _playbacks[playbackId] = new Playback(playbackId);
    }
    auto p = _playbacks[playbackId];
    if (p->discard) {
        p->discard = false;
    }
    return p;
}

void StateManager::WriteWavHeader(std::ofstream& stream, uint64_t dataSize, uint32_t sampleRate, uint16_t channels) {
    // IEEE Float 32-bit PCM WAV header (44 bytes). Classic RIFF/WAV stores sizes as uint32_t.
    uint32_t wavDataSize = dataSize > std::numeric_limits<uint32_t>::max() ? std::numeric_limits<uint32_t>::max() : static_cast<uint32_t>(dataSize);
    uint16_t bitsPerSample = 32;
    uint16_t blockAlign = channels * (bitsPerSample / 8);
    uint32_t byteRate = sampleRate * blockAlign;
    uint32_t chunkSize = 36 + wavDataSize;

    // RIFF header
    stream.write("RIFF", 4);
    stream.write(reinterpret_cast<const char*>(&chunkSize), 4);
    stream.write("WAVE", 4);

    // fmt sub-chunk
    stream.write("fmt ", 4);
    uint32_t subchunk1Size = 16;
    stream.write(reinterpret_cast<const char*>(&subchunk1Size), 4);
    uint16_t audioFormat = 3; // IEEE Float
    stream.write(reinterpret_cast<const char*>(&audioFormat), 2);
    stream.write(reinterpret_cast<const char*>(&channels), 2);
    stream.write(reinterpret_cast<const char*>(&sampleRate), 4);
    stream.write(reinterpret_cast<const char*>(&byteRate), 4);
    stream.write(reinterpret_cast<const char*>(&blockAlign), 2);
    stream.write(reinterpret_cast<const char*>(&bitsPerSample), 2);

    // data sub-chunk
    stream.write("data", 4);
    stream.write(reinterpret_cast<const char*>(&wavDataSize), 4);
}

void StateManager::ReceiveAudioData(const std::string& playbackId, const char* data, size_t length) {
    if (!data || length == 0) return;

    std::lock_guard<std::mutex> lock(_mutex);
    auto playback = GetPlayback(playbackId);
    if (!playback || playback->discard) return;

    if (!playback->initialized) {
        // Detect if incoming audio buffer is raw Ogg Vorbis stream ("OggS" magic header)
        if (length >= 4 && data[0] == 'O' && data[1] == 'g' && data[2] == 'g' && data[3] == 'S') {
            playback->isRawOgg = true;
        }

        std::string ext = playback->isRawOgg ? ".ogg" : ".wav";
        playback->fileName = (fs::path(_baseSavePath) / (SanitizePlaybackIdForPath(playbackId) + ext)).string();
        playback->fileStream.open(playback->fileName, std::ios::binary);
        if (!playback->fileStream.is_open()) {
            printf("[Soggfy-ERROR] Failed to open file: %s\n", playback->fileName.c_str());
            return;
        }
        playback->initialized = true;

        if (!playback->isRawOgg) {
            // Write placeholder WAV header for PCM stream
            WriteWavHeader(playback->fileStream, 0, playback->sampleRate, playback->channels);
        }

        printf("[Soggfy-INFO] Started new track stream (%s): %s\n",
               playback->isRawOgg ? "Raw Ogg Vorbis" : "PCM WAV", playback->fileName.c_str());
    }

    if (playback->fileStream.is_open()) {
        playback->fileStream.write(data, length);
        playback->totalBytesWritten += length;

        if (playback->limitBytes > 0 && playback->totalBytesWritten >= playback->limitBytes) {
            printf("[Soggfy-INFO] Reached byte limit: %llu/%llu. Finalizing track.\n",
                   (unsigned long long)playback->totalBytesWritten, (unsigned long long)playback->limitBytes);
            playback->fileStream.flush();
            if (!playback->isRawOgg) {
                playback->fileStream.seekp(0, std::ios::beg);
                WriteWavHeader(playback->fileStream, playback->totalBytesWritten,
                               playback->sampleRate, playback->channels);
            }
            playback->fileStream.close();
            playback->discard = true;
        }
    }
}

void StateManager::ReceiveOggData(const std::string& playbackId, const char* data, size_t length) {
    if (!data || length == 0) return;

    std::lock_guard<std::mutex> lock(_mutex);
    auto playback = GetPlayback(playbackId);
    if (!playback || playback->discard) return;

    if (!playback->oggInitialized) {
        playback->oggFileName = (fs::path(_baseSavePath) / (SanitizePlaybackIdForPath(playbackId) + ".ogg")).string();
        playback->oggFileStream.open(playback->oggFileName, std::ios::binary);
        if (!playback->oggFileStream.is_open()) {
            printf("[Soggfy-ERROR] Failed to open raw Ogg file: %s\n", playback->oggFileName.c_str());
            return;
        }
        playback->oggInitialized = true;
        printf("[Soggfy-INFO] Started raw Ogg Vorbis stream: %s\n", playback->oggFileName.c_str());
    }

    if (playback->oggFileStream.is_open()) {
        playback->oggFileStream.write(data, length);
        playback->oggBytesWritten += length;
    }
}
void StateManager::FinishPlayback(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) return;

    auto playback = it->second;
    if (playback->discard) return;

    if (playback->fileStream.is_open()) {
        playback->fileStream.flush();
        if (!playback->isRawOgg) {
            playback->fileStream.seekp(0, std::ios::beg);
            WriteWavHeader(playback->fileStream, playback->totalBytesWritten,
                           playback->sampleRate, playback->channels);
        }
        playback->fileStream.close();
    }

    if (playback->oggFileStream.is_open()) {
        playback->oggFileStream.flush();
        playback->oggFileStream.close();
        printf("[Soggfy-INFO] Finalized raw Ogg stream: %s (%llu bytes)\n",
               playback->oggFileName.c_str(), (unsigned long long)playback->oggBytesWritten);
    }

    playback->discard = true;
}

void StateManager::MarkPlaybackActive(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto playback = GetPlayback(playbackId);
    if (playback) {
        playback->active = true;
    }
}

std::string StateManager::GetPlaybackStatus(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) {
        return "idle";
    }
    if (it->second->discard) {
        return "completed";
    }
    if (it->second->initialized || it->second->oggInitialized || it->second->active) {
        return "downloading";
    }
    return "idle";
}


uint64_t StateManager::GetPlaybackBytes(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) return 0;
    if (it->second->oggBytesWritten > 0) return it->second->oggBytesWritten;
    return it->second->totalBytesWritten;
}

uint64_t StateManager::GetPlaybackLimitBytes(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) return 0;
    if (it->second->oggBytesWritten > 0 && it->second->durationMs > 0) {
        return static_cast<uint64_t>(it->second->durationMs * 40ULL);
    }
    return it->second->limitBytes;
}

std::string StateManager::GetPlaybackFileName(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) return "";
    if (it->second->oggBytesWritten > 0) return it->second->oggFileName;
    return it->second->fileName;
}

void StateManager::ResetPlayback(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    std::string safeId = SanitizePlaybackIdForPath(playbackId);
    std::error_code ec;
    fs::remove(fs::path(_baseSavePath) / (safeId + ".ogg"), ec);
    fs::remove(fs::path(_baseSavePath) / (safeId + ".wav"), ec);

    auto it = _playbacks.find(playbackId);
    if (it != _playbacks.end()) {
        delete it->second;
        _playbacks.erase(it);
    }
}

void StateManager::CancelPlayback(const std::string& playbackId) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto it = _playbacks.find(playbackId);
    if (it == _playbacks.end()) return;

    std::string fileName = it->second->fileName;
    if (it->second->fileStream.is_open()) {
        it->second->fileStream.flush();
        it->second->fileStream.close();
    }
    delete it->second;
    _playbacks.erase(it);

    if (!fileName.empty()) {
        std::error_code ec;
        fs::remove(fileName, ec);
        if (ec) {
            printf("[Soggfy-WARN] Failed to remove cancelled partial file %s: %s\n",
                   fileName.c_str(), ec.message().c_str());
        } else {
            printf("[Soggfy-INFO] Cancelled playback and removed partial file: %s\n",
                   fileName.c_str());
        }
    }
}

void StateManager::SetPlaybackDuration(const std::string& playbackId, uint32_t durationMs) {
    std::lock_guard<std::mutex> lock(_mutex);
    auto playback = GetPlayback(playbackId);
    if (!playback) return;

    playback->durationMs = durationMs;
    // Calculate limit bytes: sampleRate * channels * bytesPerSample * (durationMs / 1000.0)
    playback->limitBytes = (uint64_t)(playback->sampleRate * playback->channels * sizeof(float) * (durationMs / 1000.0));
    printf("[Soggfy-INFO] Set playback duration: %u ms, limitBytes: %llu\n", durationMs, (unsigned long long)playback->limitBytes);

    // In case we have already written enough bytes (unlikely but possible)
    if (playback->initialized && !playback->discard && playback->totalBytesWritten >= playback->limitBytes) {
        printf("[Soggfy-INFO] Reached byte limit immediately upon duration set: %llu/%llu. Finalizing track.\n",
               (unsigned long long)playback->totalBytesWritten, (unsigned long long)playback->limitBytes);
        playback->fileStream.flush();
        playback->fileStream.seekp(0, std::ios::beg);
        WriteWavHeader(playback->fileStream, playback->totalBytesWritten,
                       playback->sampleRate, playback->channels);
        playback->fileStream.close();
        playback->discard = true;
    }
}
