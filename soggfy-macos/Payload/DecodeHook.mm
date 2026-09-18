#include <os/log.h>
#include "CapturePolicy.h"
#include "DecodeHook.h"
#include "NativeSourceIdentity.h"
#include "OggPreRoll.h"
#include "Scanner.h"
#include "StateManager.h"
#include "SpotifyHookTargets.h"
#include <dobby.h>
#include <vector>
#import <Foundation/Foundation.h>
#include <algorithm>
#include <cmath>
#include <mach-o/dyld.h>
#include <malloc/malloc.h>
#include <stdio.h>
#include <cstdlib>
#include <execinfo.h>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <chrono>
#include <thread>
#include <atomic>
#include <cstring>
#include <sstream>
#include <unordered_map>
#include <unordered_set>
#include <optional>
#include <pthread.h>
#include <unistd.h>

struct ogg_page_sys {
    unsigned char *header;
    long header_len;
    unsigned char *body;
    long body_len;
};

static int (*orig_ogg_stream_pagein)(void* os, ogg_page_sys* og) = nullptr;

extern std::mutex g_track_mutex;
extern std::string g_active_track_id;
extern std::atomic<bool> g_capture_gated;

// ARM64 DecodeAudioData; image-relative address is selected per validated Spotify build.
// x0: this (Decoder)
// x1: float* sampleBuffer (PCM output)
// x2: size_t* sampleCount (in: capacity, out: samplesDecoded)
// x3: const char* encodedBuffer (Ogg packet stream)
// x4: size_t* encodedSize (in: input bytes, out: bytesRead)
// x5: int flags
typedef int (*DecodeAudioData_t)(void* x0, float* x1, size_t* x2, const char* x3, size_t* x4, int x5);
static DecodeAudioData_t orig_DecodeAudioData = nullptr;

std::atomic<bool> g_decoder_hooks_ready{false};
static std::atomic<int> g_ogg_pagein_success_return{1};
static std::mutex g_ogg_preroll_mutex;
static OggPreRollBuffer g_ogg_preroll;
static OggStreamSelection g_ogg_stream_selection;
static std::atomic<uint64_t> g_last_gated_sync_ms{0};
static std::atomic<double> g_capture_decode_speed{12.0};
static std::mutex g_gated_sync_mutex;
static constexpr double kMaxProductionDecodeSpeed = 64.0;
static constexpr double kMaxInvestigationDecodeSpeed = 256.0;

static double CaptureDecodeSpeedLimit() {
    const char* raw = std::getenv("SOGGFY_INVESTIGATION_ALLOW_HIGH_DECODE_SPEED");
    return raw && strcmp(raw, "1") == 0
        ? kMaxInvestigationDecodeSpeed
        : kMaxProductionDecodeSpeed;
}

bool SetCaptureDecodeSpeed(double speed) {
    if (!std::isfinite(speed) || speed < 1.0 || speed > CaptureDecodeSpeedLimit()) return false;
    g_capture_decode_speed.store(speed);
    return true;
}

double GetCaptureDecodeSpeed() {
    return g_capture_decode_speed.load();
}

// Investigation-only attribution state. In Spotify 1.3.0.277 the two
// ogg_stream_pagein() call sites inside DecodeAudioData pass decoder + 0x88 as
// the ogg_stream_state pointer. We still verify that invariant at runtime and
// never use thread identity as the stream identity.
static thread_local void* g_investigation_current_decoder = nullptr;
static thread_local bool g_investigation_eos_seen = false;
static constexpr uintptr_t kSpotify130277OggStateOffset = 0x88;
static constexpr size_t kMaxInvestigationStreams = 16;
static constexpr uint64_t kInvestigationStreamStaleMs = 5 * 60 * 1000;
static std::atomic<bool> g_investigation_context_layout_valid{false};
static std::atomic<uint64_t> g_investigation_stream_generation{0};
static std::mutex g_investigation_event_mutex;

static uint64_t InvestigationThreadId() {
    uint64_t tid = 0;
    pthread_threadid_np(nullptr, &tid);
    return tid;
}

static uint64_t InvestigationNowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

static uint64_t InvestigationWallMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

struct InvestigationFrameRecord {
    uintptr_t framePointer = 0;
    uintptr_t returnAddress = 0;
};

static int InvestigationCaptureFrameRecords(
    InvestigationFrameRecord* records,
    int capacity
) {
    if (!records || capacity <= 0) return 0;
    pthread_t thread = pthread_self();
    const uintptr_t stackTop = reinterpret_cast<uintptr_t>(
        pthread_get_stackaddr_np(thread));
    const size_t stackSize = pthread_get_stacksize_np(thread);
    const uintptr_t stackBottom =
        stackTop >= stackSize ? stackTop - stackSize : 0;
    uintptr_t framePointer = reinterpret_cast<uintptr_t>(
        __builtin_frame_address(0));
    int count = 0;
    while (count < capacity &&
           framePointer >= stackBottom &&
           framePointer + 2 * sizeof(uintptr_t) <= stackTop &&
           (framePointer % alignof(uintptr_t)) == 0) {
        const uintptr_t previous =
            *reinterpret_cast<const uintptr_t*>(framePointer);
        const uintptr_t returnAddress =
            *reinterpret_cast<const uintptr_t*>(
                framePointer + sizeof(uintptr_t));
        records[count++] = InvestigationFrameRecord{
            framePointer, returnAddress};
        if (previous <= framePointer ||
            previous < stackBottom ||
            previous + 2 * sizeof(uintptr_t) > stackTop) {
            break;
        }
        framePointer = previous;
    }
    return count;
}

struct InvestigationOggKey {
    uintptr_t decoder = 0;
    uintptr_t os = 0;
    uint32_t serial = 0;

    bool operator==(const InvestigationOggKey& other) const {
        return decoder == other.decoder && os == other.os && serial == other.serial;
    }
};

struct InvestigationOggKeyHash {
    size_t operator()(const InvestigationOggKey& key) const {
        size_t h = std::hash<uintptr_t>{}(key.decoder);
        h ^= std::hash<uintptr_t>{}(key.os) + 0x9e3779b9 + (h << 6) + (h >> 2);
        h ^= std::hash<uint32_t>{}(key.serial) + 0x9e3779b9 + (h << 6) + (h >> 2);
        return h;
    }
};

struct InvestigationOggFile {
    std::ofstream stream;
    std::string path;
    uint64_t bytes = 0;
    uint64_t pages = 0;
    uint64_t generation = 0;
    uint64_t startedAtMs = 0;
    uint64_t lastPageAtMs = 0;
    uint64_t maxPageGapMs = 0;
};

static std::mutex g_investigation_ogg_mutex;
static std::unordered_map<InvestigationOggKey, InvestigationOggFile, InvestigationOggKeyHash>
    g_investigation_ogg_files;

struct InvestigationDecodeStats {
    uint64_t calls = 0;
    uint64_t firstAtMs = 0;
    uint64_t lastAtMs = 0;
    uint64_t maxCallGapMs = 0;
    uint64_t totalInputBytes = 0;
    uint64_t totalBytesRead = 0;
    uint64_t totalSamplesDecoded = 0;
};

static constexpr size_t kMaxInvestigationDecoders = 32;
static std::mutex g_investigation_decode_mutex;
static std::unordered_map<uintptr_t, InvestigationDecodeStats>
    g_investigation_decode_stats;

struct InvestigationDecodeInputFile {
    std::ofstream stream;
    std::string path;
    uint64_t bytes = 0;
};

static constexpr uint64_t kMaxInvestigationDecodeInputBytes =
    64ULL * 1024ULL * 1024ULL;
static std::mutex g_investigation_decode_input_mutex;
static std::unordered_map<uintptr_t, InvestigationDecodeInputFile>
    g_investigation_decode_input_files;

static bool InvestigationDecodeInputEnabled();

struct InvestigationNativeSourceSpan {
    const char* data = nullptr;
    uint64_t length = 0;
};

struct InvestigationNativeSourceState {
    uint64_t generation = 0;
    uintptr_t source = 0;
    uintptr_t owner = 0;
    uintptr_t parent = 0;
    uintptr_t higherContext = 0;
    uintptr_t decoder = 0;
    uint64_t createdAtMs = 0;
    uint64_t lastAtMs = 0;
    uint64_t initThreadId = 0;
    uint64_t peekCalls = 0;
    uint64_t consumeCalls = 0;
    uint64_t bytesOffered = 0;
    uint64_t bytesConsumed = 0;
    uint64_t resetCount = 0;
    uint8_t mode = 0;
    std::string fileId;
};

struct InvestigationRetiredSource {
    uint64_t generation = 0;
    uint64_t teardownAtMs = 0;
};

static constexpr uintptr_t kSpotify130277SourceOffset = 0x78;
static constexpr uintptr_t kSpotify130277DecoderOffset = 0x60;
static constexpr size_t kMaxInvestigationNativeSources = 16;
static std::atomic<uint64_t> g_investigation_source_generation{0};
static std::mutex g_investigation_source_mutex;
static std::unordered_map<uintptr_t, InvestigationNativeSourceState>
    g_investigation_native_sources;
static std::unordered_map<uintptr_t, InvestigationRetiredSource>
    g_investigation_retired_sources;
static std::atomic<uintptr_t> g_investigation_spotify_image_base{0};

struct InvestigationPendingSourceBinding {
    uint64_t generation = 0;
    uintptr_t source = 0;
    uint64_t threadId = 0;
    uint64_t identityScopeToken = 0;
    uintptr_t identityScopeSiteOffset = 0;
    void* frames[24] = {};
    int frameCount = 0;
    InvestigationFrameRecord frameRecords[24] = {};
    int frameRecordCount = 0;
};

static std::atomic<uint64_t> g_investigation_identity_scope_generation{0};
static thread_local uint64_t g_investigation_identity_scope_token = 0;
static thread_local uintptr_t g_investigation_identity_scope_site_offset = 0;
static thread_local InvestigationPendingSourceBinding
    g_investigation_pending_source_binding;

static void InvestigationIdentityScopeEnter(uintptr_t siteOffset) {
    g_investigation_identity_scope_token =
        g_investigation_identity_scope_generation.fetch_add(1) + 1;
    g_investigation_identity_scope_site_offset = siteOffset;
}

static uint64_t InvestigationCurrentIdentityScopeToken() {
    return g_investigation_identity_scope_token;
}

static uintptr_t InvestigationCurrentIdentityScopeSiteOffset() {
    return g_investigation_identity_scope_site_offset;
}

static void InvestigationIdentityScopeAEnterProbe(
    void*,
    DobbyRegisterContext*
) {
    InvestigationIdentityScopeEnter(0xc9cdd4);
}

static void InvestigationIdentityScopeBEnterProbe(
    void*,
    DobbyRegisterContext*
) {
    InvestigationIdentityScopeEnter(0x656d1c);
}

using InvestigationSourceInitFn = uintptr_t (*)(void*, uint8_t);
using InvestigationSourcePeekFn = InvestigationNativeSourceSpan (*)(void*);
using InvestigationSourceConsumeFn = uintptr_t (*)(void*, uint64_t);
using InvestigationSourceResetFn = uintptr_t (*)(void*, uintptr_t);
using InvestigationOwnerControlFn = uintptr_t (*)(void*, uintptr_t);
using InvestigationOwnerDestructorFn = uintptr_t (*)(void*);
using InvestigationCacheReadFn = uintptr_t (*)(void*);
using InvestigationHigherContextFn = uintptr_t (*)(void*);
using InvestigationPlaybackInfoBuilderFn = void (*)(void*, void*);
using InvestigationOwnerConstructorFn = uintptr_t (*)(
    void*, uintptr_t, uintptr_t, uintptr_t, uintptr_t,
    uintptr_t, uintptr_t, uintptr_t, uintptr_t);

static InvestigationSourceInitFn orig_InvestigationSourceInit = nullptr;
static InvestigationSourcePeekFn orig_InvestigationSourcePeek = nullptr;
static InvestigationSourceConsumeFn orig_InvestigationSourceConsume = nullptr;
static InvestigationSourceResetFn orig_InvestigationSourceReset = nullptr;
static InvestigationOwnerControlFn orig_InvestigationOwnerControl = nullptr;
static InvestigationOwnerDestructorFn orig_InvestigationOwnerDestructor = nullptr;
static InvestigationCacheReadFn orig_InvestigationCacheRead = nullptr;
static InvestigationHigherContextFn orig_InvestigationHigherContext = nullptr;
static InvestigationPlaybackInfoBuilderFn orig_InvestigationPlaybackInfoBuilder = nullptr;
static InvestigationOwnerConstructorFn orig_InvestigationOwnerConstructor = nullptr;

static thread_local std::string g_investigation_cache_file_id;
static thread_local uintptr_t g_investigation_cache_object = 0;
static thread_local uintptr_t g_investigation_constructing_owner = 0;
static thread_local std::string g_investigation_constructing_file_id;
static thread_local std::string g_investigation_context_file_id;
static thread_local uintptr_t g_investigation_higher_context = 0;
static std::atomic<uint64_t> g_investigation_owner_ctor_traces{0};

