#!/usr/bin/env bash
# Soggfy macOS safe setup script.
# Mutates only this repository/workspace unless the user explicitly installs Spotify via the official installer.

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SPOTIFY_INSTALLER_URL="https://download.scdn.co/SpotifyInstaller.zip"
SKIP_SPOTIFY_INSTALL=0
SKIP_LOGIN=0
REBUILD=0
RESET_WORKSPACE=0

usage() {
  cat <<USAGE
Usage: ./setup.sh [options]

Options:
  --skip-spotify-install  Fail if /Applications/Spotify.app is missing instead of launching Spotify's installer.
  --skip-login            Do not open Spotify for first-time login/profile preparation.
  --rebuild               Reconfigure CMake from scratch.
  --reset-workspace       Remove this repo's workspace/PatchedSpotify.app and workspace/profiles before patching.
  -h, --help              Show this help.

Safety invariant: this script never deletes /Applications/Spotify.app.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-spotify-install) SKIP_SPOTIFY_INSTALL=1 ;;
    --skip-login) SKIP_LOGIN=1 ;;
    --rebuild) REBUILD=1 ;;
    --reset-workspace) RESET_WORKSPACE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; usage; exit 2 ;;
  esac
  shift
done

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$ROOT_DIR/workspace"
PATCHED_APP="$WORKSPACE_DIR/PatchedSpotify.app"
PROFILE_TEMPLATE="$WORKSPACE_DIR/profile_template"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo -e "${RED}Missing required command: $cmd${NC}"
    return 1
  fi
}

echo -e "${BLUE}=== Soggfy macOS Setup ===${NC}"

if ! command -v brew >/dev/null 2>&1; then
  echo -e "${RED}Homebrew is required. Install it from https://brew.sh/ and re-run setup.${NC}"
  exit 1
fi

echo -e "\n${BLUE}[1/6] Checking dependencies${NC}"
BREW_DEPS=(cmake ffmpeg capstone pkg-config)
for dep in "${BREW_DEPS[@]}"; do
  if ! brew list "$dep" >/dev/null 2>&1 && ! command -v "$dep" >/dev/null 2>&1; then
    echo -e "${YELLOW}Installing $dep via Homebrew...${NC}"
    brew install "$dep"
  else
    echo -e "${GREEN}✓ $dep${NC}"
  fi
done

if ! command -v bun >/dev/null 2>&1; then
  echo -e "${YELLOW}Bun is not installed. Installing with the official installer...${NC}"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
require_command bun
require_command codesign
require_command cmake
require_command ffmpeg

echo -e "\n${BLUE}[2/6] Checking Spotify.app${NC}"
if [[ ! -d "/Applications/Spotify.app" ]]; then
  if [[ "$SKIP_SPOTIFY_INSTALL" -eq 1 ]]; then
    echo -e "${RED}/Applications/Spotify.app is missing and --skip-spotify-install was provided.${NC}"
    exit 1
  fi
  echo -e "${YELLOW}Spotify.app not found. Launching the official Spotify installer.${NC}"
  rm -rf /tmp/SoggfySpotifyInstaller
  mkdir -p /tmp/SoggfySpotifyInstaller
  curl -L "$SPOTIFY_INSTALLER_URL" -o /tmp/SoggfySpotifyInstaller/SpotifyInstaller.zip
  unzip -oq /tmp/SoggfySpotifyInstaller/SpotifyInstaller.zip -d /tmp/SoggfySpotifyInstaller
  open "/tmp/SoggfySpotifyInstaller/Install Spotify.app"
  echo -e "${YELLOW}Waiting for /Applications/Spotify.app to appear...${NC}"
  until [[ -d "/Applications/Spotify.app" ]]; do sleep 2; done
fi
echo -e "${GREEN}✓ Spotify.app present${NC}"

mkdir -p "$WORKSPACE_DIR" "$PROFILE_TEMPLATE"

if [[ "$SKIP_LOGIN" -eq 0 ]]; then
  echo -e "\n${BLUE}[3/6] Login/profile preparation${NC}"
  echo "Spotify will open once. Log in, wait for the main UI, then return here."
  open -n -a "/Applications/Spotify.app" --args --user-data-dir="$PROFILE_TEMPLATE"
  read -r -p "Press [Enter] after Spotify is logged in and loaded..."
  killall Spotify >/dev/null 2>&1 || true
  sleep 2
else
  echo -e "\n${BLUE}[3/6] Login/profile preparation skipped${NC}"
fi

echo -e "\n${BLUE}[4/6] Preparing patched workspace app${NC}"
if [[ "$RESET_WORKSPACE" -eq 1 ]]; then
  echo "Resetting repo-local workspace state..."
  rm -rf "$PATCHED_APP" "$WORKSPACE_DIR/profiles"
fi

rm -rf "$PATCHED_APP"
ditto "/Applications/Spotify.app" "$PATCHED_APP"

adhoc_sign_if_present() {
  local target="$1"
  if [[ -e "$target" ]]; then
    codesign -f -s - "$target" >/dev/null 2>&1 || true
    echo -e "${GREEN}✓ ad-hoc signed $target${NC}"
  else
    echo -e "${YELLOW}warning: signature target missing: $target${NC}"
  fi
}

adhoc_sign_if_present "$PATCHED_APP/Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Chromium Embedded Framework"
adhoc_sign_if_present "$PATCHED_APP/Contents/MacOS/Spotify"

if [[ ! -f "$PATCHED_APP/Contents/MacOS/Spotify" ]]; then
  echo -e "${RED}Error: Failed to copy Spotify binary to $PATCHED_APP/Contents/MacOS/Spotify${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Patched app prepared at $PATCHED_APP${NC}"

echo -e "\n${BLUE}[5/6] Building payload${NC}"
cd "$ROOT_DIR/soggfy-macos"
if [[ "$REBUILD" -eq 1 ]]; then rm -rf build; fi
cmake -S . -B build
cmake --build build
mkdir -p "$PATCHED_APP/Contents/MacOS"
cp "$ROOT_DIR/soggfy-macos/build/libsoggfy.dylib" "$PATCHED_APP/Contents/MacOS/libsoggfy.dylib"
codesign -f -s - "$PATCHED_APP/Contents/MacOS/libsoggfy.dylib" >/dev/null 2>&1 || true
cd "$ROOT_DIR"

echo -e "\n${BLUE}[6/6] Installing webapp dependencies${NC}"
cd "$ROOT_DIR/webapp"
bun install
cd "$ROOT_DIR"

echo -e "\n${GREEN}=== Setup complete ===${NC}"
echo -e "Run diagnostics: ${YELLOW}bun run scripts/doctor.ts${NC}"
echo -e "Start server:    ${YELLOW}cd webapp && bun run src/index.ts${NC}"
echo -e "${YELLOW}Note:${NC} /Applications/Spotify.app was left untouched."
