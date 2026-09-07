# Comprehensive Implementation Plan: Soggfy for macOS

This document outlines the detailed technical roadmap for completing the macOS port of the Soggfy Ogg dumper, picking up from the initial injection and bootstrapping phases.

Here is the detailed implementation plan to port the project to macOS. Because macOS heavily restricts runtime code injection through System Integrity Protection (SIP) and Library Validation, we will use a creative, "ducktape" approach: copying the application to a temporary directory, forcefully stripping its Apple code signatures, and injecting our payload using the `DYLD_INSERT_LIBRARIES` environment variable.

This plan establishes the complete foundational infrastructure.

### Phase 1: Environment & Toolchain Preparation

We will use CMake as the build system and rely on `brew` for dependencies. We need `capstone` for disassembly if we build our own pattern scanner, and we will use `Dobby` as our hooking framework (fetched automatically via CMake).

Run the following macOS-compatible shell commands to set up the environment:

```bash
brew update
brew install cmake ninja pkg-config capstone
mkdir -p soggfy-macos/Payload
cd soggfy-macos

```

### Phase 2: The Build System (CMakeLists.txt)

Instead of Visual Studio solutions, we define the project using CMake. This file is configured to fetch the Dobby hooking library from GitHub automatically, compile our C++ payload as a shared dynamic library (`.dylib`), and link everything together.

Save the following fully implemented code as `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.15)
project(SoggfyMacOS C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Configure for both Apple Silicon and Intel
set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64")

# Fetch Dobby for cross-platform Mach-O hooking
include(FetchContent)
FetchContent_Declare(
    Dobby
    GIT_REPOSITORY https://github.com/jmpews/Dobby.git
    GIT_TAG        master
)
FetchContent_MakeAvailable(Dobby)

# Find Capstone (installed via brew) for potential pattern scanning
find_package(PkgConfig REQUIRED)
pkg_check_modules(CAPSTONE REQUIRED capstone)

# Define the dynamic library payload
add_library(soggfy SHARED 
    Payload/Main.cpp
)

target_include_directories(soggfy PRIVATE 
    ${CAPSTONE_INCLUDE_DIRS}
)

target_link_libraries(soggfy PRIVATE 
    Dobby
    ${CAPSTONE_LIBRARIES}
)

# Optional: Strip local symbols for release
set_target_properties(soggfy PROPERTIES 
    VISIBILITY_INLINES_HIDDEN ON
    C_VISIBILITY_PRESET hidden
    CXX_VISIBILITY_PRESET hidden
)

```

### Phase 3: The Payload Entry Point (Payload/Main.cpp)

On Windows, a DLL uses `DllMain`. On macOS, a `.dylib` uses functions decorated with `__attribute__((constructor))` which execute immediately when the library is loaded into the target process's memory space.

This implementation includes extensive logging to make debugging the injection and hooking process straightforward.

Save the following fully implemented code as `Payload/Main.cpp`:

```cpp
#include <iostream>
#include <thread>
#include <chrono>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include "dobby.h"

// Define function pointers for the original functions we want to hook
void (*orig_CEF_Initialize)(void* args);

// Our custom hook implementation
void my_CEF_Initialize(void* args) {
    printf("[Soggfy-DEBUG] Intercepted call to CEF_Initialize!\n");
    printf("[Soggfy-DEBUG] Arguments pointer received: %p\n", args);
    
    // Execute original function to prevent crashing the app
    orig_CEF_Initialize(args);
    
    printf("[Soggfy-DEBUG] Original CEF_Initialize completed successfully.\n");
}

void SetupHooks() {
    printf("[Soggfy-DEBUG] Initializing hook setup phase...\n");
    
    // Note: In the full reverse-engineered stage, dlsym might fail for stripped internal functions.
    // At that point, this will be replaced with a Capstone-based Mach-O memory pattern scanner.
    void* cef_init_addr = dlsym(RTLD_DEFAULT, "cef_initialize");
    
    if (cef_init_addr != nullptr) {
        printf("[Soggfy-DEBUG] Found target function at address: %p\n", cef_init_addr);
        
        // Use Dobby to perform an inline assembly hook
        int hook_result = DobbyHook(
            cef_init_addr, 
            (dobby_dummy_func_t)my_CEF_Initialize, 
            (dobby_dummy_func_t*)&orig_CEF_Initialize
        );
        
        if (hook_result == 0) {
            printf("[Soggfy-INFO] Hook placed successfully.\n");
        } else {
            printf("[Soggfy-ERROR] DobbyHook failed with error code: %d\n", hook_result);
        }
    } else {
        printf("[Soggfy-WARN] dlsym failed to find target symbol. Manual offset/pattern scanning required.\n");
    }
}

// The library constructor - equivalent to DllMain(DLL_PROCESS_ATTACH)
__attribute__((constructor))
void SoggfyEntryPoint() {
    printf("[Soggfy-INFO] Payload injected into process ID: %d\n", getpid());
    
    uint32_t image_count = _dyld_image_count();
    printf("[Soggfy-DEBUG] Current dyld image count: %u\n", image_count);
    
    printf("[Soggfy-INFO] Spawning background thread for hook initialization...\n");
    
    std::thread([]() {
        // Sleep briefly to ensure the host application has finished loading its primary frameworks
        std::this_thread::sleep_for(std::chrono::milliseconds(1500));
        SetupHooks();
    }).detach();
}

```