static void InvestigationResetDecodeInput() {
    if (!InvestigationDecodeInputEnabled()) return;
    std::lock_guard<std::mutex> lock(g_investigation_decode_input_mutex);
    for (auto& [_, file] : g_investigation_decode_input_files) {
        if (file.stream.is_open()) {
            file.stream.flush();
            file.stream.close();
        }
    }
    g_investigation_decode_input_files.clear();
}

static bool InvestigationOggRequested() {
    static const bool requested = [] {
        const char* value = std::getenv("SOGGFY_INVESTIGATE_OGG_CONTEXT");
        return value && value[0] != '\0' && strcmp(value, "0") != 0;
    }();
    return requested;
}

static bool InvestigationOggEnabled() {
    return InvestigationOggRequested() && g_investigation_context_layout_valid.load();
}

static bool InvestigationDecodeInputEnabled() {
    static const bool requested = [] {
        const char* value = std::getenv("SOGGFY_INVESTIGATE_DECODE_INPUT");
        return value && value[0] != '\0' && strcmp(value, "0") != 0;
    }();
    return requested && InvestigationOggEnabled();
}

static bool InvestigationNativeSourceEnabled() {
    static const bool requested = [] {
        const char* value = std::getenv("SOGGFY_INVESTIGATE_NATIVE_SOURCE");
        return value && value[0] != '\0' && strcmp(value, "0") != 0;
    }();
    return requested && InvestigationOggEnabled();
}

static std::filesystem::path InvestigationBasePath() {
    const char* save = std::getenv("SOGGFY_SAVE_PATH");
    return std::filesystem::path(save && save[0] ? save : "/tmp/Soggfy_cli") /
        "investigation-ogg-context";
}

static void InvestigationAppendEvent(
    const char* event,
    const InvestigationOggKey& key,
    const InvestigationOggFile* file,
    bool relationOk
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"" << event << "\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"decoder\":\"0x" << std::hex << key.decoder << "\""
        << ",\"oggState\":\"0x" << std::hex << key.os << "\""
        << ",\"serial\":\"0x" << std::hex << key.serial << "\""
        << std::dec
        << ",\"decoderToOggOffset\":"
        << (key.os >= key.decoder ? key.os - key.decoder : 0)
        << ",\"relationOk\":" << (relationOk ? "true" : "false");
    if (file) {
        out << ",\"path\":\"" << file->path << "\""
            << ",\"generation\":" << file->generation
            << ",\"bytes\":" << file->bytes
            << ",\"pages\":" << file->pages
            << ",\"startedAtMs\":" << file->startedAtMs
            << ",\"lastPageAtMs\":" << file->lastPageAtMs
            << ",\"maxPageGapMs\":" << file->maxPageGapMs;
    }
    out << "}\n";
}

static void InvestigationAppendDecodeEvent(
    const char* event,
    uintptr_t decoder,
    const InvestigationDecodeStats& stats,
    uintptr_t sampleBuffer,
    uintptr_t sampleCountPtr,
    size_t sampleCapacityBefore,
    size_t samplesDecoded,
    uintptr_t encodedBuffer,
    uintptr_t encodedSizePtr,
    size_t encodedAvailableBefore,
    size_t encodedRead,
    int flags,
    void* const* frames,
    int frameCount
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"" << event << "\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"decoder\":\"0x" << std::hex << decoder << "\""
        << ",\"sampleBuffer\":\"0x" << sampleBuffer << "\""
        << ",\"sampleCountPtr\":\"0x" << sampleCountPtr << "\""
        << ",\"encodedBuffer\":\"0x" << encodedBuffer << "\""
        << ",\"encodedSizePtr\":\"0x" << encodedSizePtr << "\""
        << std::dec
        << ",\"flags\":" << flags
        << ",\"sampleCapacityBefore\":" << sampleCapacityBefore
        << ",\"samplesDecoded\":" << samplesDecoded
        << ",\"encodedAvailableBefore\":" << encodedAvailableBefore
        << ",\"encodedRead\":" << encodedRead
        << ",\"calls\":" << stats.calls
        << ",\"firstAtMs\":" << stats.firstAtMs
        << ",\"lastAtMs\":" << stats.lastAtMs
        << ",\"maxCallGapMs\":" << stats.maxCallGapMs
        << ",\"totalInputBytes\":" << stats.totalInputBytes
        << ",\"totalBytesRead\":" << stats.totalBytesRead
        << ",\"totalSamplesDecoded\":" << stats.totalSamplesDecoded;
    if (frames && frameCount > 0) {
        out << ",\"stack\":[";
        for (int i = 0; i < frameCount; ++i) {
            if (i != 0) out << ",";
            out << "\"0x" << std::hex
                << reinterpret_cast<uintptr_t>(frames[i]) << "\""
                << std::dec;
        }
        out << "]";
    }
    out << "}\n";
}

static void InvestigationAppendNativeSourceEvent(
    const char* event,
    const InvestigationNativeSourceState& state,
    uint64_t offeredBytes = 0,
    uint64_t consumedBytes = 0,
    uintptr_t data = 0
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"" << event << "\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"sourceGeneration\":" << state.generation
        << ",\"source\":\"0x" << std::hex << state.source << "\""
        << ",\"owner\":\"0x" << state.owner << "\""
        << ",\"parent\":\"0x" << state.parent << "\""
        << ",\"higherContext\":\"0x" << state.higherContext << "\""
        << ",\"decoder\":\"0x" << state.decoder << "\""
        << ",\"data\":\"0x" << data << "\""
        << std::dec
        << ",\"mode\":" << static_cast<unsigned>(state.mode)
        << ",\"createdAtMs\":" << state.createdAtMs
        << ",\"lastAtMs\":" << state.lastAtMs
        << ",\"initThreadId\":" << state.initThreadId
        << ",\"peekCalls\":" << state.peekCalls
        << ",\"consumeCalls\":" << state.consumeCalls
        << ",\"bytesOffered\":" << state.bytesOffered
        << ",\"bytesConsumed\":" << state.bytesConsumed
        << ",\"resetCount\":" << state.resetCount
        << ",\"offeredBytes\":" << offeredBytes
        << ",\"consumedBytes\":" << consumedBytes;
    if (!state.fileId.empty()) {
        out << ",\"fileId\":\"" << state.fileId << "\"";
    }
    out << "}\n";
}

static uintptr_t InvestigationDecoderForSource(uintptr_t source) {
    if (source < kSpotify130277SourceOffset) return 0;
    const uintptr_t owner = source - kSpotify130277SourceOffset;
    return *reinterpret_cast<const uintptr_t*>(
        owner + kSpotify130277DecoderOffset);
}

static InvestigationNativeSourceState InvestigationNewNativeSourceState(
    uintptr_t source,
    uint8_t mode
) {
    InvestigationNativeSourceState state;
    state.generation = g_investigation_source_generation.fetch_add(1) + 1;
    state.source = source;
    state.owner = source >= kSpotify130277SourceOffset
        ? source - kSpotify130277SourceOffset
        : 0;
    state.decoder = InvestigationDecoderForSource(source);
    state.higherContext = g_investigation_higher_context;
    state.createdAtMs = InvestigationNowMs();
    state.lastAtMs = state.createdAtMs;
    state.initThreadId = InvestigationThreadId();
    state.mode = mode;
    if (state.owner != 0 &&
        state.owner == g_investigation_constructing_owner &&
        !g_investigation_constructing_file_id.empty()) {
        state.fileId = g_investigation_constructing_file_id;
    }
    return state;
}

static std::string InvestigationFileIdHex(uintptr_t object) {
    if (!object) return {};
    static constexpr char hex[] = "0123456789abcdef";
    const auto* bytes = reinterpret_cast<const uint8_t*>(object + 0x28);
    std::string result(40, '0');
    for (size_t i = 0; i < 20; ++i) {
        result[i * 2] = hex[bytes[i] >> 4];
        result[i * 2 + 1] = hex[bytes[i] & 0x0f];
    }
    return result;
}

static void InvestigationAppendIdentityEvent(
    const char* event,
    const std::string& fileId,
    uintptr_t wrapper,
    uintptr_t object,
    uintptr_t owner
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"" << event << "\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"wrapper\":\"0x" << std::hex << wrapper << "\""
        << ",\"object\":\"0x" << object << "\""
        << ",\"owner\":\"0x" << owner << "\""
        << std::dec
        << ",\"fileId\":\"" << fileId << "\""
        << "}\n";
}

struct InvestigationFileIdMatch {
    std::string fileId;
    size_t offset = 0;
    bool asciiHex = false;
};

struct InvestigationAudioIdMatch {
    std::string audioId;
    std::string fileId;
    size_t offset = 0;
    bool asciiHex = false;
};

static std::optional<InvestigationFileIdMatch>
InvestigationFindCanonicalFileId(uintptr_t base, size_t length) {
    if (!base || length < 20) return std::nullopt;
    struct FixtureId {
        const char* hex;
        uint8_t raw[20];
    };
    static const FixtureId ids[] = {
        {"56bc9ef82236dc30d6f31d8125fc311b3c2442b9",
         {0x56,0xbc,0x9e,0xf8,0x22,0x36,0xdc,0x30,0xd6,0xf3,
          0x1d,0x81,0x25,0xfc,0x31,0x1b,0x3c,0x24,0x42,0xb9}},
        {"f38702bf00c1b1271576c399dbc5713f2412132a",
         {0xf3,0x87,0x02,0xbf,0x00,0xc1,0xb1,0x27,0x15,0x76,
          0xc3,0x99,0xdb,0xc5,0x71,0x3f,0x24,0x12,0x13,0x2a}},
        {"6c3230af2542446176eb71f54ed0c66000420ef8",
         {0x6c,0x32,0x30,0xaf,0x25,0x42,0x44,0x61,0x76,0xeb,
          0x71,0xf5,0x4e,0xd0,0xc6,0x60,0x00,0x42,0x0e,0xf8}},
    };

    const auto* bytes = reinterpret_cast<const uint8_t*>(base);
    for (const auto& id : ids) {
        for (size_t i = 0; i + 20 <= length; ++i) {
            if (memcmp(bytes + i, id.raw, 20) == 0) {
                return InvestigationFileIdMatch{id.hex, i, false};
            }
        }
        for (size_t i = 0; i + 40 <= length; ++i) {
            if (memcmp(bytes + i, id.hex, 40) == 0) {
                return InvestigationFileIdMatch{id.hex, i, true};
            }
        }
    }
    return std::nullopt;
}

static std::optional<InvestigationAudioIdMatch>
InvestigationFindCanonicalAudioId(uintptr_t base, size_t length) {
    if (!base || length < 16) return std::nullopt;
    struct FixtureAudioId {
        const char* audioHex;
        const char* fileHex;
        uint8_t raw[16];
    };
    static const FixtureAudioId ids[] = {
        {"e9fcfea33c054f48b0b32f44f9c0fee9",
         "56bc9ef82236dc30d6f31d8125fc311b3c2442b9",
         {0xe9,0xfc,0xfe,0xa3,0x3c,0x05,0x4f,0x48,
          0xb0,0xb3,0x2f,0x44,0xf9,0xc0,0xfe,0xe9}},
        {"4141d33192574b3ab8ff399ab82c0aea",
         "f38702bf00c1b1271576c399dbc5713f2412132a",
         {0x41,0x41,0xd3,0x31,0x92,0x57,0x4b,0x3a,
          0xb8,0xff,0x39,0x9a,0xb8,0x2c,0x0a,0xea}},
    };
    const auto* bytes = reinterpret_cast<const uint8_t*>(base);
    for (const auto& id : ids) {
        for (size_t i = 0; i + 16 <= length; ++i) {
            if (memcmp(bytes + i, id.raw, 16) == 0) {
                return InvestigationAudioIdMatch{
                    id.audioHex, id.fileHex, i, false};
            }
        }
        for (size_t i = 0; i + 32 <= length; ++i) {
            if (memcmp(bytes + i, id.audioHex, 32) == 0) {
                return InvestigationAudioIdMatch{
                    id.audioHex, id.fileHex, i, true};
            }
        }
    }
    return std::nullopt;
}

static void InvestigationAppendOwnerFileMatch(
    uintptr_t owner,
    const InvestigationFileIdMatch& match
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"owner_contains_file_id\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"owner\":\"0x" << std::hex << owner << "\""
        << std::dec
        << ",\"offset\":" << match.offset
        << ",\"asciiHex\":" << (match.asciiHex ? "true" : "false")
        << ",\"fileId\":\"" << match.fileId << "\""
        << "}\n";
}

