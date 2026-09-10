#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

struct BufferedOggStream {
  uint32_t serial = 0;
  std::vector<uint8_t> bytes;
};

struct OggStreamSnapshot {
  bool active = false;
  uint32_t serial = 0;
};

class OggStreamSelection {
 public:
  OggStreamSnapshot Snapshot() const;
  void Activate(uint32_t serial);
  void Reset();

 private:
  bool active_ = false;
  uint32_t serial_ = 0;
};

class OggGateEpochTracker {
 public:
  bool ShouldDiscard(bool gated, uint64_t epoch);

 private:
  bool initialized_ = false;
  uint64_t lastEpoch_ = 0;
};

class OggPreRollBuffer {
 public:
  explicit OggPreRollBuffer(size_t maxBytes = 8 * 1024 * 1024);

  void Reset(const std::string& trackId);
  void Discard();
  bool BufferPage(
      const std::string& trackId,
      uint32_t serial,
      bool isVorbisBos,
      const uint8_t* header,
      size_t headerLen,
      const uint8_t* body,
      size_t bodyLen);
  std::optional<BufferedOggStream> TakeForSerial(
      const std::string& trackId,
      uint32_t serial);
  size_t Size() const;

 private:
  size_t maxBytes_;
  std::string targetTrack_;
  uint32_t serial_ = 0;
  bool active_ = false;
  std::vector<uint8_t> bytes_;
};
