#pragma once
#include <cstdint>
#include <vector>
#include <string>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>

class Scanner {
public:
    static uintptr_t FindPattern(const char* image_name, const char* pattern);
    static std::vector<uintptr_t> FindAllPatterns(const char* image_name, const char* pattern);
    static uintptr_t GetImageBaseAddress(const char* image_name);

private:
    static std::vector<uint8_t> ParsePattern(const char* pattern);
    static bool CompareData(const uint8_t* data, const std::vector<uint8_t>& pattern);
};