static void InvestigationAppendAudioIdMatch(
    uintptr_t object,
    const InvestigationAudioIdMatch& match
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"native_contains_audio_id\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"object\":\"0x" << std::hex << object << "\""
        << std::dec
        << ",\"offset\":" << match.offset
        << ",\"asciiHex\":" << (match.asciiHex ? "true" : "false")
        << ",\"audioId\":\"" << match.audioId << "\""
        << ",\"fileId\":\"" << match.fileId << "\""
        << "}\n";
}

static void InvestigationScanDependency(
    const char* role,
    uintptr_t object
) {
    if (!object) return;
    const size_t allocationSize =
        malloc_size(reinterpret_cast<const void*>(object));
    const size_t scanLength = std::min<size_t>(allocationSize, 0x2000);
    const uintptr_t vtable = allocationSize >= sizeof(uintptr_t)
        ? *reinterpret_cast<const uintptr_t*>(object)
        : 0;
    const auto fileMatch = scanLength >= 20
        ? InvestigationFindCanonicalFileId(object, scanLength)
        : std::nullopt;
    const auto audioMatch = scanLength >= 16
        ? InvestigationFindCanonicalAudioId(object, scanLength)
        : std::nullopt;

    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"source_dependency_scan\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"role\":\"" << role << "\""
        << ",\"object\":\"0x" << std::hex << object << "\""
        << ",\"vtable\":\"0x" << vtable << "\""
        << std::dec
        << ",\"allocationSize\":" << allocationSize
        << ",\"scanLength\":" << scanLength;
    if (fileMatch) {
        out << ",\"fileId\":\"" << fileMatch->fileId << "\""
            << ",\"fileIdOffset\":" << fileMatch->offset
            << ",\"fileIdAsciiHex\":"
            << (fileMatch->asciiHex ? "true" : "false");
    }
    if (audioMatch) {
        out << ",\"audioId\":\"" << audioMatch->audioId << "\""
            << ",\"audioIdFileId\":\"" << audioMatch->fileId << "\""
            << ",\"audioIdOffset\":" << audioMatch->offset
            << ",\"audioIdAsciiHex\":"
            << (audioMatch->asciiHex ? "true" : "false");
    }
    if (strcmp(role, "parent+0xf0") == 0 && scanLength >= 8) {
        out << ",\"qwords\":[";
        const size_t qwordCount = scanLength / sizeof(uintptr_t);
        for (size_t i = 0; i < qwordCount; ++i) {
            if (i != 0) out << ",";
            out << "\"0x" << std::hex
                << *reinterpret_cast<const uintptr_t*>(
                    object + i * sizeof(uintptr_t))
                << "\"";
        }
        out << std::dec << "]";
    }
    out << "}\n";
}

static std::string InvestigationHex(const uint8_t* bytes, size_t length) {
    static constexpr char hex[] = "0123456789abcdef";
    std::string result(length * 2, '0');
    for (size_t i = 0; i < length; ++i) {
        result[i * 2] = hex[bytes[i] >> 4];
        result[i * 2 + 1] = hex[bytes[i] & 0x0f];
    }
    return result;
}

static void InvestigationAppendPlaybackInfoDescriptor(
    uintptr_t metadata,
    uintptr_t descriptor,
    uintptr_t fileIdAddress,
    uint32_t format,
    const std::string& fileId
) {
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"playback_info_file_descriptor\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"metadata\":\"0x" << std::hex << metadata << "\""
        << ",\"descriptor\":\"0x" << descriptor << "\""
        << ",\"fileIdAddress\":\"0x" << fileIdAddress << "\""
        << std::dec
        << ",\"format\":" << format
        << ",\"fileId\":\"" << fileId << "\""
        << "}\n";
}

static std::string InvestigationReadLibCppString(uintptr_t stringObject) {
    if (!stringObject) return {};
    const int8_t marker =
        *reinterpret_cast<const int8_t*>(stringObject + 0x17);
    const size_t length = marker < 0
        ? *reinterpret_cast<const size_t*>(stringObject + 0x8)
        : static_cast<size_t>(marker);
    if (length == 0 || length > 96) return {};
    const uintptr_t data = marker < 0
        ? *reinterpret_cast<const uintptr_t*>(stringObject)
        : stringObject;
    if (!data) return {};
    return std::string(reinterpret_cast<const char*>(data), length);
}

static void InvestigationPlaybackSnapshotProbe(
    void*,
    DobbyRegisterContext* ctx
) {
    if (!InvestigationNativeSourceEnabled() || !ctx) return;
    const uintptr_t snapshot = ctx->general.regs.x1;
    if (!snapshot) return;

    struct StringField {
        size_t offset;
        bool cStringPointer;
    };
    static constexpr StringField fields[] = {
        {0x98, false},
        {0xb0, false},
        {0xc8, false},
        {0xe0, false},
        {0xf8, false},
        {0x128, true},
    };

    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"playback_info_snapshot\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"snapshot\":\"0x" << std::hex << snapshot << "\""
        << std::dec << ",\"fields\":[";
    bool first = true;
    for (const auto& field : fields) {
        uintptr_t data = 0;
        size_t length = 0;
        if (field.cStringPointer) {
            data = *reinterpret_cast<const uintptr_t*>(
                snapshot + field.offset);
            if (data) {
                length = strnlen(
                    reinterpret_cast<const char*>(data), 512);
            }
        } else {
            const uintptr_t stringObject = snapshot + field.offset;
            const int8_t marker =
                *reinterpret_cast<const int8_t*>(stringObject + 0x17);
            length = marker < 0
                ? *reinterpret_cast<const size_t*>(stringObject + 0x8)
                : static_cast<size_t>(marker);
            data = marker < 0
                ? *reinterpret_cast<const uintptr_t*>(stringObject)
                : stringObject;
        }
        if (length > 512) length = 0;
        if (!first) out << ",";
        first = false;
        out << "{\"offset\":" << field.offset
            << ",\"data\":\"0x" << std::hex << data << "\""
            << std::dec << ",\"length\":" << length;
        if (data && length) {
            const size_t sampleLength = std::min<size_t>(length, 96);
            out << ",\"valueHex\":\""
                << InvestigationHex(
                    reinterpret_cast<const uint8_t*>(data),
                    sampleLength)
                << "\"";
        }
        out << "}";
    }
    out << "]}\n";
}

static void InvestigationPlaybackServiceDispatchProbe(
    void*,
    DobbyRegisterContext* ctx
) {
    if (!InvestigationNativeSourceEnabled() || !ctx) return;
    const uintptr_t service = ctx->general.regs.x0;
    const uintptr_t request = ctx->general.regs.x1;
    if (!service || !request) return;

    const std::string method =
        InvestigationReadLibCppString(request + 0x18);
    if (method != "GetPlaybackInfo" && method != "SubPlaybackInfo") return;

    const uintptr_t vtable =
        *reinterpret_cast<const uintptr_t*>(service);
    if (!vtable) return;
    const uintptr_t subTarget =
        *reinterpret_cast<const uintptr_t*>(vtable + 0x38);
    const uintptr_t getTarget =
        *reinterpret_cast<const uintptr_t*>(vtable + 0x80);

    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"playback_service_dispatch\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"method\":\"" << method << "\""
        << ",\"service\":\"0x" << std::hex << service << "\""
        << ",\"vtable\":\"0x" << vtable << "\""
        << ",\"subTarget\":\"0x" << subTarget << "\""
        << ",\"getTarget\":\"0x" << getTarget << "\""
        << ",\"x2\":\"0x" << ctx->general.regs.x2 << "\""
        << ",\"x8\":\"0x" << ctx->general.regs.x8 << "\""
        << std::dec << "}\n";
}

static int64_t InvestigationPointerOffset(
    uintptr_t base,
    size_t length,
    uintptr_t target
) {
    if (!base || !target || length < sizeof(uintptr_t)) return -1;
    for (size_t offset = 0; offset + sizeof(uintptr_t) <= length;
         offset += sizeof(uintptr_t)) {
        if (*reinterpret_cast<const uintptr_t*>(base + offset) == target) {
            return static_cast<int64_t>(offset);
        }
    }
    return -1;
}

static void InvestigationPlaybackGetInfoProbe(
    void*,
    DobbyRegisterContext* ctx
) {
    if (!InvestigationNativeSourceEnabled() || !ctx) return;
    const uintptr_t service = ctx->general.regs.x0;
    if (!service) return;
    const uintptr_t backend =
        *reinterpret_cast<const uintptr_t*>(service + 0x28);
    if (!backend) return;

    std::vector<InvestigationNativeSourceState> states;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        states.reserve(g_investigation_native_sources.size());
        for (const auto& [_, state] : g_investigation_native_sources) {
            states.push_back(state);
        }
    }

    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    for (const auto& state : states) {
        out << "{\"event\":\"playback_backend_source_relation\""
            << ",\"tsMs\":" << InvestigationNowMs()
            << ",\"wallMs\":" << InvestigationWallMs()
            << ",\"threadId\":" << InvestigationThreadId()
            << ",\"pid\":" << static_cast<int>(getpid())
            << ",\"sourceGeneration\":" << state.generation
            << ",\"service\":\"0x" << std::hex << service << "\""
            << ",\"backend\":\"0x" << backend << "\""
            << ",\"source\":\"0x" << state.source << "\""
            << ",\"owner\":\"0x" << state.owner << "\""
            << ",\"parent\":\"0x" << state.parent << "\""
            << ",\"higherContext\":\"0x" << state.higherContext << "\""
            << std::dec
            << ",\"backendInOwner\":"
            << InvestigationPointerOffset(state.owner, 0x6c8, backend)
            << ",\"backendInParent\":"
            << InvestigationPointerOffset(state.parent, 0x118, backend)
            << ",\"backendInHigherContext\":"
            << InvestigationPointerOffset(state.higherContext, 0x6a8, backend)
            << ",\"ownerInBackend\":"
            << InvestigationPointerOffset(backend, 0x168, state.owner)
            << ",\"parentInBackend\":"
            << InvestigationPointerOffset(backend, 0x168, state.parent)
            << ",\"higherContextInBackend\":"
            << InvestigationPointerOffset(
                backend, 0x168, state.higherContext)
            << "}\n";
    }
}