### Phase 4: The Injection Bypass Script (launch.sh)

Because macOS apps are signed and enforce Library Validation (which prevents loading unsigned or third-party `.dylib` files), a standard launch will crash. We bypass this by creating an ephemeral copy of the application in `/tmp`, ripping out its cryptographic signatures using `codesign`, and launching it with `DYLD_INSERT_LIBRARIES`.

Save the following fully implemented code as `launch.sh`:

```bash
#!/usr/bin/env bash
# Soggfy macOS Bootstrapper & Injector

set -e

echo "[*] Starting Soggfy macOS Bootstrapper"

SPOTIFY_APP="/Applications/Spotify.app"
TMP_DIR="/tmp/Soggfy_Workspace"
PATCHED_APP="$TMP_DIR/Spotify.app"
DYLIB_PATH="$(pwd)/build/libsoggfy.dylib"

if [ ! -f "$DYLIB_PATH" ]; then
    echo "[!] Critical Error: Payload not found at $DYLIB_PATH"
    echo "[!] Please compile the project using CMake first."
    exit 1
fi

if [ ! -d "$SPOTIFY_APP" ]; then
    echo "[!] Critical Error: Spotify.app not found in /Applications/"
    exit 1
fi

echo "[*] Cleaning previous workspace..."
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

echo "[*] Creating an unhardened clone of the application..."
cp -R "$SPOTIFY_APP" "$PATCHED_APP"

echo "[*] Applying ducktape: Stripping code signatures to bypass Library Validation..."
# Strip the main executable
codesign --remove-signature "$PATCHED_APP/Contents/MacOS/Spotify"

# Strip the CEF framework (crucial, as CEF is loaded dynamically)
CEF_PATH="$PATCHED_APP/Contents/Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework"
if [ -f "$CEF_PATH" ]; then
    codesign --remove-signature "$CEF_PATH"
    echo "[*] Stripped CEF framework signature."
else
    echo "[!] Warning: Could not locate CEF framework at expected path."
fi

echo "[*] Preparing environment variables for injection..."
export DYLD_INSERT_LIBRARIES="$DYLIB_PATH"

echo "[*] Launching patched application..."
# Launch the app in the background, redirecting stdout/stderr to our terminal for debugging
"$PATCHED_APP/Contents/MacOS/Spotify"

```

### Example Usage of Implemented Code

```bash
# 1. Make the launcher script executable
chmod +x launch.sh

# 2. Build the project using CMake and Ninja
mkdir build
cd build
cmake -G Ninja ..
ninja
cd ..

# 3. Execute the injection pipeline
./launch.sh

```

## Phase 5: Advanced Reverse Engineering & ABI Adaptation

With the build system, hook engine, and injection bypass working, the next phase involves opening the macOS `Spotify` binary in Ghidra or IDA Pro to find the exact memory signatures for the OGG stream processing functions. Because Mach-O binaries use different registers for parameter passing than Windows PE binaries, the byte patterns used in the Windows version of Soggfy are invalid here and must be extracted from scratch to populate `SetupHooks()`.
The original Windows application relies on hardcoded byte signatures to find undocumented functions in the Spotify executable. macOS uses the Mach-O binary format and different calling conventions.

### 5.1 ABI differences (x64 and ARM64)
* **x64 (Intel):** The Windows version assumes the Microsoft x64 calling convention (`RCX`, `RDX`, `R8`, `R9`). The macOS version must use the System V AMD64 ABI (`RDI`, `RSI`, `RDX`, `RCX`, `R8`, `R9`). All function pointer typedefs in `Hooks.h` must be updated.
* **ARM64 (Apple Silicon):** Spotify on macOS is a Universal Binary. ARM64 uses the AAPCS64 calling convention (`X0` to `X7` for arguments).
* **Action:** You must maintain two sets of byte signatures and register offsets—one for the x86_64 slice and one for the ARM64 slice.

