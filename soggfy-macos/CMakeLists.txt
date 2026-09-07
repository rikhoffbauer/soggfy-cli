cmake_minimum_required(VERSION 3.15)
project(SoggfyMacOS C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Configure for Apple Silicon (matching available capstone)
set(CMAKE_OSX_ARCHITECTURES "arm64")

# Fetch Dobby for cross-platform Mach-O hooking
include(FetchContent)
fetchcontent_declare(
    Dobby
    GIT_REPOSITORY https://github.com/jmpews/Dobby.git
    GIT_TAG        master
)
fetchcontent_makeavailable(Dobby)

# Define the dynamic library payload
add_library(soggfy SHARED 
    Payload/Main.mm
    Payload/DecodeHook.mm
    Payload/Scanner.cpp
    Payload/StateManager.cpp
)

target_include_directories(soggfy PRIVATE 
    ${dobby_SOURCE_DIR}/include
)

find_library(AUDIOTOOLBOX_LIBRARY AudioToolbox)
find_library(OBJC_LIBRARY objc)
find_library(FOUNDATION_LIBRARY Foundation)
find_library(APPLICATIONSERVICES_LIBRARY ApplicationServices)

target_link_libraries(soggfy PRIVATE 
    dobby_static
    ${AUDIOTOOLBOX_LIBRARY}
    ${OBJC_LIBRARY}
    ${FOUNDATION_LIBRARY}
    ${APPLICATIONSERVICES_LIBRARY}
)

# Optional: Strip local symbols for release
set_target_properties(soggfy PROPERTIES 
    VISIBILITY_INLINES_HIDDEN ON
    C_VISIBILITY_PRESET hidden
    CXX_VISIBILITY_PRESET hidden
)