static void InvestigationPlaybackBackendAssignProbe(
    void*,
    DobbyRegisterContext* ctx
) {
    if (!InvestigationNativeSourceEnabled() || !ctx) return;
    static std::atomic<uint64_t> eventCount{0};
    const uint64_t ordinal = eventCount.fetch_add(1);
    if (ordinal >= 64) return;

    const uintptr_t destination = ctx->general.regs.x0;
    const uintptr_t source = ctx->general.regs.x1;
    if (!destination || !source) return;
    if (*reinterpret_cast<const uint8_t*>(source + 0x160) != 1) return;

    const std::string fileId =
        InvestigationReadLibCppString(source + 0xb0);
    const std::string audioId =
        InvestigationReadLibCppString(source + 0xc8);
    if (fileId.empty() && audioId.empty()) return;

    void* frames[24] = {};
    const int frameCount = backtrace(frames, 24);
    InvestigationFrameRecord frameRecords[24] = {};
    const int frameRecordCount = InvestigationCaptureFrameRecords(
        frameRecords,
        static_cast<int>(std::size(frameRecords)));

    uint64_t pendingGeneration = 0;
    uintptr_t pendingSource = 0;
    uintptr_t sharedCaller = 0;
    uintptr_t sharedFramePointer = 0;
    uint64_t pendingThreadId = 0;
    const auto pending = g_investigation_pending_source_binding;
    const uint64_t currentThreadId = InvestigationThreadId();
    const uint64_t currentIdentityScopeToken =
        InvestigationCurrentIdentityScopeToken();
    const uintptr_t currentIdentityScopeSiteOffset =
        InvestigationCurrentIdentityScopeSiteOffset();
    const bool sameIdentityScope =
        pending.identityScopeToken != 0 &&
        pending.identityScopeToken == currentIdentityScopeToken &&
        pending.identityScopeSiteOffset ==
            currentIdentityScopeSiteOffset;
    if (pending.generation != 0 &&
        pending.source != 0 &&
        pending.threadId == currentThreadId &&
        sameIdentityScope) {
        bool validPending = false;
        {
            std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
            auto it = g_investigation_native_sources.find(pending.source);
            validPending =
                it != g_investigation_native_sources.end() &&
                it->second.generation == pending.generation &&
                it->second.fileId.empty();
        }
        if (validPending) {
            const uintptr_t imageBase =
                g_investigation_spotify_image_base.load();
            constexpr uintptr_t kSpotify130277TextSpan = 0x24b4000;
            for (int i = 0;
                 i < pending.frameRecordCount && sharedCaller == 0;
                 ++i) {
                const auto& candidate = pending.frameRecords[i];
                if (!imageBase ||
                    candidate.returnAddress < imageBase ||
                    candidate.returnAddress >=
                        imageBase + kSpotify130277TextSpan) {
                    continue;
                }
                for (int j = 0; j < frameRecordCount; ++j) {
                    if (candidate.returnAddress ==
                            frameRecords[j].returnAddress &&
                        candidate.framePointer ==
                            frameRecords[j].framePointer) {
                        sharedCaller = candidate.returnAddress;
                        sharedFramePointer = candidate.framePointer;
                        break;
                    }
                }
            }
            if (sharedCaller != 0) {
                pendingGeneration = pending.generation;
                pendingSource = pending.source;
                pendingThreadId = pending.threadId;
            }
        }
    }

    InvestigationNativeSourceState boundSnapshot;
    bool sourceIdentityBound = false;
    if (pendingGeneration != 0) {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        auto it = g_investigation_native_sources.find(pendingSource);
        const bool generationLive =
            it != g_investigation_native_sources.end() &&
            it->second.generation == pendingGeneration;
        const bool alreadyBound =
            generationLive && !it->second.fileId.empty();
        NativeSourceIdentityBindingInputs bindingInput;
        bindingInput.pendingGeneration = pending.generation;
        bindingInput.pendingSource = pending.source;
        bindingInput.pendingThreadId = pending.threadId;
        bindingInput.pendingScopeToken = pending.identityScopeToken;
        bindingInput.pendingScopeSiteOffset =
            pending.identityScopeSiteOffset;
        bindingInput.currentThreadId = currentThreadId;
        bindingInput.currentScopeToken = currentIdentityScopeToken;
        bindingInput.currentScopeSiteOffset =
            currentIdentityScopeSiteOffset;
        bindingInput.generationLive = generationLive;
        bindingInput.alreadyBound = alreadyBound;
        bindingInput.sharedCallFrame = sharedCaller != 0;
        bindingInput.fileId = fileId;
        if (CanBindExactNativeSourceIdentity(bindingInput)) {
            it->second.fileId = fileId;
            boundSnapshot = it->second;
            sourceIdentityBound = true;
        }
    }
    if (sourceIdentityBound) {
        InvestigationAppendNativeSourceEvent(
            "source_identity_bound", boundSnapshot);
    }

    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"playback_backend_assign\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"ordinal\":" << ordinal
        << ",\"destination\":\"0x" << std::hex << destination << "\""
        << ",\"source\":\"0x" << source << "\""
        << std::dec;
    if (!fileId.empty()) {
        out << ",\"fileId\":\"" << fileId << "\"";
    }
    if (!audioId.empty()) {
        out << ",\"audioId\":\"" << audioId << "\"";
    }
    if (pendingGeneration != 0) {
        const uintptr_t imageBase =
            g_investigation_spotify_image_base.load();
        out << ",\"pendingSourceGeneration\":" << pendingGeneration
            << ",\"pendingSource\":\"0x" << std::hex << pendingSource << "\""
            << ",\"pendingThreadId\":" << std::dec << pendingThreadId
            << ",\"identityScopeToken\":" << pending.identityScopeToken
            << ",\"identityScopeSiteOffset\":\"0x" << std::hex
            << pending.identityScopeSiteOffset << "\""
            << ",\"sharedCaller\":\"0x" << std::hex << sharedCaller << "\""
            << ",\"sharedFramePointer\":\"0x" << sharedFramePointer << "\""
            << ",\"sharedCallerOffset\":\"0x"
            << (imageBase && sharedCaller >= imageBase
                ? sharedCaller - imageBase
                : 0)
            << "\"" << std::dec;
        g_investigation_pending_source_binding =
            InvestigationPendingSourceBinding{};
    }
    out << ",\"stack\":[";
    for (int i = 0; i < frameCount; ++i) {
        if (i != 0) out << ",";
        out << "\"0x" << std::hex
            << reinterpret_cast<uintptr_t>(frames[i]) << "\"";
    }
    out << std::dec << "]}\n";
}

static void InvestigationSourcePublishHandleProbe(
    void*,
    DobbyRegisterContext* ctx
) {
    if (!InvestigationNativeSourceEnabled() || !ctx) return;
    const uintptr_t handleSlot = ctx->general.regs.x1;
    if (!handleSlot) return;
    const uintptr_t handle =
        *reinterpret_cast<const uintptr_t*>(handleSlot);
    if (!handle) return;

    const size_t allocationSize =
        malloc_size(reinterpret_cast<const void*>(handle));
    const size_t scanLength = std::min<size_t>(allocationSize, 0x2000);
    const uintptr_t vtable = allocationSize >= sizeof(uintptr_t)
        ? *reinterpret_cast<const uintptr_t*>(handle)
        : 0;

    std::vector<InvestigationNativeSourceState> states;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        states.reserve(g_investigation_native_sources.size());
        for (const auto& [_, state] : g_investigation_native_sources) {
            states.push_back(state);
        }
    }

    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    for (const auto& state : states) {
        out << "{\"event\":\"source_publish_handle_relation\""
            << ",\"tsMs\":" << InvestigationNowMs()
            << ",\"wallMs\":" << InvestigationWallMs()
            << ",\"threadId\":" << InvestigationThreadId()
            << ",\"pid\":" << static_cast<int>(getpid())
            << ",\"sourceGeneration\":" << state.generation
            << ",\"handleSlot\":\"0x" << std::hex << handleSlot << "\""
            << ",\"handle\":\"0x" << handle << "\""
            << ",\"vtable\":\"0x" << vtable << "\""
            << ",\"source\":\"0x" << state.source << "\""
            << ",\"owner\":\"0x" << state.owner << "\""
            << ",\"parent\":\"0x" << state.parent << "\""
            << ",\"higherContext\":\"0x" << state.higherContext << "\""
            << std::dec
            << ",\"allocationSize\":" << allocationSize
            << ",\"sourceOffset\":"
            << InvestigationPointerOffset(handle, scanLength, state.source)
            << ",\"ownerOffset\":"
            << InvestigationPointerOffset(handle, scanLength, state.owner)
            << ",\"parentOffset\":"
            << InvestigationPointerOffset(handle, scanLength, state.parent)
            << ",\"higherContextOffset\":"
            << InvestigationPointerOffset(
                handle, scanLength, state.higherContext)
            << "}\n";
    }
}

static void InvestigationTransitionSourceResultProbe(
    void*,
    DobbyRegisterContext* ctx
) {
    if (!InvestigationNativeSourceEnabled() || !ctx) return;
    const uintptr_t controller = ctx->general.regs.x19;
    const uintptr_t result =
        *reinterpret_cast<const uintptr_t*>(ctx->sp + 0x30);
    if (!controller || !result) return;

    std::vector<InvestigationNativeSourceState> states;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        for (const auto& [_, state] : g_investigation_native_sources) {
            states.push_back(state);
        }
    }
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    for (const auto& state : states) {
        out << "{\"event\":\"transition_source_result_relation\""
            << ",\"tsMs\":" << InvestigationNowMs()
            << ",\"wallMs\":" << InvestigationWallMs()
            << ",\"threadId\":" << InvestigationThreadId()
            << ",\"pid\":" << static_cast<int>(getpid())
            << ",\"sourceGeneration\":" << state.generation
            << ",\"controller\":\"0x" << std::hex << controller << "\""
            << ",\"result\":\"0x" << result << "\""
            << ",\"higherContext\":\"0x" << state.higherContext << "\""
            << std::dec
            << ",\"matchesHigherContext\":"
            << (result == state.higherContext ? "true" : "false")
            << "}\n";
    }
}

static void InvestigationTransitionPublishProbe(
    void*,
    DobbyRegisterContext* ctx
) {
    if (!InvestigationNativeSourceEnabled() || !ctx) return;
    const uintptr_t interior = ctx->general.regs.x0;
    if (interior < 0xec0) return;
    const uintptr_t controller = interior - 0xec0;
    const size_t allocationSize =
        malloc_size(reinterpret_cast<const void*>(controller));
    if (allocationSize < 0xec0 + sizeof(uintptr_t)) return;
    const uintptr_t sourceContext =
        *reinterpret_cast<const uintptr_t*>(controller + 0x3d0);

    std::vector<InvestigationNativeSourceState> states;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        for (const auto& [_, state] : g_investigation_native_sources) {
            states.push_back(state);
        }
    }
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    for (const auto& state : states) {
        out << "{\"event\":\"transition_publish_relation\""
            << ",\"tsMs\":" << InvestigationNowMs()
            << ",\"wallMs\":" << InvestigationWallMs()
            << ",\"threadId\":" << InvestigationThreadId()
            << ",\"pid\":" << static_cast<int>(getpid())
            << ",\"sourceGeneration\":" << state.generation
            << ",\"controller\":\"0x" << std::hex << controller << "\""
            << ",\"sourceContext\":\"0x" << sourceContext << "\""
            << ",\"higherContext\":\"0x" << state.higherContext << "\""
            << std::dec
            << ",\"allocationSize\":" << allocationSize
            << ",\"matchesHigherContext\":"
            << (sourceContext == state.higherContext ? "true" : "false")
            << "}\n";
    }
}

static void InvestigationAppendOwnerCtorTrace(
    uintptr_t owner,
    const uintptr_t* args,
    size_t argCount
) {
    const uint64_t ordinal = g_investigation_owner_ctor_traces.fetch_add(1);
    if (ordinal >= 8) return;
    void* frames[16] = {};
    const int frameCount = backtrace(frames, 16);
    const auto base = InvestigationBasePath();
    std::error_code ec;
    std::filesystem::create_directories(base, ec);
    std::lock_guard<std::mutex> eventLock(g_investigation_event_mutex);
    std::ofstream out(base / "events.jsonl", std::ios::app);
    if (!out.is_open()) return;
    out << "{\"event\":\"owner_ctor_trace\""
        << ",\"tsMs\":" << InvestigationNowMs()
        << ",\"wallMs\":" << InvestigationWallMs()
        << ",\"threadId\":" << InvestigationThreadId()
        << ",\"pid\":" << static_cast<int>(getpid())
        << ",\"ordinal\":" << ordinal
        << ",\"owner\":\"0x" << std::hex << owner << "\""
        << ",\"args\":[";
    for (size_t i = 0; i < argCount; ++i) {
        if (i != 0) out << ",";
        out << "\"0x" << args[i] << "\"";
    }
    out << "],\"stack\":[";
    for (int i = 0; i < frameCount; ++i) {
        if (i != 0) out << ",";
        out << "\"0x" << reinterpret_cast<uintptr_t>(frames[i]) << "\"";
    }
    out << "]}" << std::dec << "\n";
}