### 5.2 Identifying the Audio Pipeline (Ghidra / LLDB)
1.  Load `/Applications/Spotify.app/Contents/MacOS/Spotify` into Ghidra.
2.  Locate the OGG decryption routine. In the Windows version, this is often found by string references to "OggS" or by tracing the CEF audio buffer callbacks.
3.  Use `lldb` attached to the un-hardened Spotify process (`sudo lldb -n Spotify`) to set breakpoints on `AudioQueueEnqueueBuffer` or CoreAudio's `AudioUnitRender` to trace back to where the plaintext OGG packets are generated in memory.

## Phase 6: Mach-O Pattern Scanning Engine

Since `GetModuleHandle` and PE header parsing do not exist on macOS, we must build a native Mach-O memory scanner to find our function addresses at runtime.

### 6.1 Implementing the Scanner
* Iterate loaded images using `_dyld_image_count()` and `_dyld_get_image_name()`.
* Locate the main "Spotify" executable image.
* Get the base address using `_dyld_get_image_header()`.
* Parse the Mach-O load commands (`mach_header_64`). Look for the `LC_SEGMENT_64` command corresponding to the `__TEXT` segment, and specifically the `__text` section.
* Implement a Boyer-Moore or simple linear byte scanner (supporting wildcards `??`) that searches only within the boundaries of the `__text` section to prevent segmentation faults.

### 6.2 Signature Database Structure
```cpp
struct Signature {
    const char* pattern;    // e.g., "48 8B 05 ?? ?? ?? ?? 48 85 C0 74 05"
    size_t offset;          // Offset from match to actual function entry
    Architecture arch;      // x86_64 or ARM64
};

```

## Phase 7: Core Interception & Audio Extraction

Once the scanner yields the target addresses, we implement the payload logic.

### 7.1 Hooking the Decryptor

* Use Dobby (`DobbyHook`) to place inline hooks on the identified OGG packet processing functions.
* When Spotify's internal thread calls the decryptor, execution flows to our hook.
* **The Hook Logic:**
1. Extract the track metadata (Track ID, Title, Artist) which is usually passed as a struct pointer in one of the registers (e.g., `RDI` or `X0`).
2. Extract the raw audio buffer pointer and size.
3. Push a copy of this buffer to a thread-safe lock-free queue to prevent blocking the audio thread (which would cause playback stutter).
4. Call the original function pointer to let Spotify continue playback.



### 7.2 The Dumper Thread

* Run a detached background `std::thread` that continuously polls the lock-free queue.
* When a new packet arrives, determine if it belongs to a new track or an existing track.
* Write the binary data directly to standard `.ogg` files in `~/Music/Soggfy/`.
* Use standard POSIX `open()`, `write()`, and `close()` or `std::ofstream`.

## Phase 8: Inter-Process Communication (IPC) & UI

Soggfy requires a way to communicate between the injected payload (which does the dumping) and a user interface (which toggles settings like "Enable Dumping" or configures bitrates).

### 8.1 The IPC Mechanism

* **Windows:** Used Named Pipes or window messages.
* **macOS:** Implement **UNIX Domain Sockets** (`sys/un.h`).
* Create a socket at `/tmp/soggfy_ipc.sock`.
* The injected payload runs a listener thread on this socket.

### 8.2 The Controller UI

* Instead of a native Windows WPF/WinForms app, build a lightweight macOS menu bar app using Swift and SwiftUI.
* The Swift app connects to `/tmp/soggfy_ipc.sock` to send JSON commands (e.g., `{"command": "toggle_dump", "value": true}`).
* Alternatively, to keep it strictly C++, write a simple CLI tool that sends these socket commands.

## Phase 9: Packaging and Distribution

Because the installation requires bypassing System Integrity Protection (SIP) limits via our `launch.sh` script, standard distribution is complex.

1. Bundle the `soggfy.dylib`, the Mach-O scanner, and the launcher into a `.tar.gz`.
2. Provide an interactive `install.sh` that:
* Checks for the presence of `Spotify.app`.
* Warns the user about the ad-hoc signing requirement.
* Sets up an Automator Application or a `.app` wrapper around `launch.sh` so the user can launch the patched version from Launchpad or Spotlight seamlessly, rather than keeping a terminal window open.


