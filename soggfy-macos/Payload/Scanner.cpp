#include "Scanner.h"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <cstring>

std::vector<uint8_t> Scanner::ParsePattern(const char* pattern) {
    std::vector<uint8_t> bytes;
    char* pattern_copy = strdup(pattern);
    char* token = strtok(pattern_copy, " ");
    while (token != nullptr) {
        if (strcmp(token, "?") == 0 || strcmp(token, "??") == 0) {
            bytes.push_back(0xCC);
        } else {
            bytes.push_back(static_cast<uint8_t>(strtoul(token, nullptr, 16)));
        }
        token = strtok(nullptr, " ");
    }
    free(pattern_copy);
    return bytes;
}

bool Scanner::CompareData(const uint8_t* data, const std::vector<uint8_t>& pattern) {
    for (size_t i = 0; i < pattern.size(); ++i) {
        if (pattern[i] != 0xCC && data[i] != pattern[i]) {
            return false;
        }
    }
    return true;
}

uintptr_t Scanner::FindPattern(const char* image_name, const char* pattern) {
    auto results = FindAllPatterns(image_name, pattern);
    return results.empty() ? 0 : results[0];
}

uintptr_t Scanner::GetImageBaseAddress(const char* image_name) {
    uint32_t image_count = _dyld_image_count();
    for (uint32_t i = 0; i < image_count; ++i) {
        const char* name = _dyld_get_image_name(i);
        if (name == nullptr) continue;
        if (image_name) {
            const char* last_slash = strrchr(name, '/');
            const char* basename = last_slash ? last_slash + 1 : name;
            if (strcmp(basename, image_name) != 0) continue;
        }
        return (uintptr_t)_dyld_get_image_header(i);
    }
    return 0;
}

std::vector<uintptr_t> Scanner::FindAllPatterns(const char* image_name, const char* pattern) {
    std::vector<uintptr_t> results;
    auto parsed_pattern = ParsePattern(pattern);
    uint32_t image_count = _dyld_image_count();
    
    for (uint32_t i = 0; i < image_count; ++i) {
        const char* name = _dyld_get_image_name(i);
        if (name == nullptr) continue;
        if (image_name) {
            const char* last_slash = strrchr(name, '/');
            const char* basename = last_slash ? last_slash + 1 : name;
            if (strcmp(basename, image_name) != 0) continue;
        }
        
        const mach_header_64* header = (const mach_header_64*)_dyld_get_image_header(i);
        if (header->magic != MH_MAGIC_64) continue;
        
        uintptr_t slide = _dyld_get_image_vmaddr_slide(i);
        const load_command* lc = (const load_command*)((uintptr_t)header + sizeof(mach_header_64));
        
        for (uint32_t j = 0; j < header->ncmds; ++j) {
            if (lc->cmd == LC_SEGMENT_64) {
                const segment_command_64* seg = (const segment_command_64*)lc;
                // Scan all sections in both __TEXT and __DATA* segments
                if (strcmp(seg->segname, "__TEXT") == 0 || strstr(seg->segname, "__DATA")) {
                    const section_64* sec = (const section_64*)((uintptr_t)seg + sizeof(segment_command_64));
                    for (uint32_t k = 0; k < seg->nsects; ++k) {
                        if (sec->size >= parsed_pattern.size()) {
                            uint8_t* start = (uint8_t*)(sec->addr + slide);
                            for (size_t n = 0; n < sec->size - parsed_pattern.size(); ++n) {
                                if (CompareData(start + n, parsed_pattern)) {
                                    results.push_back((uintptr_t)(start + n));
                                }
                            }
                        }
                        sec = (const section_64*)((uintptr_t)sec + sizeof(section_64));
                    }
                }
            }
            lc = (const load_command*)((uintptr_t)lc + lc->cmdsize);
        }
    }
    return results;
}