static void InvestigationCaptureDecodeInput(
    uintptr_t decoder,
    const char* encodedBuffer,
    size_t encodedRead
) {
    if (!InvestigationDecodeInputEnabled() || decoder == 0 ||
        !encodedBuffer || encodedRead == 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(g_investigation_decode_input_mutex);
    auto it = g_investigation_decode_input_files.find(decoder);
    if (it == g_investigation_decode_input_files.end()) {
        if (g_investigation_decode_input_files.size() >= kMaxInvestigationDecoders) {
            return;
        }
        const auto base = InvestigationBasePath();
        std::error_code ec;
        std::filesystem::create_directories(base, ec);
        InvestigationDecodeInputFile file;
        std::ostringstream name;
        name << "decode-input-0x" << std::hex << decoder << ".bin";
        file.path = (base / name.str()).string();
        file.stream.open(file.path, std::ios::binary | std::ios::trunc);
        if (!file.stream.is_open()) return;
        auto inserted = g_investigation_decode_input_files.emplace(
            decoder, std::move(file));
        it = inserted.first;
    }

    auto& file = it->second;
    if (!file.stream.is_open()) return;

    const uint64_t remaining =
        file.bytes < kMaxInvestigationDecodeInputBytes
            ? kMaxInvestigationDecodeInputBytes - file.bytes
            : 0;
    const size_t toWrite = static_cast<size_t>(
        std::min<uint64_t>(encodedRead, remaining));
    if (toWrite > 0) {
        file.stream.write(encodedBuffer, static_cast<std::streamsize>(toWrite));
        file.bytes += toWrite;
        file.stream.flush();
    }
    if (remaining <= encodedRead) {
        file.stream.flush();
        file.stream.close();
    }
}

static void InvestigationCaptureOggPage(
    void* decoder,
    void* os,
    uint32_t serial,
    bool isVorbisBos,
    bool isEos,
    const unsigned char* hdr,
    size_t hlen,
    const unsigned char* body,
    size_t blen
) {
    if (!InvestigationOggEnabled() || !decoder || !os || !hdr || hlen == 0) return;
    if (isEos) g_investigation_eos_seen = true;

    const uintptr_t decoderPtr = reinterpret_cast<uintptr_t>(decoder);
    const uintptr_t osPtr = reinterpret_cast<uintptr_t>(os);
    const bool relationOk = osPtr == decoderPtr + kSpotify130277OggStateOffset;
    InvestigationOggKey key{decoderPtr, osPtr, serial};

    std::lock_guard<std::mutex> lock(g_investigation_ogg_mutex);
    auto it = g_investigation_ogg_files.find(key);
    if (isVorbisBos) {
        const uint64_t now = InvestigationNowMs();
        for (auto stale = g_investigation_ogg_files.begin(); stale != g_investigation_ogg_files.end();) {
            if (now - stale->second.startedAtMs < kInvestigationStreamStaleMs) {
                ++stale;
                continue;
            }
            stale->second.stream.flush();
            stale->second.stream.close();
            InvestigationAppendEvent("stale", stale->first, &stale->second,
                stale->first.os == stale->first.decoder + kSpotify130277OggStateOffset);
            stale = g_investigation_ogg_files.erase(stale);
        }

        it = g_investigation_ogg_files.find(key);
        if (it != g_investigation_ogg_files.end()) {
            it->second.stream.flush();
            it->second.stream.close();
            InvestigationAppendEvent("replaced", key, &it->second, relationOk);
            g_investigation_ogg_files.erase(it);
        }

        if (g_investigation_ogg_files.size() >= kMaxInvestigationStreams) {
            auto oldest = std::min_element(
                g_investigation_ogg_files.begin(),
                g_investigation_ogg_files.end(),
                [](const auto& a, const auto& b) {
                    return a.second.startedAtMs < b.second.startedAtMs;
                });
            if (oldest != g_investigation_ogg_files.end()) {
                oldest->second.stream.flush();
                oldest->second.stream.close();
                InvestigationAppendEvent("evicted", oldest->first, &oldest->second,
                    oldest->first.os == oldest->first.decoder + kSpotify130277OggStateOffset);
                g_investigation_ogg_files.erase(oldest);
            }
        }

        const auto base = InvestigationBasePath();
        std::error_code ec;
        std::filesystem::create_directories(base / "streams", ec);

        const uint64_t generation = g_investigation_stream_generation.fetch_add(1) + 1;
        std::ostringstream name;
        name << "pid-" << getpid()
             << "-decoder-" << std::hex << decoderPtr
             << "-os-" << osPtr
             << "-serial-" << serial << std::dec
             << "-generation-" << generation << ".ogg";
        InvestigationOggFile capture;
        capture.path = (base / "streams" / name.str()).string();
        capture.generation = generation;
        capture.startedAtMs = now;
        capture.lastPageAtMs = now;
        capture.stream.open(capture.path, std::ios::binary | std::ios::trunc);
        if (capture.stream.is_open()) {
            auto [inserted, _] = g_investigation_ogg_files.insert_or_assign(
                key, std::move(capture));
            it = inserted;
            InvestigationAppendEvent("bos", key, &it->second, relationOk);
        }
    }

    if (it == g_investigation_ogg_files.end() || !it->second.stream.is_open()) return;
    it->second.stream.write(reinterpret_cast<const char*>(hdr), static_cast<std::streamsize>(hlen));
    if (body && blen > 0) {
        it->second.stream.write(reinterpret_cast<const char*>(body), static_cast<std::streamsize>(blen));
    }
    it->second.bytes += hlen + blen;
    it->second.pages += 1;
    const uint64_t pageNow = InvestigationNowMs();
    if (it->second.lastPageAtMs != 0 && pageNow >= it->second.lastPageAtMs) {
        it->second.maxPageGapMs = std::max(
            it->second.maxPageGapMs, pageNow - it->second.lastPageAtMs);
    }
    it->second.lastPageAtMs = pageNow;
    if (!isEos && (it->second.pages % 128) == 0) {
        InvestigationAppendEvent("page_progress", key, &it->second, relationOk);
    }

    if (!it->second.stream.good()) {
        it->second.stream.close();
        InvestigationAppendEvent("write_error", key, &it->second, relationOk);
        g_investigation_ogg_files.erase(it);
        return;
    }

    if (isEos) {
        it->second.stream.flush();
        it->second.stream.close();
        InvestigationAppendEvent("eos", key, &it->second, relationOk);
        g_investigation_ogg_files.erase(it);
    }
}

static uint64_t SteadyNowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

void ResetOggCaptureState(const std::string& trackId) {
    InvestigationResetDecodeInput();
    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
    g_ogg_preroll.Reset(trackId);
    g_ogg_stream_selection.Reset();
}

void DiscardPendingOggCapture() {
    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
    g_ogg_preroll.Discard();
}

static int my_ogg_stream_pagein(void* os, ogg_page_sys* og) {
    if (!orig_ogg_stream_pagein) return 0;

    int ret = orig_ogg_stream_pagein(os, og);
    if (ret != g_ogg_pagein_success_return.load() || !og || !g_decoder_hooks_ready.load()) return ret;

    unsigned char* hdr = og->header;
    long hlen = og->header_len;
    unsigned char* bdy = og->body;
    long blen = og->body_len;
    if (blen < 0 || blen >= 1048576 || (blen > 0 && bdy == nullptr)) return ret;

    if (hdr != nullptr && hlen >= 27 && hdr[0] == 'O' && hdr[1] == 'g' && hdr[2] == 'g' && hdr[3] == 'S') {
        uint8_t flags = hdr[5];
        bool is_bos = (flags & 0x02) != 0;
        bool is_eos = (flags & 0x04) != 0;
        uint32_t serial = 0;
        memcpy(&serial, hdr + 14, sizeof(serial));

        // Helper-process polling is intentionally coarse. Always refresh at a
        // stream boundary, but rate-limit gated page refreshes to avoid doing
        // filesystem synchronization on every Ogg page.
        if (is_bos) {
            SyncSharedCaptureStateNow();
        } else {
            const uint64_t now = SteadyNowMs();
            const uint64_t previous = g_last_gated_sync_ms.load();
            if (now - previous >= 200) {
                std::lock_guard<std::mutex> sync_lock(g_gated_sync_mutex);
                const uint64_t refreshed_now = SteadyNowMs();
                if (refreshed_now - g_last_gated_sync_ms.load() >= 200) {
                    SyncSharedCaptureStateNow();
                    g_last_gated_sync_ms.store(refreshed_now);
                }
            }
        }

        std::string track_id;
        {
            std::lock_guard<std::mutex> lock(g_track_mutex);
            track_id = g_active_track_id;
        }

        bool is_vorbis_bos = is_bos && (bdy != nullptr) && (blen >= 7) &&
                             (bdy[0] == 0x01) && (memcmp(bdy + 1, "vorbis", 6) == 0);

        InvestigationCaptureOggPage(
            g_investigation_current_decoder,
            os,
            serial,
            is_vorbis_bos,
            is_eos,
            hdr,
            static_cast<size_t>(hlen),
            bdy,
            static_cast<size_t>(blen));

        if (!track_id.empty() && track_id != "prototype_track" &&
            CaptureBackendAllowsSource("ogg")) {
            auto &state = StateManager::Instance();
            const bool gated = g_capture_gated.load();

            if (gated) {
                bool buffered = false;
                {
                    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                    buffered = g_ogg_preroll.BufferPage(
                        track_id, serial, is_vorbis_bos,
                        hdr, (size_t)hlen,
                        bdy, (size_t)blen);
                }
                if (is_vorbis_bos && buffered) {
                    printf("[Soggfy-OGG] Buffered gated Vorbis BOS for %s (serial 0x%x)\n",
                           track_id.c_str(), serial);
                    fflush(stdout);
                }
                return ret;
            }

            OggStreamSnapshot selection;
            {
                std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                selection = g_ogg_stream_selection.Snapshot();
            }
            if (!selection.active) {
                std::optional<BufferedOggStream> pending;
                {
                    std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                    pending = g_ogg_preroll.TakeForSerial(track_id, serial);
                    if (!pending && is_vorbis_bos) g_ogg_preroll.Discard();
                }

                if (pending && state.TryClaimWriter(track_id, "ogg")) {
                    {
                        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                        g_ogg_stream_selection.Activate(serial);
                        selection = g_ogg_stream_selection.Snapshot();
                    }
                    state.ReceiveOggData(
                        track_id,
                        reinterpret_cast<const char*>(pending->bytes.data()),
                        pending->bytes.size());
                    MarkAudioActivity();
                    printf("[Soggfy-OGG] Promoted %zu pre-roll bytes for %s (serial 0x%x)\n",
                           pending->bytes.size(), track_id.c_str(), serial);
                    fflush(stdout);
                } else if (is_vorbis_bos && state.TryClaimWriter(track_id, "ogg")) {
                    {
                        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                        g_ogg_stream_selection.Activate(serial);
                        selection = g_ogg_stream_selection.Snapshot();
                    }
                    printf("[Soggfy-OGG] Claimed Vorbis stream for %s (serial 0x%x)\n",
                           track_id.c_str(), serial);
                    fflush(stdout);
                }
            }

            if (selection.active && serial == selection.serial &&
                state.OwnsWriter(track_id, "ogg")) {
                uint64_t eos_granule = 0;
                double eos_audio_sec = 0.0;
                if (is_eos) {
                    memcpy(&eos_granule, hdr + 6, sizeof(eos_granule));
                    eos_audio_sec = (double)eos_granule / 44100.0;
                    if (eos_audio_sec <= 5.0) {
                        state.RestartOggCapture(track_id);
                        {
                            std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                            g_ogg_stream_selection.Reset();
                        }
                        printf("[Soggfy-OGG] Discarded aborted stream for %s (serial 0x%x, %.1fs EOS); waiting for replacement BOS\n",
                               track_id.c_str(), serial, eos_audio_sec);
                        fflush(stdout);
                        return ret;
                    }
                }

                state.ReceiveOggData(track_id, (const char*)hdr, (size_t)hlen);
                MarkAudioActivity();
                state.ReceiveOggData(track_id, (const char*)bdy, (size_t)blen);
                MarkAudioActivity();

                if (is_eos) {
                    printf("[Soggfy-OGG] Stream EOS reached for %s (serial 0x%x, %.1fs audio). Finalizing!\n",
                           track_id.c_str(), serial, eos_audio_sec);
                    fflush(stdout);
                    {
                        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
                        g_ogg_stream_selection.Reset();
                    }
                    state.FinishPlayback(track_id);
                }
            }
        }
    }

    return ret;
}

static uintptr_t my_InvestigationCacheRead(void* wrapper) {
    const uintptr_t wrapperPtr = reinterpret_cast<uintptr_t>(wrapper);
    const uintptr_t object = wrapper
        ? *reinterpret_cast<const uintptr_t*>(wrapper)
        : 0;
    const std::string fileId = InvestigationNativeSourceEnabled()
        ? InvestigationFileIdHex(object)
        : std::string{};

    const std::string previousFileId = g_investigation_cache_file_id;
    const uintptr_t previousObject = g_investigation_cache_object;
    if (!fileId.empty()) {
        g_investigation_cache_file_id = fileId;
        g_investigation_cache_object = object;
        InvestigationAppendIdentityEvent(
            "cache_file_read_enter", fileId, wrapperPtr, object, 0);
    }

    const uintptr_t result = orig_InvestigationCacheRead
        ? orig_InvestigationCacheRead(wrapper)
        : 0;

    if (!fileId.empty()) {
        InvestigationAppendIdentityEvent(
            "cache_file_read_exit", fileId, wrapperPtr, object, 0);
    }
    g_investigation_cache_file_id = previousFileId;
    g_investigation_cache_object = previousObject;
    return result;
}

static uintptr_t my_InvestigationHigherContext(void* context) {
    const uintptr_t contextPtr = reinterpret_cast<uintptr_t>(context);
    const std::string previousFileId = g_investigation_context_file_id;
    const uintptr_t previousHigherContext = g_investigation_higher_context;
    g_investigation_higher_context = contextPtr;
    std::optional<InvestigationFileIdMatch> match;
    if (InvestigationNativeSourceEnabled() && contextPtr != 0) {
        match = InvestigationFindCanonicalFileId(contextPtr, 0x628);
        if (match) {
            g_investigation_context_file_id = match->fileId;
            InvestigationAppendOwnerFileMatch(contextPtr, *match);
        } else {
            const auto audioMatch =
                InvestigationFindCanonicalAudioId(contextPtr, 0x628);
            if (audioMatch) {
                g_investigation_context_file_id = audioMatch->fileId;
                InvestigationAppendAudioIdMatch(contextPtr, *audioMatch);
            }
        }
    }

    const uintptr_t result = orig_InvestigationHigherContext
        ? orig_InvestigationHigherContext(context)
        : 0;

    g_investigation_context_file_id = previousFileId;
    g_investigation_higher_context = previousHigherContext;
    return result;
}

static void my_InvestigationPlaybackInfoBuilder(void* output, void* metadata) {
    if (InvestigationNativeSourceEnabled() && metadata) {
        const uintptr_t metadataPtr = reinterpret_cast<uintptr_t>(metadata);
        const uintptr_t vector = metadataPtr + 0x18;
        const uintptr_t encoded = *reinterpret_cast<const uintptr_t*>(vector);
        const int32_t count = *reinterpret_cast<const int32_t*>(vector + 0x8);
        if (count > 0 && count <= 64) {
            const uintptr_t slots = (encoded & 1) == 0
                ? vector
                : encoded + 7;
            for (int32_t i = 0; i < count; ++i) {
                const uintptr_t descriptor =
                    *reinterpret_cast<const uintptr_t*>(slots + i * 8);
                if (!descriptor) continue;
                const uintptr_t taggedString =
                    *reinterpret_cast<const uintptr_t*>(descriptor + 0x18) &
                    ~static_cast<uintptr_t>(3);
                if (!taggedString) continue;

                const int8_t smallLength =
                    *reinterpret_cast<const int8_t*>(taggedString + 0x17);
                uintptr_t fileIdAddress = 0;
                size_t length = 0;
                if (smallLength >= 0) {
                    fileIdAddress = taggedString;
                    length = static_cast<size_t>(smallLength);
                } else {
                    fileIdAddress =
                        *reinterpret_cast<const uintptr_t*>(taggedString);
                    length = *reinterpret_cast<const size_t*>(taggedString + 8);
                }
                if (length != 20 || !fileIdAddress) continue;

                const auto* fileIdBytes =
                    reinterpret_cast<const uint8_t*>(fileIdAddress);
                const uint32_t format =
                    *reinterpret_cast<const uint32_t*>(descriptor + 0x20);
                InvestigationAppendPlaybackInfoDescriptor(
                    metadataPtr,
                    descriptor,
                    fileIdAddress,
                    format,
                    InvestigationHex(fileIdBytes, 20));
            }
        }
    }

    if (orig_InvestigationPlaybackInfoBuilder) {
        orig_InvestigationPlaybackInfoBuilder(output, metadata);
    }
}

static uintptr_t my_InvestigationOwnerConstructor(
    void* owner,
    uintptr_t x1,
    uintptr_t x2,
    uintptr_t x3,
    uintptr_t x4,
    uintptr_t x5,
    uintptr_t x6,
    uintptr_t x7,
    uintptr_t x8
) {
    const uintptr_t ownerPtr = reinterpret_cast<uintptr_t>(owner);
    if (InvestigationNativeSourceEnabled()) {
        const uintptr_t args[] = {x1, x2, x3, x4, x5, x6, x7, x8};
        InvestigationAppendOwnerCtorTrace(ownerPtr, args, std::size(args));
        InvestigationScanDependency("parent+0x08", x1);
        InvestigationScanDependency("parent+0xf0", x5);
    }
    const uintptr_t previousOwner = g_investigation_constructing_owner;
    const std::string previousFileId = g_investigation_constructing_file_id;
    const std::string& constructionFileId =
        !g_investigation_context_file_id.empty()
            ? g_investigation_context_file_id
            : g_investigation_cache_file_id;
    if (InvestigationNativeSourceEnabled() &&
        !constructionFileId.empty()) {
        g_investigation_constructing_owner = ownerPtr;
        g_investigation_constructing_file_id = constructionFileId;
        InvestigationAppendIdentityEvent(
            "owner_ctor_bound_file",
            constructionFileId,
            0,
            g_investigation_cache_object,
            ownerPtr);
    }

    const uintptr_t result = orig_InvestigationOwnerConstructor
        ? orig_InvestigationOwnerConstructor(
            owner, x1, x2, x3, x4, x5, x6, x7, x8)
        : 0;

    if (InvestigationNativeSourceEnabled() && ownerPtr != 0) {
        const uintptr_t parent = x6 >= 0xf8 ? x6 - 0xf8 : 0;
        {
            std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
            const uintptr_t source = ownerPtr + kSpotify130277SourceOffset;
            auto it = g_investigation_native_sources.find(source);
            if (it != g_investigation_native_sources.end()) {
                it->second.parent = parent;
            }
        }
        auto match = InvestigationFindCanonicalFileId(ownerPtr, 0x700);
        uintptr_t matchBase = ownerPtr;
        if (!match && parent != 0) {
            match = InvestigationFindCanonicalFileId(parent, 0x118);
            matchBase = parent;
        }
        std::string matchedFileId;
        if (match) {
            InvestigationAppendOwnerFileMatch(matchBase, *match);
            matchedFileId = match->fileId;
        } else {
            auto audioMatch =
                InvestigationFindCanonicalAudioId(ownerPtr, 0x700);
            uintptr_t audioBase = ownerPtr;
            if (!audioMatch && parent != 0) {
                audioBase = parent;
                audioMatch =
                    InvestigationFindCanonicalAudioId(audioBase, 0x118);
            }
            if (audioMatch) {
                InvestigationAppendAudioIdMatch(audioBase, *audioMatch);
                matchedFileId = audioMatch->fileId;
            }
        }
        if (!matchedFileId.empty()) {
            InvestigationNativeSourceState snapshot;
            bool found = false;
            {
                std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
                const uintptr_t source = ownerPtr + kSpotify130277SourceOffset;
                auto it = g_investigation_native_sources.find(source);
                if (it != g_investigation_native_sources.end()) {
                    it->second.fileId = matchedFileId;
                    snapshot = it->second;
                    found = true;
                }
            }
            if (found) {
                InvestigationAppendNativeSourceEvent(
                    "source_identity_bound", snapshot);
            }
        }
    }

    g_investigation_constructing_owner = previousOwner;
    g_investigation_constructing_file_id = previousFileId;
    return result;
}

static uintptr_t my_InvestigationSourceInit(void* source, uint8_t mode) {
    const uintptr_t result = orig_InvestigationSourceInit
        ? orig_InvestigationSourceInit(source, mode)
        : 0;
    if (!InvestigationNativeSourceEnabled() || !source) return result;

    InvestigationNativeSourceState snapshot;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        if (g_investigation_native_sources.size() >= kMaxInvestigationNativeSources) {
            auto oldest = std::min_element(
                g_investigation_native_sources.begin(),
                g_investigation_native_sources.end(),
                [](const auto& a, const auto& b) {
                    return a.second.createdAtMs < b.second.createdAtMs;
                });
            if (oldest != g_investigation_native_sources.end()) {
                g_investigation_native_sources.erase(oldest);
            }
        }
        const uintptr_t key = reinterpret_cast<uintptr_t>(source);
        g_investigation_retired_sources.erase(key);
        snapshot = InvestigationNewNativeSourceState(key, mode);
        g_investigation_native_sources.insert_or_assign(key, snapshot);
    }
    g_investigation_pending_source_binding =
        InvestigationPendingSourceBinding{};
    g_investigation_pending_source_binding.generation =
        snapshot.generation;
    g_investigation_pending_source_binding.source = snapshot.source;
    g_investigation_pending_source_binding.threadId =
        snapshot.initThreadId;
    g_investigation_pending_source_binding.identityScopeToken =
        InvestigationCurrentIdentityScopeToken();
    g_investigation_pending_source_binding.identityScopeSiteOffset =
        InvestigationCurrentIdentityScopeSiteOffset();
    g_investigation_pending_source_binding.frameCount = backtrace(
        g_investigation_pending_source_binding.frames,
        static_cast<int>(std::size(
            g_investigation_pending_source_binding.frames)));
    g_investigation_pending_source_binding.frameRecordCount =
        InvestigationCaptureFrameRecords(
            g_investigation_pending_source_binding.frameRecords,
            static_cast<int>(std::size(
                g_investigation_pending_source_binding.frameRecords)));
    InvestigationAppendNativeSourceEvent("source_init", snapshot);
    return result;
}

