#include "OggPreRoll.h"

OggStreamSnapshot OggStreamSelection::Snapshot() const {
  return {active_, serial_};
}

void OggStreamSelection::Activate(uint32_t serial) {
  serial_ = serial;
  active_ = true;
}

void OggStreamSelection::Reset() {
  active_ = false;
  serial_ = 0;
}

bool OggGateEpochTracker::ShouldDiscard(bool gated, uint64_t epoch) {
  if (!initialized_) {
    initialized_ = true;
    lastEpoch_ = epoch;
    return gated && epoch != 0;
  }
  if (epoch == lastEpoch_) return false;
  lastEpoch_ = epoch;
  return gated;
}
OggPreRollBuffer::OggPreRollBuffer(size_t maxBytes) : maxBytes_(maxBytes) {}

void OggPreRollBuffer::Reset(const std::string& trackId) {
  targetTrack_ = trackId;
  Discard();
}

void OggPreRollBuffer::Discard() {
  serial_ = 0;
  active_ = false;
  bytes_.clear();
}

bool OggPreRollBuffer::BufferPage(
    const std::string& trackId,
    uint32_t serial,
    bool isVorbisBos,
    const uint8_t* header,
    size_t headerLen,
    const uint8_t* body,
    size_t bodyLen) {
  if (trackId.empty() || trackId != targetTrack_ || !header || headerLen == 0) {
    return false;
  }
  if (isVorbisBos) {
    Discard();
    serial_ = serial;
    active_ = true;
  } else if (!active_ || serial != serial_) {
    return false;
  }

  const size_t appendSize = headerLen + (body ? bodyLen : 0);
  if (appendSize > maxBytes_ || bytes_.size() > maxBytes_ - appendSize) {
    Discard();
    return false;
  }
  bytes_.insert(bytes_.end(), header, header + headerLen);
  if (body && bodyLen > 0) bytes_.insert(bytes_.end(), body, body + bodyLen);
  return true;
}

std::optional<BufferedOggStream> OggPreRollBuffer::TakeForSerial(
    const std::string& trackId,
    uint32_t serial) {
  if (!active_ || trackId != targetTrack_ || serial != serial_) return std::nullopt;
  BufferedOggStream result{serial_, std::move(bytes_)};
  Discard();
  return result;
}

size_t OggPreRollBuffer::Size() const {
  return bytes_.size();
}
