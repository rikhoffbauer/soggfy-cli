#pragma once

#include <string>

enum class SoggfyProcessRole {
  MainSpotify,
  SpotifyHelper,
  Unrelated,
};

inline bool SoggfyPathEndsWith(const std::string &value, const std::string &suffix) {
  return value.size() >= suffix.size() &&
         value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

inline SoggfyProcessRole ClassifySoggfyProcess(const std::string &executablePath) {
  if (SoggfyPathEndsWith(executablePath, "/Contents/MacOS/Spotify")) {
    return SoggfyProcessRole::MainSpotify;
  }

  if (executablePath.find("/Contents/MacOS/Spotify Helper") != std::string::npos) {
    return SoggfyProcessRole::SpotifyHelper;
  }

  return SoggfyProcessRole::Unrelated;
}
