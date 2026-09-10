#include "ProcessRole.h"
#include <cassert>

int main() {
  using Role = SoggfyProcessRole;
  assert(ClassifySoggfyProcess("/Users/test/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify") == Role::MainSpotify);
  assert(ClassifySoggfyProcess("/Users/test/.soggfy/workspace/PatchedSpotify.app/Contents/Frameworks/Spotify Helper.app/Contents/MacOS/Spotify Helper") == Role::SpotifyHelper);
  assert(ClassifySoggfyProcess("/Users/test/.soggfy/workspace/PatchedSpotify.app/Contents/Frameworks/Spotify Helper (Renderer).app/Contents/MacOS/Spotify Helper (Renderer)") == Role::SpotifyHelper);
  assert(ClassifySoggfyProcess("/usr/bin/profiles") == Role::Unrelated);
  assert(ClassifySoggfyProcess("/usr/bin/security") == Role::Unrelated);
  assert(ClassifySoggfyProcess("/Applications/Some App.app/Contents/MacOS/Some App") == Role::Unrelated);
  return 0;
}
