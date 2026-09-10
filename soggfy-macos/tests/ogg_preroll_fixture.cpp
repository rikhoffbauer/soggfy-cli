#include "OggPreRoll.h"
#include <cassert>
#include <cstdint>
#include <iostream>
#include <vector>

int main() {
  OggStreamSelection selection;
  auto initialSelection = selection.Snapshot();
  assert(!initialSelection.active);
  selection.Activate(0x1234);
  auto activeSelection = selection.Snapshot();
  assert(activeSelection.active && activeSelection.serial == 0x1234);
  selection.Reset();
  assert(!selection.Snapshot().active);

  OggGateEpochTracker gateTracker;
  assert(!gateTracker.ShouldDiscard(false, 1));
  assert(gateTracker.ShouldDiscard(true, 2));
  assert(!gateTracker.ShouldDiscard(true, 2));
  assert(gateTracker.ShouldDiscard(true, 3));

  OggPreRollBuffer buffer(64);
  const uint8_t bosHeader[] = {'O','g','g','S',0,2,0,0};
  const uint8_t vorbisBody[] = {1,'v','o','r','b','i','s'};
  const uint8_t pageHeader[] = {'O','g','g','S',0,0,1,2};
  const uint8_t pageBody[] = {9,8,7};

  buffer.Reset("track-a");
  assert(buffer.BufferPage("track-a", 0x1234, true, bosHeader, sizeof(bosHeader), vorbisBody, sizeof(vorbisBody)));
  assert(buffer.BufferPage("track-a", 0x1234, false, pageHeader, sizeof(pageHeader), pageBody, sizeof(pageBody)));
  auto pending = buffer.TakeForSerial("track-a", 0x1234);
  assert(pending.has_value());
  assert(pending->serial == 0x1234);
  std::vector<uint8_t> expected;
  expected.insert(expected.end(), std::begin(bosHeader), std::end(bosHeader));
  expected.insert(expected.end(), std::begin(vorbisBody), std::end(vorbisBody));
  expected.insert(expected.end(), std::begin(pageHeader), std::end(pageHeader));
  expected.insert(expected.end(), std::begin(pageBody), std::end(pageBody));
  assert(pending->bytes == expected);

  buffer.Reset("track-a");
  assert(buffer.BufferPage("track-a", 1, true, bosHeader, sizeof(bosHeader), vorbisBody, sizeof(vorbisBody)));
  buffer.Discard();
  assert(!buffer.TakeForSerial("track-a", 1).has_value());

  buffer.Reset("track-a");
  assert(buffer.BufferPage("track-a", 1, true, bosHeader, sizeof(bosHeader), vorbisBody, sizeof(vorbisBody)));
  assert(buffer.BufferPage("track-a", 2, true, bosHeader, sizeof(bosHeader), vorbisBody, sizeof(vorbisBody)));
  assert(!buffer.TakeForSerial("track-a", 1).has_value());
  assert(buffer.TakeForSerial("track-a", 2).has_value());

  OggPreRollBuffer tiny(10);
  tiny.Reset("track-a");
  assert(!tiny.BufferPage("track-a", 3, true, bosHeader, sizeof(bosHeader), vorbisBody, sizeof(vorbisBody)));
  assert(tiny.Size() == 0);

  std::cout << "ogg preroll fixture passed\n";
}