static InvestigationNativeSourceSpan my_InvestigationSourcePeek(void* source) {
    InvestigationNativeSourceSpan span{};
    if (orig_InvestigationSourcePeek) span = orig_InvestigationSourcePeek(source);
    if (!InvestigationNativeSourceEnabled() || !source) return span;

    InvestigationNativeSourceState snapshot;
    const uintptr_t key = reinterpret_cast<uintptr_t>(source);
    bool late = false;
    bool log = false;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        auto it = g_investigation_native_sources.find(key);
        if (it == g_investigation_native_sources.end()) {
            auto retired = g_investigation_retired_sources.find(key);
            if (retired != g_investigation_retired_sources.end()) {
                snapshot.generation = retired->second.generation;
                snapshot.source = key;
                snapshot.owner = key - kSpotify130277SourceOffset;
                snapshot.decoder = InvestigationDecoderForSource(key);
                snapshot.lastAtMs = InvestigationNowMs();
                late = true;
                log = true;
            } else {
                snapshot = InvestigationNewNativeSourceState(key, 0);
                auto inserted = g_investigation_native_sources.emplace(key, snapshot);
                it = inserted.first;
            }
        }
        if (!late) {
            auto& state = it->second;
            state.decoder = InvestigationDecoderForSource(key);
            state.lastAtMs = InvestigationNowMs();
            state.peekCalls += 1;
            state.bytesOffered += span.length;
            snapshot = state;
            log = state.peekCalls == 1 || (state.peekCalls % 128) == 0 ||
                span.length == 0;
        }
    }
    if (log) {
        InvestigationAppendNativeSourceEvent(
            late ? "source_late_peek" : "source_peek",
            snapshot, span.length, 0,
            reinterpret_cast<uintptr_t>(span.data));
    }
    return span;
}

static uintptr_t my_InvestigationSourceConsume(void* source, uint64_t amount) {
    const uintptr_t result = orig_InvestigationSourceConsume
        ? orig_InvestigationSourceConsume(source, amount)
        : 0;
    if (!InvestigationNativeSourceEnabled() || !source) return result;

    InvestigationNativeSourceState snapshot;
    const uintptr_t key = reinterpret_cast<uintptr_t>(source);
    bool late = false;
    bool log = false;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        auto it = g_investigation_native_sources.find(key);
        if (it == g_investigation_native_sources.end()) {
            auto retired = g_investigation_retired_sources.find(key);
            if (retired != g_investigation_retired_sources.end()) {
                snapshot.generation = retired->second.generation;
                snapshot.source = key;
                snapshot.owner = key - kSpotify130277SourceOffset;
                snapshot.decoder = InvestigationDecoderForSource(key);
                snapshot.lastAtMs = InvestigationNowMs();
                late = true;
                log = true;
            } else {
                snapshot = InvestigationNewNativeSourceState(key, 0);
                auto inserted = g_investigation_native_sources.emplace(key, snapshot);
                it = inserted.first;
            }
        }
        if (!late) {
            auto& state = it->second;
            state.decoder = InvestigationDecoderForSource(key);
            state.lastAtMs = InvestigationNowMs();
            state.consumeCalls += 1;
            state.bytesConsumed += amount;
            snapshot = state;
            log = state.consumeCalls == 1 || (state.consumeCalls % 128) == 0 ||
                amount == 0;
        }
    }
    if (log) {
        InvestigationAppendNativeSourceEvent(
            late ? "source_late_consume" : "source_consume",
            snapshot, 0, amount);
    }
    return result;
}

static uintptr_t my_InvestigationSourceReset(void* source, uintptr_t arg) {
    const uintptr_t result = orig_InvestigationSourceReset
        ? orig_InvestigationSourceReset(source, arg)
        : 0;
    if (!InvestigationNativeSourceEnabled() || !source) return result;

    InvestigationNativeSourceState snapshot;
    bool found = false;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        auto it = g_investigation_native_sources.find(
            reinterpret_cast<uintptr_t>(source));
        if (it != g_investigation_native_sources.end()) {
            it->second.lastAtMs = InvestigationNowMs();
            it->second.resetCount += 1;
            snapshot = it->second;
            found = true;
        }
    }
    if (found) InvestigationAppendNativeSourceEvent("source_reset", snapshot);
    return result;
}

static uintptr_t my_InvestigationOwnerControl(void* owner, uintptr_t arg) {
    const uintptr_t source = reinterpret_cast<uintptr_t>(owner) +
        kSpotify130277SourceOffset;
    const uintptr_t result = orig_InvestigationOwnerControl
        ? orig_InvestigationOwnerControl(owner, arg)
        : 0;
    if (!InvestigationNativeSourceEnabled() || !owner) return result;

    InvestigationNativeSourceState snapshot;
    bool found = false;
    {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        auto it = g_investigation_native_sources.find(source);
        if (it != g_investigation_native_sources.end()) {
            it->second.lastAtMs = InvestigationNowMs();
            it->second.resetCount += 1;
            snapshot = it->second;
            found = true;
        }
    }
    if (found) {
        InvestigationAppendNativeSourceEvent(
            "source_owner_control", snapshot, 0, arg);
    }
    return result;
}

