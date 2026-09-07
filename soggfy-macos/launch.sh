#!/usr/bin/env bash
# Soggfy macOS Bootstrapper & Injector

set -e

# Configuration
WORKSPACE_DIR="$(pwd)/workspace"
PATCHED_APP="$WORKSPACE_DIR/PatchedSpotify.app"
DYLIB_SOURCE="$(pwd)/soggfy-macos/build/libsoggfy.dylib"
DYLIB_DEST="$PATCHED_APP/Contents/MacOS/libsoggfy.dylib"

# Usage check
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo "Usage: ./launch.sh [spotify_uri]"
    echo "Example: ./launch.sh spotify:track:33BBo7zULt3O7mgE3pWMM5"
    exit 0
fi

# Build check
if [ ! -f "$DYLIB_SOURCE" ]; then
    echo "[!] Error: Payload not found. Please build the project first."
    exit 1
fi

# Workspace setup
if [ ! -d "$PATCHED_APP" ]; then
    echo "[*] Initializing workspace (first-time setup)..."
    # This part was done manually in previous steps but let's automate it robustly
    # For now, assume PatchedSpotify.app exists as I already created it.
    echo "[!] Error: workspace/PatchedSpotify.app not found."
    exit 1
fi

# Update payload
cp "$DYLIB_SOURCE" "$DYLIB_DEST"
codesign -f -s - "$DYLIB_DEST"

# Handle URI and Environment
export DYLD_INSERT_LIBRARIES="$DYLIB_DEST"

# CEF Performance & Memory optimization flags
CEF_FLAGS="--disable-gpu --disable-software-rasterizer --renderer-process-limit=1 --js-flags=--max-old-space-size=256 --disable-extensions --disable-background-networking"

if [ ! -z "$1" ]; then
    # Extract track ID from URI
    # spotify:track:33BBo7zULt3O7mgE3pWMM5?si=... -> 33BBo7zULt3O7mgE3pWMM5
    TRACK_ID=$(echo "$1" | sed -n 's/.*track:\([a-zA-Z0-9]\{22\}\).*/\1/p')
    if [ -z "$TRACK_ID" ]; then
        TRACK_ID="download"
    fi
    export SOGGFY_TARGET_ID="$TRACK_ID"
    echo "[*] Target Track ID: $TRACK_ID"
    echo "[*] Launching Spotify with URI: $1"
    "$PATCHED_APP/Contents/MacOS/Spotify" $CEF_FLAGS "$1" > /tmp/soggfy.log 2>&1
else
    echo "[*] Launching Spotify (Listen Mode)..."
    "$PATCHED_APP/Contents/MacOS/Spotify" $CEF_FLAGS > /tmp/soggfy.log 2>&1
fi
