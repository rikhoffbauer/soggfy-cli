#!/usr/bin/env bash
# Soggfy macOS safe setup script.
# Mutates only this repository and ~/.soggfy unless the user explicitly installs Spotify via the official installer.

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
  --reset-workspace       Remove the Soggfy patched app and profiles before patching.
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
SPOTIFY_COMPATIBILITY_REGISTRY="$ROOT_DIR/compatibility/spotify-versions.json"
SOGGFY_HOME="${SOGGFY_HOME:-$HOME/.soggfy}"
WORKSPACE_DIR="$SOGGFY_HOME/workspace"
PATCHED_APP="$WORKSPACE_DIR/PatchedSpotify.app"
STAGED_APP="$WORKSPACE_DIR/.PatchedSpotify.app.staging.$$"
BACKUP_APP="$WORKSPACE_DIR/.PatchedSpotify.app.backup"
BACKUP_CREATED=0

cleanup_transaction() {
  rm -rf "$STAGED_APP"
  if [[ "$BACKUP_CREATED" -eq 1 && ! -e "$PATCHED_APP" && -e "$BACKUP_APP" ]]; then
    mv "$BACKUP_APP" "$PATCHED_APP"
  fi
}
trap cleanup_transaction EXIT

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
BREW_DEPS=(cmake ffmpeg chromaprint)
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

isSpotifyVersionSupported() {
  local version="$1"
  SPOTIFY_VERSION_TO_CHECK="$version" SPOTIFY_COMPATIBILITY_REGISTRY="$SPOTIFY_COMPATIBILITY_REGISTRY" bun -e '
    const registry = await Bun.file(process.env.SPOTIFY_COMPATIBILITY_REGISTRY).json();
    const version = process.env.SPOTIFY_VERSION_TO_CHECK;
    process.exit(registry.versions.some((entry) => entry.version === version && entry.architecture === "arm64" && entry.status === "supported") ? 0 : 1);
  ' >/dev/null
}

supportedSpotifyVersions() {
  SPOTIFY_COMPATIBILITY_REGISTRY="$SPOTIFY_COMPATIBILITY_REGISTRY" bun -e '
    const registry = await Bun.file(process.env.SPOTIFY_COMPATIBILITY_REGISTRY).json();
    console.log(registry.versions.filter((entry) => entry.architecture === "arm64" && entry.status === "supported").map((entry) => entry.version).join(", "));
  '
}

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
SPOTIFY_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Spotify.app/Contents/Info.plist 2>/dev/null || true)"
if ! isSpotifyVersionSupported "$SPOTIFY_VERSION"; then
  echo -e "${RED}Unsupported Spotify build ${SPOTIFY_VERSION:-unknown}; capture hooks are validated for exact arm64 builds: $(supportedSpotifyVersions).${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Spotify build $SPOTIFY_VERSION is capture-compatible${NC}"

mkdir -p "$SOGGFY_HOME" "$WORKSPACE_DIR"
chmod 700 "$SOGGFY_HOME" "$WORKSPACE_DIR"

if [[ "$SKIP_LOGIN" -eq 0 ]]; then
  echo -e "\n${BLUE}[3/6] Capturing Soggfy login state${NC}"
  bun "$ROOT_DIR/src/cli.ts" auth login
else
  echo -e "\n${BLUE}[3/6] Login preparation skipped${NC}"
fi

echo -e "\n${BLUE}[4/6] Building payload${NC}"
cd "$ROOT_DIR/soggfy-macos"
if [[ "$REBUILD" -eq 1 ]]; then rm -rf build; fi
cmake -S . -B build
cmake --build build
cd "$ROOT_DIR"

echo -e "\n${BLUE}[5/6] Staging and verifying patched Spotify${NC}"
rm -rf "$STAGED_APP"
ditto "/Applications/Spotify.app" "$STAGED_APP"
/usr/libexec/PlistBuddy -c 'Delete :LSUIElement' "$STAGED_APP/Contents/Info.plist" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c 'Delete :LSBackgroundOnly' "$STAGED_APP/Contents/Info.plist" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c 'Add :LSBackgroundOnly bool true' "$STAGED_APP/Contents/Info.plist"
mkdir -p "$STAGED_APP/Contents/MacOS"
cp "$ROOT_DIR/soggfy-macos/build/libsoggfy.dylib" "$STAGED_APP/Contents/MacOS/libsoggfy.dylib"
codesign -f -s - "$STAGED_APP/Contents/MacOS/libsoggfy.dylib" >/dev/null
codesign -f -s - --deep "$STAGED_APP" >/dev/null
codesign --verify --deep --strict "$STAGED_APP"

if [[ -e "$BACKUP_APP" ]]; then
  echo -e "${RED}Refusing install with stale backup present: $BACKUP_APP${NC}"
  exit 1
fi
if [[ -e "$PATCHED_APP" ]]; then
  mv "$PATCHED_APP" "$BACKUP_APP"
  BACKUP_CREATED=1
fi
if ! mv "$STAGED_APP" "$PATCHED_APP"; then
  [[ -e "$BACKUP_APP" ]] && mv "$BACKUP_APP" "$PATCHED_APP"
  exit 1
fi
rm -rf "$BACKUP_APP"
BACKUP_CREATED=0
if [[ "$RESET_WORKSPACE" -eq 1 ]]; then rm -rf "$WORKSPACE_DIR/profiles"; fi
echo -e "${GREEN}✓ Patched app committed at $PATCHED_APP${NC}"

echo -e "\n${BLUE}[6/6] Installing webapp dependencies${NC}"
cd "$ROOT_DIR/webapp"
bun install --frozen-lockfile --ignore-scripts
cd "$ROOT_DIR"

echo -e "\n${GREEN}=== Setup complete ===${NC}"
echo -e "Run diagnostics: ${YELLOW}bun run scripts/doctor.ts${NC}"
echo -e "Start daemon:    ${YELLOW}soggfy daemon start${NC}"
echo -e "${YELLOW}Note:${NC} /Applications/Spotify.app was left untouched."