static uintptr_t my_InvestigationOwnerDestructor(void* owner) {
    InvestigationNativeSourceState snapshot;
    const uintptr_t source = reinterpret_cast<uintptr_t>(owner) +
        kSpotify130277SourceOffset;
    bool found = false;
    if (InvestigationNativeSourceEnabled() && owner) {
        std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
        auto it = g_investigation_native_sources.find(source);
        if (it != g_investigation_native_sources.end()) {
            snapshot = it->second;
            snapshot.lastAtMs = InvestigationNowMs();
            found = true;
        }
    }

    const uintptr_t result = orig_InvestigationOwnerDestructor
        ? orig_InvestigationOwnerDestructor(owner)
        : 0;

    if (found) {
        {
            std::lock_guard<std::mutex> lock(g_investigation_source_mutex);
            g_investigation_native_sources.erase(source);
            if (g_investigation_retired_sources.size() >=
                kMaxInvestigationNativeSources) {
                auto oldest = std::min_element(
                    g_investigation_retired_sources.begin(),
                    g_investigation_retired_sources.end(),
                    [](const auto& a, const auto& b) {
                        return a.second.teardownAtMs < b.second.teardownAtMs;
                    });
                if (oldest != g_investigation_retired_sources.end()) {
                    g_investigation_retired_sources.erase(oldest);
                }
            }
            g_investigation_retired_sources.insert_or_assign(
                source,
                InvestigationRetiredSource{
                    snapshot.generation, InvestigationNowMs()});
        }
        InvestigationAppendNativeSourceEvent("source_teardown", snapshot);
    }
    return result;
}

static int my_DecodeAudioData(void* x0, float* x1, size_t* x2, const char* x3, size_t* x4, int x5) {
    if (!orig_DecodeAudioData) return 0;

    const bool investigate = InvestigationOggEnabled();
    const uintptr_t decoderPtr = reinterpret_cast<uintptr_t>(x0);
    const size_t sampleCapacityBefore = x2 ? *x2 : 0;
    const size_t encodedAvailableBefore = x4 ? *x4 : 0;
    bool trackedDecoder = false;
    bool firstDecoderCall = false;
    void* firstStack[16] = {};
    int firstStackCount = 0;

    if (investigate && decoderPtr != 0) {
        const uint64_t now = InvestigationNowMs();
        {
            std::lock_guard<std::mutex> lock(g_investigation_decode_mutex);
            auto it = g_investigation_decode_stats.find(decoderPtr);
            if (it == g_investigation_decode_stats.end() &&
                g_investigation_decode_stats.size() < kMaxInvestigationDecoders) {
                InvestigationDecodeStats stats;
                stats.calls = 1;
                stats.firstAtMs = now;
                stats.lastAtMs = now;
                stats.totalInputBytes = encodedAvailableBefore;
                g_investigation_decode_stats.emplace(decoderPtr, stats);
                trackedDecoder = true;
                firstDecoderCall = true;
            } else if (it != g_investigation_decode_stats.end()) {
                if (now >= it->second.lastAtMs) {
                    it->second.maxCallGapMs = std::max(
                        it->second.maxCallGapMs, now - it->second.lastAtMs);
                }
                it->second.lastAtMs = now;
                it->second.calls += 1;
                it->second.totalInputBytes += encodedAvailableBefore;
                trackedDecoder = true;
            }
        }
        if (firstDecoderCall) {
            firstStackCount = backtrace(firstStack, 16);
        }
    }

    void* previousInvestigationDecoder = g_investigation_current_decoder;
    const bool previousInvestigationEos = g_investigation_eos_seen;
    if (investigate) {
        g_investigation_current_decoder = x0;
        g_investigation_eos_seen = false;
    }
    int ret = orig_DecodeAudioData(x0, x1, x2, x3, x4, x5);
    const bool eosSeenInCall = investigate && g_investigation_eos_seen;
    if (investigate) {
        g_investigation_current_decoder = previousInvestigationDecoder;
        g_investigation_eos_seen = previousInvestigationEos;
    }
    size_t samplesDecoded = (x2 != nullptr) ? *x2 : 0;
    const size_t encodedRead = (x4 != nullptr) ? *x4 : 0;
    if (investigate && trackedDecoder) {
        InvestigationCaptureDecodeInput(
            decoderPtr, x3, encodedRead);
    }

    if (investigate && trackedDecoder) {
        InvestigationDecodeStats snapshot;
        bool haveSnapshot = false;
        {
            std::lock_guard<std::mutex> lock(g_investigation_decode_mutex);
            auto it = g_investigation_decode_stats.find(decoderPtr);
            if (it != g_investigation_decode_stats.end()) {
                it->second.totalBytesRead += encodedRead;
                it->second.totalSamplesDecoded += samplesDecoded;
                snapshot = it->second;
                haveSnapshot = true;
            }
        }
        if (haveSnapshot &&
            (firstDecoderCall || eosSeenInCall || (snapshot.calls % 128) == 0)) {
            InvestigationAppendDecodeEvent(
                firstDecoderCall ? "decode_first"
                    : (eosSeenInCall ? "decode_eos_return" : "decode_progress"),
                decoderPtr,
                snapshot,
                reinterpret_cast<uintptr_t>(x1),
                reinterpret_cast<uintptr_t>(x2),
                sampleCapacityBefore,
                samplesDecoded,
                reinterpret_cast<uintptr_t>(x3),
                reinterpret_cast<uintptr_t>(x4),
                encodedAvailableBefore,
                encodedRead,
                x5,
                firstDecoderCall ? firstStack : nullptr,
                firstDecoderCall ? firstStackCount : 0);
        }
    }

    if (!g_decoder_hooks_ready.load()) return ret;

    std::string track;
    {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        track = g_active_track_id;
    }

    OggStreamSnapshot selection;
    {
        std::lock_guard<std::mutex> lock(g_ogg_preroll_mutex);
        selection = g_ogg_stream_selection.Snapshot();
    }
    if (CaptureBackendAllowsDecoderMutation() && !g_capture_gated.load() &&
        selection.active && !track.empty() && track != "prototype_track" &&
        StateManager::Instance().OwnsWriter(track, "ogg")) {
        // Accelerate only after the selected Ogg backend has claimed this track.
        const double playSpeed = std::clamp(
            GetCaptureDecodeSpeed(), 1.0, CaptureDecodeSpeedLimit());
        if (samplesDecoded > 0 && x2 != nullptr) {
            *x2 = std::max((size_t)1, (size_t)(samplesDecoded / playSpeed));
        }
    }

    return ret;
}


static bool MatchesPrologue(uintptr_t address, const uint8_t* expected, size_t length) {
    if (!address || !expected || length == 0) return false;
    return memcmp(reinterpret_cast<const void*>(address), expected, length) == 0;
}

static bool InstallCheckedHook(
    const char* name,
    uintptr_t address,
    const uint8_t* expected,
    size_t expectedLength,
    void* replacement,
    void** original
) {
    if (!MatchesPrologue(address, expected, expectedLength)) {
        printf("[Soggfy-ERROR] Unsupported Spotify build: %s prologue mismatch at 0x%lx\n",
               name, address);
        fflush(stdout);
        return false;
    }
    const int result = DobbyHook(reinterpret_cast<void*>(address), replacement, original);
    if (result != 0 || !*original) {
        printf("[Soggfy-ERROR] Failed to hook %s at 0x%lx (result=%d)\n",
               name, address, result);
        fflush(stdout);
        *original = nullptr;
        return false;
    }
    printf("[Soggfy-INFO] Hooked %s at 0x%lx with validated prologue\n", name, address);
    fflush(stdout);
    return true;
}

