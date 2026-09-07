#include <iostream>
#include <vector>
#include <string>
#include <sstream>

std::vector<uint8_t> ParsePattern(const char* pattern) {
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

int main() {
    auto b = ParsePattern("ff 43 01 d1 f8 5f 01 a9 f6 57 02 a9 f4 4f 03 a9 fd 7b 04 a9 fd 03 01 91 f4 03 01 aa f3 03 00 aa 08 30 40 39 68 0e 00 34 55 00 80 52 04 00 00 14 80 1e f8 37 68 32 40 39 c8 0d 00 34 60 c2 01 91");
    std::cout << "Parsed " << b.size() << " bytes." << std::endl;
}