static bool InstallNativeSourceInvestigationHooks(uintptr_t base) {
    if (!InvestigationNativeSourceEnabled()) return true;

    struct HookSpec {
        const char* name;
        uintptr_t offset;
        const uint8_t* prologue;
        size_t prologueLength;
        void* replacement;
        void** original;
    };

    static constexpr uint8_t initPrologue[] = {
        0xfd, 0x7b, 0xbf, 0xa9, 0xfd, 0x03, 0x00, 0x91,
        0xd1, 0x05, 0x00, 0x94, 0x1f, 0xf0, 0x01, 0xf9,
    };
    static constexpr uint8_t resetPrologue[] = {
        0xf8, 0x5f, 0xbc, 0xa9, 0xf6, 0x57, 0x01, 0xa9,
        0xf4, 0x4f, 0x02, 0xa9, 0xfd, 0x7b, 0x03, 0xa9,
    };
    static constexpr uint8_t peekPrologue[] = {
        0xf4, 0x4f, 0xbe, 0xa9, 0xfd, 0x7b, 0x01, 0xa9,
        0xfd, 0x43, 0x00, 0x91, 0x08, 0xe8, 0x41, 0xf9,
    };
    static constexpr uint8_t consumePrologue[] = {
        0xff, 0x03, 0x01, 0xd1, 0xf6, 0x57, 0x01, 0xa9,
        0xf4, 0x4f, 0x02, 0xa9, 0xfd, 0x7b, 0x03, 0xa9,
    };
    static constexpr uint8_t controlPrologue[] = {
        0xf4, 0x4f, 0xbe, 0xa9, 0xfd, 0x7b, 0x01, 0xa9,
        0xfd, 0x43, 0x00, 0x91, 0xf4, 0x03, 0x01, 0xaa,
    };
    static constexpr uint8_t destructorPrologue[] = {
        0xff, 0xc3, 0x00, 0xd1, 0xf4, 0x4f, 0x01, 0xa9,
        0xfd, 0x7b, 0x02, 0xa9, 0xfd, 0x83, 0x00, 0x91,
    };
    static constexpr uint8_t cacheReadPrologue[] = {
        0xff, 0x43, 0x06, 0xd1, 0xfc, 0x6f, 0x13, 0xa9,
        0xfa, 0x67, 0x14, 0xa9, 0xf8, 0x5f, 0x15, 0xa9,
    };
    static constexpr uint8_t ownerCtorPrologue[] = {
        0xff, 0x43, 0x03, 0xd1, 0xfc, 0x6f, 0x07, 0xa9,
        0xfa, 0x67, 0x08, 0xa9, 0xf8, 0x5f, 0x09, 0xa9,
    };
    static constexpr uint8_t higherContextPrologue[] = {
        0xff, 0x03, 0x07, 0xd1, 0xfc, 0x6f, 0x16, 0xa9,
        0xfa, 0x67, 0x17, 0xa9, 0xf8, 0x5f, 0x18, 0xa9,
    };
    static constexpr uint8_t playbackInfoBuilderPrologue[] = {
        0xff, 0x43, 0x05, 0xd1, 0xfc, 0x6f, 0x0f, 0xa9,
        0xfa, 0x67, 0x10, 0xa9, 0xf8, 0x5f, 0x11, 0xa9,
    };
    static constexpr uint8_t playbackServiceDispatchPrologue[] = {
        0xfc, 0x6f, 0xbc, 0xa9, 0xf6, 0x57, 0x01, 0xa9,
        0xf4, 0x4f, 0x02, 0xa9, 0xfd, 0x7b, 0x03, 0xa9,
    };
    static constexpr uint8_t playbackGetInfoPrologue[] = {
        0xf6, 0x57, 0xbd, 0xa9, 0xf4, 0x4f, 0x01, 0xa9,
        0xfd, 0x7b, 0x02, 0xa9, 0xfd, 0x83, 0x00, 0x91,
    };
    static constexpr uint8_t playbackBackendAssignPrologue[] = {
        0xff, 0x83, 0x06, 0xd1, 0xfc, 0x6f, 0x17, 0xa9,
        0xf4, 0x4f, 0x18, 0xa9, 0xfd, 0x7b, 0x19, 0xa9,
    };
    static constexpr uint8_t sourcePublishPrologue[] = {
        0xfc, 0x6f, 0xba, 0xa9, 0xfa, 0x67, 0x01, 0xa9,
        0xf8, 0x5f, 0x02, 0xa9, 0xf6, 0x57, 0x03, 0xa9,
    };
    static constexpr uint8_t identityScopeAEnterInstruction[] = {
        0x20, 0x01, 0x3f, 0xd6,
    };
    static constexpr uint8_t identityScopeBEnterInstruction[] = {
        0x53, 0xc9, 0xff, 0x97,
    };

    HookSpec hooks[] = {
        {"investigation source init", 0x11f029c, initPrologue, sizeof(initPrologue),
            reinterpret_cast<void*>(my_InvestigationSourceInit),
            reinterpret_cast<void**>(&orig_InvestigationSourceInit)},
        {"investigation source reset", 0x11f02d0, resetPrologue, sizeof(resetPrologue),
            reinterpret_cast<void*>(my_InvestigationSourceReset),
            reinterpret_cast<void**>(&orig_InvestigationSourceReset)},
        {"investigation source peek", 0x11f05ec, peekPrologue, sizeof(peekPrologue),
            reinterpret_cast<void*>(my_InvestigationSourcePeek),
            reinterpret_cast<void**>(&orig_InvestigationSourcePeek)},
        {"investigation source consume", 0x11f0974, consumePrologue, sizeof(consumePrologue),
            reinterpret_cast<void*>(my_InvestigationSourceConsume),
            reinterpret_cast<void**>(&orig_InvestigationSourceConsume)},
        {"investigation owner control", 0x11ee890, controlPrologue, sizeof(controlPrologue),
            reinterpret_cast<void*>(my_InvestigationOwnerControl),
            reinterpret_cast<void**>(&orig_InvestigationOwnerControl)},
        {"investigation owner destructor", 0x11ed670,
            destructorPrologue, sizeof(destructorPrologue),
            reinterpret_cast<void*>(my_InvestigationOwnerDestructor),
            reinterpret_cast<void**>(&orig_InvestigationOwnerDestructor)},
        {"investigation cache file read", 0x67a818,
            cacheReadPrologue, sizeof(cacheReadPrologue),
            reinterpret_cast<void*>(my_InvestigationCacheRead),
            reinterpret_cast<void**>(&orig_InvestigationCacheRead)},
        {"investigation owner constructor", 0x11ed0e8,
            ownerCtorPrologue, sizeof(ownerCtorPrologue),
            reinterpret_cast<void*>(my_InvestigationOwnerConstructor),
            reinterpret_cast<void**>(&orig_InvestigationOwnerConstructor)},
        {"investigation higher playback context", 0x11ddf90,
            higherContextPrologue, sizeof(higherContextPrologue),
            reinterpret_cast<void*>(my_InvestigationHigherContext),
            reinterpret_cast<void**>(&orig_InvestigationHigherContext)},
        {"investigation playback-info builder", 0x663784,
            playbackInfoBuilderPrologue, sizeof(playbackInfoBuilderPrologue),
            reinterpret_cast<void*>(my_InvestigationPlaybackInfoBuilder),
            reinterpret_cast<void**>(&orig_InvestigationPlaybackInfoBuilder)},
    };

    for (const auto& hook : hooks) {
        if (!MatchesPrologue(
                base + hook.offset, hook.prologue, hook.prologueLength)) {
            printf("[Soggfy-ERROR] Native-source investigation disabled: %s prologue mismatch.\n",
                   hook.name);
            fflush(stdout);
            return false;
        }
    }
    const uintptr_t dispatchAddress = base + 0x664c88;
    const uintptr_t getInfoAddress = base + 0x662c9c;
    const uintptr_t playbackSnapshotAddress = base + 0x662ddc;
    const uintptr_t backendAssignAddress = base + 0x1993cac;
    const uintptr_t sourcePublishAddress = base + 0x6209d0;
    const uintptr_t identityScopeAEnterAddress = base + 0xc9cdd4;
    const uintptr_t identityScopeBEnterAddress = base + 0x656d1c;
    if (!MatchesPrologue(
            dispatchAddress,
            playbackServiceDispatchPrologue,
            sizeof(playbackServiceDispatchPrologue))) {
        printf("[Soggfy-ERROR] Native-source investigation disabled: playback service dispatch prologue mismatch.\n");
        fflush(stdout);
        return false;
    }
    if (!MatchesPrologue(
            getInfoAddress,
            playbackGetInfoPrologue,
            sizeof(playbackGetInfoPrologue))) {
        printf("[Soggfy-ERROR] Native-source investigation disabled: playback GetPlaybackInfo prologue mismatch.\n");
        fflush(stdout);
        return false;
    }
    if (!MatchesPrologue(
            playbackSnapshotAddress,
            playbackGetInfoPrologue,
            sizeof(playbackGetInfoPrologue))) {
        printf("[Soggfy-ERROR] Native-source investigation disabled: playback snapshot serializer prologue mismatch.\n");
        fflush(stdout);
        return false;
    }
    if (!MatchesPrologue(
            backendAssignAddress,
            playbackBackendAssignPrologue,
            sizeof(playbackBackendAssignPrologue))) {
        printf("[Soggfy-ERROR] Native-source investigation disabled: playback backend assignment prologue mismatch.\n");
        fflush(stdout);
        return false;
    }
    if (!MatchesPrologue(
            sourcePublishAddress,
            sourcePublishPrologue,
            sizeof(sourcePublishPrologue))) {
        printf("[Soggfy-ERROR] Native-source investigation disabled: source publish handoff prologue mismatch.\n");
        fflush(stdout);
        return false;
    }
    struct IdentityScopeInstruction {
        const char* name;
        uintptr_t address;
        const uint8_t* bytes;
        size_t length;
    };
    const IdentityScopeInstruction identityScopeInstructions[] = {
        {"identity scope A enter", identityScopeAEnterAddress,
            identityScopeAEnterInstruction,
            sizeof(identityScopeAEnterInstruction)},
        {"identity scope B enter", identityScopeBEnterAddress,
            identityScopeBEnterInstruction,
            sizeof(identityScopeBEnterInstruction)},
    };
    for (const auto& instruction : identityScopeInstructions) {
        if (!MatchesPrologue(
                instruction.address,
                instruction.bytes,
                instruction.length)) {
            printf("[Soggfy-ERROR] Native-source investigation disabled: %s instruction mismatch.\n",
                   instruction.name);
            fflush(stdout);
            return false;
        }
    }
    for (const auto& hook : hooks) {
        if (!InstallCheckedHook(
                hook.name, base + hook.offset,
                hook.prologue, hook.prologueLength,
                hook.replacement, hook.original)) {
            printf("[Soggfy-ERROR] Native-source investigation hook set incomplete.\n");
            fflush(stdout);
            return false;
        }
    }
    const int instrumentResult = DobbyInstrument(
        reinterpret_cast<void*>(dispatchAddress),
        InvestigationPlaybackServiceDispatchProbe);
    if (instrumentResult != 0) {
        printf("[Soggfy-ERROR] Failed to instrument playback service dispatch at 0x%lx (result=%d)\n",
               dispatchAddress, instrumentResult);
        fflush(stdout);
        return false;
    }
    printf("[Soggfy-INFO] Instrumented playback service dispatch at 0x%lx with validated prologue\n",
           dispatchAddress);
    fflush(stdout);

    const int getInfoInstrumentResult = DobbyInstrument(
        reinterpret_cast<void*>(getInfoAddress),
        InvestigationPlaybackGetInfoProbe);
    if (getInfoInstrumentResult != 0) {
        printf("[Soggfy-ERROR] Failed to instrument playback GetPlaybackInfo at 0x%lx (result=%d)\n",
               getInfoAddress, getInfoInstrumentResult);
        fflush(stdout);
        return false;
    }
    printf("[Soggfy-INFO] Instrumented playback GetPlaybackInfo at 0x%lx with validated prologue\n",
           getInfoAddress);
    fflush(stdout);

    const int snapshotInstrumentResult = DobbyInstrument(
        reinterpret_cast<void*>(playbackSnapshotAddress),
        InvestigationPlaybackSnapshotProbe);
    if (snapshotInstrumentResult != 0) {
        printf("[Soggfy-ERROR] Failed to instrument playback snapshot serializer at 0x%lx (result=%d)\n",
               playbackSnapshotAddress, snapshotInstrumentResult);
        fflush(stdout);
        return false;
    }
    printf("[Soggfy-INFO] Instrumented playback snapshot serializer at 0x%lx with validated prologue\n",
           playbackSnapshotAddress);
    fflush(stdout);

    const int backendAssignInstrumentResult = DobbyInstrument(
        reinterpret_cast<void*>(backendAssignAddress),
        InvestigationPlaybackBackendAssignProbe);
    if (backendAssignInstrumentResult != 0) {
        printf("[Soggfy-ERROR] Failed to instrument playback backend assignment at 0x%lx (result=%d)\n",
               backendAssignAddress, backendAssignInstrumentResult);
        fflush(stdout);
        return false;
    }
    printf("[Soggfy-INFO] Instrumented playback backend assignment at 0x%lx with validated prologue\n",
           backendAssignAddress);
    fflush(stdout);

    const int sourcePublishInstrumentResult = DobbyInstrument(
        reinterpret_cast<void*>(sourcePublishAddress),
        InvestigationSourcePublishHandleProbe);
    if (sourcePublishInstrumentResult != 0) {
        printf("[Soggfy-ERROR] Failed to instrument source publish handoff at 0x%lx (result=%d)\n",
               sourcePublishAddress, sourcePublishInstrumentResult);
        fflush(stdout);
        return false;
    }
    printf("[Soggfy-INFO] Instrumented source publish handoff at 0x%lx with validated prologue\n",
           sourcePublishAddress);
    fflush(stdout);

    struct IdentityScopeProbe {
        const char* name;
        uintptr_t address;
        dobby_instrument_callback_t callback;
    };
    const IdentityScopeProbe identityScopeProbes[] = {
        {"identity scope A enter", identityScopeAEnterAddress,
            InvestigationIdentityScopeAEnterProbe},
        {"identity scope B enter", identityScopeBEnterAddress,
            InvestigationIdentityScopeBEnterProbe},
    };
    for (const auto& probe : identityScopeProbes) {
        const int result = DobbyInstrument(
            reinterpret_cast<void*>(probe.address),
            probe.callback);
        if (result != 0) {
            printf("[Soggfy-ERROR] Failed to instrument %s at 0x%lx (result=%d)\n",
                   probe.name, probe.address, result);
            fflush(stdout);
            return false;
        }
        printf("[Soggfy-INFO] Instrumented %s at 0x%lx\n",
               probe.name, probe.address);
        fflush(stdout);
    }
    return true;
}

void InstallDecoderHook() {
    static bool installed = false;
    if (installed) return;
    installed = true;

    uintptr_t base = Scanner::GetImageBaseAddress("Spotify");
    g_investigation_spotify_image_base.store(base);
    if (!base) {
        printf("[Soggfy-DEBUG] Spotify image not found, skipping decoder hook.\n");
        fflush(stdout);
        return;
    }
    NSString *bundleVersion = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    const char *version = bundleVersion.UTF8String;
    if (InvestigationOggRequested()) {
        const bool exactInvestigationBuild = version && strcmp(version, "1.3.0.277") == 0;
        g_investigation_context_layout_valid.store(exactInvestigationBuild);
        if (!exactInvestigationBuild) {
            printf("[Soggfy-WARN] Ogg context investigation disabled: decoder+0x88 is only validated for Spotify 1.3.0.277.\n");
            fflush(stdout);
        }
    }
    SpotifyHookTargets compatibilityTargets{};
    const SpotifyHookTargets *targets = SpotifyHookTargetsForVersion(version);
    if (!targets && SpotifyHookTargetsForCompatibilityEnvironment(version, &compatibilityTargets)) {
        targets = &compatibilityTargets;
        printf("[Soggfy-WARN] Using compatibility-only discovered hook targets for %s\n", version);
        fflush(stdout);
    }
    if (!targets) {
        printf("[Soggfy-ERROR] Unsupported Spotify build: no native hook targets for %s\n",
               version ? version : "unknown");
        fflush(stdout);
        return;
    }

    printf("[Soggfy-DEBUG] Found Spotify image base = 0x%lx (version %s)\n",
           base, targets->version);
    const SpotifyHookFamilyConfig familyConfig =
        SpotifyHookFamilyConfigForFamily(targets->family);
    g_ogg_pagein_success_return.store(familyConfig.oggPageinSuccessReturn);
    printf("[Soggfy-DEBUG] Hook family %u uses ogg_stream_pagein success return %d\n",
           static_cast<unsigned>(targets->family), familyConfig.oggPageinSuccessReturn);

    fflush(stdout);

    switch (targets->family) {
        case SpotifyHookFamily::OggV1: {
            // OggV1 is the existing capture implementation shared by all builds
            // whose ABI and hook prologues have been validated end to end.
            static constexpr uint8_t decodePrologue[] = {
                0xff, 0xc3, 0x01, 0xd1, 0xfc, 0x6f, 0x01, 0xa9,
                0xfa, 0x67, 0x02, 0xa9, 0xf8, 0x5f, 0x03, 0xa9,
            };
            static constexpr uint8_t oggPageinPrologue[] = {
                0x08, 0x08, 0x40, 0xb9, 0x88, 0x02, 0xf8, 0x37,
                0xf4, 0x4f, 0xbe, 0xa9, 0xfd, 0x7b, 0x01, 0xa9,
            };

            const uintptr_t decodeAddr = base + targets->decodeAudioDataOffset;
            const uintptr_t oggPageinAddr = base + targets->oggStreamPageinOffset;
            const bool decodeOk = InstallCheckedHook(
                "DecodeAudioData", decodeAddr, decodePrologue, sizeof(decodePrologue),
                reinterpret_cast<void*>(my_DecodeAudioData),
                reinterpret_cast<void**>(&orig_DecodeAudioData));
            const bool oggOk = InstallCheckedHook(
                "ogg_stream_pagein", oggPageinAddr, oggPageinPrologue, sizeof(oggPageinPrologue),
                reinterpret_cast<void*>(my_ogg_stream_pagein),
                reinterpret_cast<void**>(&orig_ogg_stream_pagein));

            g_decoder_hooks_ready.store(decodeOk && oggOk);
            if (!decodeOk || !oggOk) {
                printf("[Soggfy-ERROR] Ogg backend disabled for this Spotify build.\n");
            } else {
                InstallNativeSourceInvestigationHooks(base);
            }
            return;
        }
        case SpotifyHookFamily::Unsupported:
            break;
    }

    printf("[Soggfy-ERROR] Unsupported Spotify hook family for %s\n",
           version ? version : "unknown");
    fflush(stdout);
}
