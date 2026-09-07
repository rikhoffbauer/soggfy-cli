#include "DecodeHook.h"
#include "Scanner.h"
#include "StateManager.h"
#include "dobby.h"
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <AudioToolbox/AudioToolbox.h>
#import <Foundation/Foundation.h>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <chrono>
#include <dlfcn.h>
#include <fcntl.h>
#include <iostream>
#include <mach-o/dyld.h>
#include <mach/mach.h>
#include <map>
#include <objc/message.h>
#include <objc/runtime.h>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <thread>
#include <unistd.h>
#include <vector>

typedef BOOL (*setActivationPolicy_t)(
    id self, SEL _cmd, NSApplicationActivationPolicy activationPolicy);
static setActivationPolicy_t orig_setActivationPolicy = nullptr;

static BOOL
my_setActivationPolicy(id self, SEL _cmd,
                       NSApplicationActivationPolicy activationPolicy) {
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1") {
    printf("[Soggfy-INFO] setActivationPolicy: Forcing Accessory activation "
           "policy to hide Dock icon.\n");
    return orig_setActivationPolicy(self, _cmd,
                                    NSApplicationActivationPolicyAccessory);
  }
  return orig_setActivationPolicy(self, _cmd, activationPolicy);
}

typedef NSArray *(*runningApplicationsWithBundleIdentifier_t)(
    id self, SEL _cmd, NSString *bundleIdentifier);
static runningApplicationsWithBundleIdentifier_t
    orig_runningApplicationsWithBundleIdentifier = nullptr;

static NSArray *
my_runningApplicationsWithBundleIdentifier(id self, SEL _cmd,
                                           NSString *bundleIdentifier) {
  pid_t my_pid = getpid();
  NSArray *apps = orig_runningApplicationsWithBundleIdentifier
                      ? orig_runningApplicationsWithBundleIdentifier(self, _cmd,
                                                                     bundleIdentifier)
                      : nil;
  if (!apps) return @[];
  NSMutableArray *filtered = [NSMutableArray array];
  for (NSRunningApplication *app in apps) {
    if ([app processIdentifier] == my_pid) {
      [filtered addObject:app];
    }
  }
  return filtered;
}

typedef void (*activateIgnoringOtherApps_t)(id self, SEL _cmd, BOOL flag);
static activateIgnoringOtherApps_t orig_activateIgnoringOtherApps = nullptr;

static void my_activateIgnoringOtherApps(id self, SEL _cmd, BOOL flag) {
  const char *env_no_focus = getenv("SOGGFY_NO_FOCUS");
  if (env_no_focus && std::string(env_no_focus) == "1") {
    printf("[Soggfy-INFO] activateIgnoringOtherApps: Suppressed activation.\n");
    orig_activateIgnoringOtherApps(self, _cmd, NO);
  } else {
    orig_activateIgnoringOtherApps(self, _cmd, flag);
  }
}

typedef void (*makeKeyAndOrderFront_t)(id self, SEL _cmd, id sender);
static makeKeyAndOrderFront_t orig_makeKeyAndOrderFront = nullptr;

static void my_makeKeyAndOrderFront(id self, SEL _cmd, id sender) {
  orig_makeKeyAndOrderFront(self, _cmd, sender);
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1") {
    [(NSWindow *)self setFrameOrigin:NSMakePoint(-20000, -20000)];
  }
}

typedef void (*orderFront_t)(id self, SEL _cmd, id sender);
static orderFront_t orig_orderFront = nullptr;

static void my_orderFront(id self, SEL _cmd, id sender) {
  orig_orderFront(self, _cmd, sender);
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1") {
    [(NSWindow *)self setFrameOrigin:NSMakePoint(-20000, -20000)];
  }
}

typedef void (*orderFrontRegardless_t)(id self, SEL _cmd);
static orderFrontRegardless_t orig_orderFrontRegardless = nullptr;

static void my_orderFrontRegardless(id self, SEL _cmd) {
  orig_orderFrontRegardless(self, _cmd);
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1") {
    [(NSWindow *)self setFrameOrigin:NSMakePoint(-20000, -20000)];
  }
}

// ── Directory and Home Redirection Hooks ──

typedef NSArray *(*NSSearchPathForDirectoriesInDomains_t)(
    NSSearchPathDirectory directory, NSSearchPathDomainMask domainMask,
    BOOL expandTilde);
static NSSearchPathForDirectoriesInDomains_t
    orig_NSSearchPathForDirectoriesInDomains = nullptr;

static NSArray *
my_NSSearchPathForDirectoriesInDomains(NSSearchPathDirectory directory,
                                       NSSearchPathDomainMask domainMask,
                                       BOOL expandTilde) {
  const char *env_save_path = getenv("SOGGFY_SAVE_PATH");
  if (env_save_path && (directory == NSApplicationSupportDirectory ||
                        directory == NSCachesDirectory)) {
    NSString *saveDir = [NSString stringWithUTF8String:env_save_path];
    NSString *subDir = (directory == NSApplicationSupportDirectory)
                           ? @"Application Support"
                           : @"Caches";
    NSString *redirectedPath = [saveDir stringByAppendingPathComponent:subDir];

    // Ensure directory exists
    [[NSFileManager defaultManager] createDirectoryAtPath:redirectedPath
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];

    printf("[Soggfy-INFO] NSSearchPathForDirectoriesInDomains: Redirected %lu "
           "to %s\n",
           (unsigned long)directory, [redirectedPath UTF8String]);
    return @[ redirectedPath ];
  }
  return orig_NSSearchPathForDirectoriesInDomains(directory, domainMask,
                                                  expandTilde);
}

typedef NSString *(*NSHomeDirectory_t)(void);
static NSHomeDirectory_t orig_NSHomeDirectory = nullptr;

static NSString *my_NSHomeDirectory(void) {
  const char *env_save_path = getenv("SOGGFY_SAVE_PATH");
  if (env_save_path) {
    return [NSString stringWithUTF8String:env_save_path];
  }
  return orig_NSHomeDirectory();
}

typedef NSString *(*NSTemporaryDirectory_t)(void);
static NSTemporaryDirectory_t orig_NSTemporaryDirectory = nullptr;

static NSString *my_NSTemporaryDirectory(void) {
  const char *env_save_path = getenv("SOGGFY_SAVE_PATH");
  if (env_save_path) {
    NSString *tmp = [NSString stringWithFormat:@"%s/tmp", env_save_path];
    [[NSFileManager defaultManager] createDirectoryAtPath:tmp
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];
    return tmp;
  }
  return orig_NSTemporaryDirectory();
}

// ── Global state ──

std::string g_active_track_id = "prototype_track";
std::mutex g_track_mutex;

// Track the last time we received audio data, for idle-timeout detection
static std::atomic<uint64_t> g_last_audio_time_ms{0};
static std::atomic<bool> g_watchdog_running{false};

// ── Ad-gated capture state ──
// Tracks what Spotify actually reports as playing via PlaybackStateChanged
// notifications. Capture is gated until the confirmed URI matches the target.
static std::string g_confirmed_playing_uri;
static std::mutex g_playing_mutex;
std::atomic<bool> g_capture_gated{true};
static std::atomic<uint64_t> g_capture_gate_set_ms{0}; // when gate was last armed
// ── DNS / Ad-Blocking Hook ──
#include <netdb.h>
typedef int (*getaddrinfo_t)(const char *nodename, const char *servname,
                             const struct addrinfo *hints,
                             struct addrinfo **res);
static getaddrinfo_t orig_getaddrinfo = nullptr;

static int my_getaddrinfo(const char *nodename, const char *servname,
                          const struct addrinfo *hints, struct addrinfo **res) {
  if (nodename) {
    std::string host(nodename);
    if (host.find("spotifycdn.com") != std::string::npos ||
        host.find("heads-fa") != std::string::npos) {
      return orig_getaddrinfo(nodename, servname, hints, res);
    }
    if (host.find("audio-ads") != std::string::npos ||
        host.find("ads-fa.") != std::string::npos ||
        host.rfind("ads-fa", 0) == 0 ||
        host.find("ad-logic") != std::string::npos ||
        host.find("adeventtracker") != std::string::npos ||
        host.find("analytics") != std::string::npos ||
        host.find("metrics") != std::string::npos ||
        host.find("crashdump") != std::string::npos ||
        host.find("upgrade") != std::string::npos ||
        host.find("desktop.spotify.com") != std::string::npos ||
        host.find("doubleclick.net") != std::string::npos) {
      printf("[Soggfy-INFO] Blocked ad/analytics/update domain: %s\n", nodename);
      return EAI_NONAME;
    }
  }
  return orig_getaddrinfo(nodename, servname, hints, res);
}

static std::atomic<bool> g_hooks_initialized{false};

static uint64_t now_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch())
      .count();
}


static void TrimInPlace(std::string &value) {
  while (!value.empty() &&
         (value.back() == '\n' || value.back() == '\r' ||
          value.back() == ' ' || value.back() == '\t' || value.back() == '\0')) {
    value.pop_back();
  }
  size_t first = value.find_first_not_of(" \t\r\n\0");
  if (first == std::string::npos) {
    value.clear();
  } else if (first > 0) {
    value.erase(0, first);
  }
}

static bool EnvFlagEnabled(const char *name, bool defaultValue = false) {
  const char *raw = getenv(name);
  if (!raw) return defaultValue;
  std::string value(raw);
  std::transform(value.begin(), value.end(), value.begin(), ::tolower);
  return value == "1" || value == "true" || value == "yes" || value == "on";
}

static std::string SelectedCaptureBackend() {
  const char *raw = getenv("SOGGFY_CAPTURE_BACKEND");
  std::string backend = raw ? raw : "pcm";
  std::transform(backend.begin(), backend.end(), backend.begin(), ::tolower);
  return backend;
}

static bool CaptureBackendAllows(const char *source) {
  const std::string backend = SelectedCaptureBackend();
  if (backend == "disabled") return false;
  if (backend == "all") return true;
  if (backend == "ogg") return strcmp(source, "ogg") == 0;
  // PCM mode: accept all PCM sources
  return true;
}

bool CaptureAudioBuffer(const char *source, const std::string &trackId,
                               const char *data, size_t length) {
  if (!data || length == 0) return false;
  if (!CaptureBackendAllows(source)) return false;

  // Ad-gate: only capture when we've confirmed the target track is playing.
  // Fallback: if we haven't received a notification within 15s of arming,
  // allow capture anyway (graceful degradation if notifications fail).
  if (g_capture_gated.load()) {
    uint64_t armed_at = g_capture_gate_set_ms.load();
    if (armed_at > 0 && (now_ms() - armed_at) > 15000) {
      printf("[Soggfy-AD] Capture gate fallback: no PlaybackStateChanged "
             "notification received within 15s, allowing capture\n");
      g_capture_gated.store(false);
    } else {
      return false; // Still gated — discard this audio buffer
    }
  }

  StateManager::Instance().ReceiveAudioData(trackId, data, length);
  g_last_audio_time_ms.store(now_ms());
  return true;
}

static void MuteAudioBufferListIfRequested(AudioBufferList *ioData) {
  if (!ioData || !EnvFlagEnabled("SOGGFY_MUTE_OUTPUT", false)) return;
  for (UInt32 i = 0; i < ioData->mNumberBuffers; ++i) {
    if (ioData->mBuffers[i].mData && ioData->mBuffers[i].mDataByteSize > 0) {
      memset(ioData->mBuffers[i].mData, 0, ioData->mBuffers[i].mDataByteSize);
    }
  }
}

static std::string JsonEscape(const std::string &value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (char c : value) {
    switch (c) {
    case '\\': out += "\\\\"; break;
    case '"': out += "\\\""; break;
    case '\n': out += "\\n"; break;
    case '\r': out += "\\r"; break;
    case '\t': out += "\\t"; break;
    default: out += c; break;
    }
  }
  return out;
}

// ── AVAssetDecompressor hooks ──

// Hook for -[AVAssetDecompressor initWithURL:audioFormat:errorCode:]
typedef id (*initWithURL_t)(id self, SEL _cmd, id url, void *format,
                            void *errorCode);
static initWithURL_t orig_initWithURL = nullptr;

static id my_initWithURL(id self, SEL _cmd, id url, void *format,
                         void *errorCode) {
  id result = orig_initWithURL(self, _cmd, url, format, errorCode);

  if (url) {
    NSURL *nsUrl = (__bridge NSURL *)url;
    const char *url_str = [[nsUrl absoluteString] UTF8String];
    printf("[Soggfy-INFO] AVAssetDecompressor opened: %s\n",
           url_str ? url_str : "(null)");

    // When Spotify opens a new audio asset, finish the previous track and
    // prepare for the new one
    std::string track_id;
    {
      std::lock_guard<std::mutex> lock(g_track_mutex);
      track_id = g_active_track_id;
    }
    // The first audio data will flow through decodeToBuffer shortly
  }
  return result;
}

// Hook for -[AVAssetDecompressor decodeToBuffer:numberOfFrames:]
typedef int (*decodeToBuffer_t)(id self, SEL _cmd, float *buffer,
                                int numberOfFrames);
static decodeToBuffer_t orig_decodeToBuffer = nullptr;

static int my_decodeToBuffer(id self, SEL _cmd, float *buffer,
                             int numberOfFrames) {
  int framesDecoded = orig_decodeToBuffer(self, _cmd, buffer, numberOfFrames);

  if (framesDecoded > 0 && buffer) {
    std::string track_id;
    {
      std::lock_guard<std::mutex> lock(g_track_mutex);
      track_id = g_active_track_id;
    }

    // Stereo float PCM: framesDecoded frames × 2 channels × 4 bytes/sample.
    // This write is gated by SOGGFY_CAPTURE_BACKEND to prevent duplicate writes
    // from multiple simultaneously hooked paths.
    size_t bytesCount = framesDecoded * 2 * sizeof(float);
    CaptureAudioBuffer("avasset", track_id, (const char *)buffer, bytesCount);
  }
  return framesDecoded;
}

// ── AudioUnitRender hook (CoreAudio low-level fallback) ──

typedef OSStatus (*AudioUnitRender_t)(AudioUnit inUnit,
                                      AudioUnitRenderActionFlags *ioActionFlags,
                                      const AudioTimeStamp *inTimeStamp,
                                      UInt32 inOutputBusNumber,
                                      UInt32 inNumberFrames,
                                      AudioBufferList *ioData);
static AudioUnitRender_t orig_AudioUnitRender = nullptr;
static std::atomic<int> g_au_render_log_count{0};

static OSStatus
my_AudioUnitRender(AudioUnit inUnit, AudioUnitRenderActionFlags *ioActionFlags,
                   const AudioTimeStamp *inTimeStamp, UInt32 inOutputBusNumber,
                   UInt32 inNumberFrames, AudioBufferList *ioData) {
  OSStatus result =
      orig_AudioUnitRender(inUnit, ioActionFlags, inTimeStamp,
                           inOutputBusNumber, inNumberFrames, ioData);

  if (result == noErr && ioData && ioData->mNumberBuffers > 0 &&
      inNumberFrames > 0) {
    // Log first few hits for debugging
    int logCount = g_au_render_log_count.fetch_add(1);
    if (logCount < 10) {
      printf("[Soggfy-AU] AudioUnitRender: bus=%u frames=%u buffers=%u "
             "buf0_size=%u\n",
             inOutputBusNumber, inNumberFrames, ioData->mNumberBuffers,
             ioData->mBuffers[0].mDataByteSize);
    }

    // Only capture output bus 0 (main audio output)
    if (inOutputBusNumber == 0) {
      std::string track_id;
      {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        track_id = g_active_track_id;
      }

      // Interleave all buffers into a single PCM stream
      // Spotify typically uses non-interleaved stereo (2 buffers of float)
      if (ioData->mNumberBuffers == 2) {
        // Non-interleaved stereo — interleave L+R into LRLRLR
        uint32_t frames = inNumberFrames;
        float *left = (float *)ioData->mBuffers[0].mData;
        float *right = (float *)ioData->mBuffers[1].mData;
        if (left && right && frames > 0) {
          std::vector<float> interleaved(frames * 2);
          for (uint32_t i = 0; i < frames; ++i) {
            interleaved[i * 2] = left[i];
            interleaved[i * 2 + 1] = right[i];
          }
          CaptureAudioBuffer("audiounit", track_id,
                             (const char *)interleaved.data(),
                             frames * 2 * sizeof(float));
        }
      } else if (ioData->mNumberBuffers == 1) {
        // Already interleaved
        float *data = (float *)ioData->mBuffers[0].mData;
        uint32_t size = ioData->mBuffers[0].mDataByteSize;
        if (data && size > 0) {
          CaptureAudioBuffer("audiounit", track_id, (const char *)data, size);
        }
      }

      MuteAudioBufferListIfRequested(ioData);
    }
  }
  return result;
}

// ── AudioConverterFillComplexBuffer hook ──

typedef OSStatus (*AudioConverterFillComplexBuffer_t)(
    AudioConverterRef inAudioConverter,
    AudioConverterComplexInputDataProc inInputDataProc,
    void *inInputDataProcUserData, UInt32 *ioOutputDataPacketSize,
    AudioBufferList *outOutputData,
    AudioStreamPacketDescription *outPacketDescription);

static AudioConverterFillComplexBuffer_t orig_AudioConverterFillComplexBuffer =
    nullptr;
static std::atomic<int> g_ac_log_count{0};

static OSStatus my_AudioConverterFillComplexBuffer(
    AudioConverterRef inAudioConverter,
    AudioConverterComplexInputDataProc inInputDataProc,
    void *inInputDataProcUserData, UInt32 *ioOutputDataPacketSize,
    AudioBufferList *outOutputData,
    AudioStreamPacketDescription *outPacketDescription) {

  OSStatus result = orig_AudioConverterFillComplexBuffer(
      inAudioConverter, inInputDataProc, inInputDataProcUserData,
      ioOutputDataPacketSize, outOutputData, outPacketDescription);

  if (result == noErr && outOutputData && outOutputData->mNumberBuffers > 0 &&
      ioOutputDataPacketSize && *ioOutputDataPacketSize > 0) {
    int logCount = g_ac_log_count.fetch_add(1);
    if (logCount < 10) {
      printf("[Soggfy-AC] AudioConverterFillComplexBuffer: frames=%u "
             "buffers=%u buf0_size=%u\n",
             *ioOutputDataPacketSize, outOutputData->mNumberBuffers,
             outOutputData->mBuffers[0].mDataByteSize);
    }

    std::string track_id;
    {
      std::lock_guard<std::mutex> lock(g_track_mutex);
      track_id = g_active_track_id;
    }

    if (outOutputData->mNumberBuffers == 2) {
      uint32_t frames = *ioOutputDataPacketSize;
      float *left = (float *)outOutputData->mBuffers[0].mData;
      float *right = (float *)outOutputData->mBuffers[1].mData;
      if (left && right && frames > 0) {
        std::vector<float> interleaved(frames * 2);
        for (uint32_t i = 0; i < frames; ++i) {
          interleaved[i * 2] = left[i];
          interleaved[i * 2 + 1] = right[i];
        }
        CaptureAudioBuffer("converter", track_id,
                           (const char *)interleaved.data(),
                           frames * 2 * sizeof(float));
      }
    } else if (outOutputData->mNumberBuffers == 1) {
      float *data = (float *)outOutputData->mBuffers[0].mData;
      uint32_t size = outOutputData->mBuffers[0].mDataByteSize;
      if (data && size > 0) {
        CaptureAudioBuffer("converter", track_id, (const char *)data, size);
      }
    }
  }
  return result;
}

// ── AudioUnitSetProperty hook (CoreAudio Output Render Callback) ──

typedef OSStatus (*AudioUnitSetProperty_t)(
    AudioUnit inUnit, AudioUnitPropertyID inID, AudioUnitScope inScope,
    AudioUnitElement inElement, const void *inData, UInt32 inDataSize);

static AudioUnitSetProperty_t orig_AudioUnitSetProperty = nullptr;
static std::map<void *, AURenderCallback> g_render_callbacks;
static std::mutex g_cb_mutex;



static OSStatus my_render_callback(void *inRefCon,
                                   AudioUnitRenderActionFlags *ioActionFlags,
                                   const AudioTimeStamp *inTimeStamp,
                                   UInt32 inBusNumber, UInt32 inNumberFrames,
                                   AudioBufferList *ioData) {

  AURenderCallback orig_cb = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_cb_mutex);
    auto it = g_render_callbacks.find(inRefCon);
    if (it != g_render_callbacks.end())
      orig_cb = it->second;
  }

  if (!orig_cb)
    return noErr;

  std::string track_id;
  {
    std::lock_guard<std::mutex> lock(g_track_mutex);
    track_id = g_active_track_id;
  }

  if (g_decoder_active.load()) {
    // Fast Ogg stream capture active: pull single chunk to keep player thread ticking smoothly,
    // and mute output so high-speed audio does not play to user speakers.
    OSStatus res = orig_cb(inRefCon, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, ioData);
    MuteAudioBufferListIfRequested(ioData);
    return res;
  }

  OSStatus res = orig_cb(inRefCon, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, ioData);
  if (res == noErr && ioData && ioData->mNumberBuffers > 0) {
    if (ioData->mNumberBuffers == 2) {
      uint32_t frames = inNumberFrames;
      float *left = (float *)ioData->mBuffers[0].mData;
      float *right = (float *)ioData->mBuffers[1].mData;
      if (left && right && frames > 0) {
        std::vector<float> interleaved(frames * 2);
        for (uint32_t i = 0; i < frames; ++i) {
          interleaved[i * 2] = left[i];
          interleaved[i * 2 + 1] = right[i];
        }
        CaptureAudioBuffer("callback", track_id,
                           (const char *)interleaved.data(),
                           frames * 2 * sizeof(float));
      }
    } else if (ioData->mNumberBuffers == 1) {
      float *data = (float *)ioData->mBuffers[0].mData;
      uint32_t size = ioData->mBuffers[0].mDataByteSize;
      if (data && size > 0) {
        CaptureAudioBuffer("callback", track_id, (const char *)data, size);
      }
    }
  }

  MuteAudioBufferListIfRequested(ioData);
  return res;
}

static OSStatus my_AudioUnitSetProperty(AudioUnit inUnit,
                                        AudioUnitPropertyID inID,
                                        AudioUnitScope inScope,
                                        AudioUnitElement inElement,
                                        const void *inData, UInt32 inDataSize) {

  if (inID == kAudioUnitProperty_SetRenderCallback &&
      inDataSize == sizeof(AURenderCallbackStruct)) {
    AURenderCallbackStruct *cbStruct = (AURenderCallbackStruct *)inData;
    printf("[Soggfy-AU] AudioUnitSetProperty intercepted SetRenderCallback! "
           "orig_cb=%p\n",
           cbStruct->inputProc);

    {
      std::lock_guard<std::mutex> lock(g_cb_mutex);
      g_render_callbacks[cbStruct->inputProcRefCon] = cbStruct->inputProc;
    }

    std::string active_track;
    {
      std::lock_guard<std::mutex> lock(g_track_mutex);
      active_track = g_active_track_id;
    }

    AURenderCallbackStruct myStruct;
    myStruct.inputProc = my_render_callback;
    myStruct.inputProcRefCon = cbStruct->inputProcRefCon;

    return orig_AudioUnitSetProperty(inUnit, inID, inScope, inElement,
                                     &myStruct, inDataSize);
  }

  return orig_AudioUnitSetProperty(inUnit, inID, inScope, inElement, inData,
                                   inDataSize);
}

// ── Audio idle watchdog ──
// Detects when audio stops flowing and finalizes the track

static void AudioWatchdog() {
  printf("[Soggfy-INFO] Audio watchdog thread started.\n");
  g_watchdog_running.store(true);
  std::string last_finished_track;

  while (g_watchdog_running.load()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));

    uint64_t last = g_last_audio_time_ms.load();
    if (last == 0)
      continue; // No audio received yet

    uint64_t elapsed = now_ms() - last;
    if (elapsed > 3000) { // 3 seconds of silence = track ended
      std::string track_id;
      {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        track_id = g_active_track_id;
      }

      if (track_id != last_finished_track) {
        std::string status =
            StateManager::Instance().GetPlaybackStatus(track_id);
        if (status == "downloading") {
          printf("[Soggfy-INFO] Watchdog: audio idle for %llums, finishing "
                 "track '%s'\n",
                 (unsigned long long)elapsed, track_id.c_str());
          StateManager::Instance().FinishPlayback(track_id);
          last_finished_track = track_id;
        }
      }
    }
  }
}

// ── IPC Server ──

static bool SendResponse(int client_fd, const std::string &response) {
  const char *data = response.c_str();
  size_t remaining = response.size();
  while (remaining > 0) {
    ssize_t written = send(client_fd, data, remaining, 0);
    if (written < 0) {
      printf("[Soggfy-IPC] send failed: %s\n", strerror(errno));
      return false;
    }
    data += written;
    remaining -= (size_t)written;
  }
  return true;
}

static void PersistActiveTrackId(const std::string &track) {
  const char *env_save_path = getenv("SOGGFY_SAVE_PATH");
  std::string save_dir = env_save_path ? env_save_path : "/tmp/Soggfy";
  std::string track_file_path = save_dir + "/active_track.txt";
  FILE *f = fopen(track_file_path.c_str(), "w");
  if (!f) {
    printf("[Soggfy-IPC] Failed to write active track file %s: %s\n",
           track_file_path.c_str(), strerror(errno));
    return;
  }
  fprintf(f, "%s", track.c_str());
  fclose(f);
}

static void ApplySetTrack(const std::string &track) {
  // Arm the capture gate — no audio is captured until the correct track
  // is confirmed playing via PlaybackStateChanged notification.
  g_capture_gated.store(true);
  g_capture_gate_set_ms.store(now_ms());
  g_decoder_active.store(false);
  g_ogg_stream_active.store(false);
  g_active_ogg_serial = 0;

  std::string prev_track;
  {
    std::lock_guard<std::mutex> lock(g_track_mutex);
    prev_track = g_active_track_id;
    g_active_track_id = track;
  }

  if (!prev_track.empty() && prev_track != track) {
    std::string prev_status = StateManager::Instance().GetPlaybackStatus(prev_track);
    if (prev_status == "downloading") {
      printf("[Soggfy-IPC] Finishing previous active track before switch: %s\n",
             prev_track.c_str());
      StateManager::Instance().FinishPlayback(prev_track);
    }
  }

  g_last_audio_time_ms.store(0);
  StateManager::Instance().MarkPlaybackActive(track);
  PersistActiveTrackId(track);
}

void StartIPCServer() {
  int server_fd = -1;
  int client_fd = -1;
  struct sockaddr_un address;
  const char *env_socket_path = getenv("SOGGFY_SOCKET_PATH");
  const char *socket_path =
      env_socket_path ? env_socket_path : "/tmp/soggfy.sock";

  server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (server_fd < 0) {
    printf("[Soggfy-ERROR] IPC socket() failed: %s\n", strerror(errno));
    return;
  }

  unlink(socket_path);
  memset(&address, 0, sizeof(struct sockaddr_un));
  address.sun_family = AF_UNIX;
  strncpy(address.sun_path, socket_path, sizeof(address.sun_path) - 1);

  if (bind(server_fd, (struct sockaddr *)&address, sizeof(struct sockaddr_un)) <
      0) {
    printf("[Soggfy-ERROR] IPC bind(%s) failed: %s\n", socket_path,
           strerror(errno));
    close(server_fd);
    return;
  }
  if (listen(server_fd, 16) < 0) {
    printf("[Soggfy-ERROR] IPC listen(%s) failed: %s\n", socket_path,
           strerror(errno));
    close(server_fd);
    return;
  }

  printf("[Soggfy-INFO] IPC Server listening at %s\n", socket_path);

  while (true) {
    client_fd = accept(server_fd, NULL, NULL);
    if (client_fd < 0) {
      printf("[Soggfy-IPC] accept failed: %s\n", strerror(errno));
      continue;
    }

    char buffer[4096] = {0};
    ssize_t bytesRead = read(client_fd, buffer, sizeof(buffer) - 1);
    if (bytesRead <= 0) {
      printf("[Soggfy-IPC] read failed/empty: %s\n",
             bytesRead < 0 ? strerror(errno) : "empty request");
      close(client_fd);
      continue;
    }
    std::string req(buffer, (size_t)bytesRead);
    TrimInPlace(req);

    if (req == "ping") {
      const char *res = g_hooks_initialized.load() ? "pong" : "initializing";
      SendResponse(client_fd, res);
      printf("[Soggfy-IPC] Received command: ping (response: %s)\n", res);
    } else if (req.rfind("play ", 0) == 0) {
      std::string uri = req.substr(5);
      TrimInPlace(uri);
      printf("[Soggfy-IPC] Received command: play %s\n", uri.c_str());

      dispatch_async(dispatch_get_main_queue(), ^{
        NSAppleEventDescriptor *target = [NSAppleEventDescriptor currentProcessDescriptor];
        NSAppleEventDescriptor *event = [NSAppleEventDescriptor
            appleEventWithEventClass:'spfy'
                             eventID:'PCtx'
                    targetDescriptor:target
                            returnID:kAutoGenerateReturnID
                       transactionID:kAnyTransactionID];
        NSString *urlStr = [NSString stringWithUTF8String:uri.c_str()];
        [event setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:urlStr]
                       forKeyword:keyDirectObject];
        [event setParamDescriptor:[NSAppleEventDescriptor descriptorWithString:urlStr]
                       forKeyword:'cotx'];

        AppleEvent reply;
        OSStatus err = AESendMessage([event aeDesc], &reply, kAENoReply,
                                     kAEDefaultTimeout);
        printf("[Soggfy-INFO] Sent play event to self. Result: %d\n", (int)err);

        // Also send 'Play' unpause event in case track was paused at EOS
        NSAppleEventDescriptor *unpauseEvent = [NSAppleEventDescriptor
            appleEventWithEventClass:'spfy'
                             eventID:'Play'
                    targetDescriptor:target
                            returnID:kAutoGenerateReturnID
                       transactionID:kAnyTransactionID];
        AESendMessage([unpauseEvent aeDesc], &reply, kAENoReply, kAEDefaultTimeout);
      });
      SendResponse(client_fd, "ok");
    } else if (req == "pause") {
      printf("[Soggfy-IPC] Received command: pause\n");
      dispatch_async(dispatch_get_main_queue(), ^{
        NSAppleEventDescriptor *target = [NSAppleEventDescriptor currentProcessDescriptor];
        NSAppleEventDescriptor *event = [NSAppleEventDescriptor
            appleEventWithEventClass:'spfy'
                             eventID:'Paus'
                    targetDescriptor:target
                            returnID:kAutoGenerateReturnID
                       transactionID:kAnyTransactionID];
        AppleEvent reply;
        OSStatus err = AESendMessage([event aeDesc], &reply, kAENoReply,
                                     kAEDefaultTimeout);
        printf("[Soggfy-INFO] Sent pause event to self. Result: %d\n", (int)err);
      });
      SendResponse(client_fd, "ok");
    } else if (req.rfind("set_track ", 0) == 0) {
      std::string track = req.substr(10);
      TrimInPlace(track);
      ApplySetTrack(track);
      SendResponse(client_fd, "ok");
      printf("[Soggfy-IPC] Received command: set_track %s (captureBackend=%s)\n",
             track.c_str(), SelectedCaptureBackend().c_str());
    } else if (req.rfind("set_path ", 0) == 0) {
      std::string path = req.substr(9);
      TrimInPlace(path);
      StateManager::Instance().SetBaseSavePath(path);
      SendResponse(client_fd, "path updated");
    } else if (req.rfind("set_duration ", 0) == 0) {
      char track_buf[256] = {0};
      uint32_t duration_ms = 0;
      std::string args = req.substr(13);
      if (sscanf(args.c_str(), "%255s %u", track_buf, &duration_ms) == 2) {
        StateManager::Instance().SetPlaybackDuration(track_buf, duration_ms);
        SendResponse(client_fd, "duration set");
      } else {
        SendResponse(client_fd, "error invalid duration args");
      }
    } else if (req.rfind("get_metrics ", 0) == 0) {
      std::string track = req.substr(12);
      TrimInPlace(track);
      std::string status = StateManager::Instance().GetPlaybackStatus(track);
      uint64_t bytes = StateManager::Instance().GetPlaybackBytes(track);
      uint64_t limit = StateManager::Instance().GetPlaybackLimitBytes(track);
      std::string file = StateManager::Instance().GetPlaybackFileName(track);
      char response[2048];
      snprintf(response, sizeof(response),
               "{\"ok\":true,\"trackId\":\"%s\",\"status\":\"%s\",\"captureBackend\":\"%s\",\"bytesWritten\":%llu,\"limitBytes\":%llu,\"fileName\":\"%s\"}",
               JsonEscape(track).c_str(), JsonEscape(status).c_str(),
               JsonEscape(SelectedCaptureBackend()).c_str(),
               (unsigned long long)bytes, (unsigned long long)limit,
               JsonEscape(file).c_str());
      SendResponse(client_fd, response);
    } else if (req.rfind("get_status ", 0) == 0) {
      std::string track = req.substr(11);
      TrimInPlace(track);
      std::string status = StateManager::Instance().GetPlaybackStatus(track);
      SendResponse(client_fd, status);
    } else if (req.rfind("cancel_track ", 0) == 0) {
      std::string track = req.substr(13);
      TrimInPlace(track);
      StateManager::Instance().CancelPlayback(track);
      SendResponse(client_fd, "track cancelled");
    } else if (req.rfind("finish_track ", 0) == 0) {
      std::string track = req.substr(13);
      TrimInPlace(track);
      StateManager::Instance().FinishPlayback(track);
      SendResponse(client_fd, "track finished");
    } else if (req.rfind("reset_track ", 0) == 0) {
      std::string track = req.substr(12);
      TrimInPlace(track);
      StateManager::Instance().ResetPlayback(track);
      SendResponse(client_fd, "track reset");
    } else if (req == "get_playing") {
      std::string uri;
      {
        std::lock_guard<std::mutex> lock(g_playing_mutex);
        uri = g_confirmed_playing_uri;
      }
      bool is_ad = (uri.find("spotify:ad:") != std::string::npos);
      bool gated = g_capture_gated.load();
      char response[2048];
      snprintf(response, sizeof(response),
               "{\"uri\":\"%s\",\"is_ad\":%s,\"gated\":%s}",
               JsonEscape(uri).c_str(),
               is_ad ? "true" : "false",
               gated ? "true" : "false");
      SendResponse(client_fd, response);
    } else {
      SendResponse(client_fd, "error unknown command");
    }

    close(client_fd);
  }
}

// ── Hook Setup ──

void SetupImmediateHooks() {
  const char *keylog_env = getenv("SSLKEYLOGFILE");
  if (!keylog_env || strlen(keylog_env) == 0) {
    setenv("SSLKEYLOGFILE", "/tmp/sslkeylog.log", 1);
  }
  printf("[Soggfy-INFO] SSLKEYLOGFILE configured at %s\n", getenv("SSLKEYLOGFILE"));

  printf("[Soggfy-DEBUG] Initializing immediate hooks (focus containment, "
         "window hiding, profile redirection)...\n");

  @try {
    [[NSProcessInfo processInfo] beginActivityWithOptions:0x00FFFFFFULL reason:@"Soggfy Audio Interception"];
  } @catch (id ex) {}

  // ── Strategy 6: Focus Suppression & Headless/Hidden Window Hooks ──
  Class appCls = objc_getClass("NSApplication");
  if (appCls) {
    Method m = class_getInstanceMethod(
        appCls, sel_registerName("activateIgnoringOtherApps:"));
    if (m) {
      IMP imp = method_getImplementation(m);
      int res = DobbyHook((void *)imp, (void *)my_activateIgnoringOtherApps,
                          (void **)&orig_activateIgnoringOtherApps);
      printf("[Soggfy-INFO] Hooked activateIgnoringOtherApps: result=%d\n",
             res);
    }
  }

  Class runCls = objc_getClass("NSRunningApplication");
  if (runCls) {
    Method m = class_getClassMethod(
        runCls, sel_registerName("runningApplicationsWithBundleIdentifier:"));
    if (m) {
      IMP imp = method_getImplementation(m);
      int res = DobbyHook((void *)imp,
                          (void *)my_runningApplicationsWithBundleIdentifier,
                          (void **)&orig_runningApplicationsWithBundleIdentifier);
      printf("[Soggfy-INFO] Hooked runningApplicationsWithBundleIdentifier: "
             "result=%d\n",
             res);
    }
  }

  Class winCls = objc_getClass("NSWindow");
  if (winCls) {
    Method m1 = class_getInstanceMethod(
        winCls, sel_registerName("makeKeyAndOrderFront:"));
    if (m1) {
      IMP imp = method_getImplementation(m1);
      int res = DobbyHook((void *)imp, (void *)my_makeKeyAndOrderFront,
                          (void **)&orig_makeKeyAndOrderFront);
      printf("[Soggfy-INFO] Hooked makeKeyAndOrderFront: result=%d\n", res);
    }
    Method m2 =
        class_getInstanceMethod(winCls, sel_registerName("orderFront:"));
    if (m2) {
      IMP imp = method_getImplementation(m2);
      int res = DobbyHook((void *)imp, (void *)my_orderFront,
                          (void **)&orig_orderFront);
      printf("[Soggfy-INFO] Hooked orderFront: result=%d\n", res);
    }
    Method m3 = class_getInstanceMethod(
        winCls, sel_registerName("orderFrontRegardless"));
    if (m3) {
      IMP imp = method_getImplementation(m3);
      int res = DobbyHook((void *)imp, (void *)my_orderFrontRegardless,
                          (void **)&orig_orderFrontRegardless);
      printf("[Soggfy-INFO] Hooked orderFrontRegardless: result=%d\n", res);
    }
  }

  // ── Strategy 7: Directory & Home Redirection Hooks ──
  void *nsSearch = dlsym(RTLD_DEFAULT, "NSSearchPathForDirectoriesInDomains");
  if (nsSearch) {
    int res =
        DobbyHook(nsSearch, (void *)my_NSSearchPathForDirectoriesInDomains,
                  (void **)&orig_NSSearchPathForDirectoriesInDomains);
    printf(
        "[Soggfy-INFO] Hooked NSSearchPathForDirectoriesInDomains: result=%d\n",
        res);
  } else {
    printf("[Soggfy-WARN] NSSearchPathForDirectoriesInDomains not found via "
           "dlsym\n");
  }

  void *nsHome = dlsym(RTLD_DEFAULT, "NSHomeDirectory");
  if (nsHome) {
    int res = DobbyHook(nsHome, (void *)my_NSHomeDirectory,
                        (void **)&orig_NSHomeDirectory);
    printf("[Soggfy-INFO] Hooked NSHomeDirectory: result=%d\n", res);
  } else {
    printf("[Soggfy-WARN] NSHomeDirectory not found via dlsym\n");
  }

  void *nsTmp = dlsym(RTLD_DEFAULT, "NSTemporaryDirectory");
  if (nsTmp) {
    int res = DobbyHook(nsTmp, (void *)my_NSTemporaryDirectory,
                        (void **)&orig_NSTemporaryDirectory);
    printf("[Soggfy-INFO] Hooked NSTemporaryDirectory: result=%d\n", res);
  } else {
    printf("[Soggfy-WARN] NSTemporaryDirectory not found via dlsym\n");
  }

  DobbyHook((void *)getaddrinfo, (void *)my_getaddrinfo,
            (void **)&orig_getaddrinfo);
  printf("[Soggfy-INFO] Hooked getaddrinfo\n");

  InstallDecoderHook();

  printf("[Soggfy-INFO] Immediate hooks setup complete.\n");
}

static std::atomic<bool> g_audio_hooks_installed{false};

void SetupAudioHooks() {
  if (g_audio_hooks_installed.exchange(true)) return;
  printf("[Soggfy-DEBUG] SetupAudioHooks called!\n");
  fflush(stdout);
  InstallDecoderHook();

  // ── Strategy 1: Hook AVAssetDecompressor (Apple's native AAC decoder) ──
  Class cls = objc_getClass("AVAssetDecompressor");
  if (cls) {
    printf("[Soggfy-INFO] Found AVAssetDecompressor class at %p\n", cls);

    Method m1 = class_getInstanceMethod(
        cls, sel_registerName("initWithURL:audioFormat:errorCode:"));
    if (m1) {
      IMP imp1 = method_getImplementation(m1);
      int res1 = DobbyHook((void *)imp1, (void *)my_initWithURL,
                           (void **)&orig_initWithURL);
      printf("[Soggfy-INFO] Hooked initWithURL: result=%d (orig=%p)\n", res1,
             (void *)orig_initWithURL);
    } else {
      printf("[Soggfy-WARN] initWithURL:audioFormat:errorCode: method not "
             "found\n");
    }

    Method m2 = class_getInstanceMethod(
        cls, sel_registerName("decodeToBuffer:numberOfFrames:"));
    if (m2) {
      IMP imp2 = method_getImplementation(m2);
      int res2 = DobbyHook((void *)imp2, (void *)my_decodeToBuffer,
                           (void **)&orig_decodeToBuffer);
      printf("[Soggfy-INFO] Hooked decodeToBuffer: result=%d (orig=%p)\n", res2,
             (void *)orig_decodeToBuffer);
    } else {
      printf("[Soggfy-WARN] decodeToBuffer:numberOfFrames: method not found\n");
    }
  } else {
    printf("[Soggfy-WARN] AVAssetDecompressor class not found.\n");
  }

  // ── Strategy 2: Scan the entire ObjC runtime for audio-related classes ──
  printf("[Soggfy-DEBUG] Scanning ObjC runtime for audio-related classes...\n");
  unsigned int classCount = 0;
  Class *allClasses = objc_copyClassList(&classCount);
  printf("[Soggfy-DEBUG] Total ObjC classes loaded: %u\n", classCount);

  for (unsigned int i = 0; i < classCount; ++i) {
    const char *name = class_getName(allClasses[i]);
    if (!name)
      continue;

    // Match any class with "audio", "Audio", "decode", "Decode", "decompress",
    // "codec" in name
    bool match = false;
    if (strcasestr(name, "audio") || strcasestr(name, "decode") ||
        strcasestr(name, "decompress") || strcasestr(name, "codec") ||
        strcasestr(name, "pcm") || strcasestr(name, "render") ||
        strcasestr(name, "ogg") || strcasestr(name, "vorbis") ||
        strcasestr(name, "aac") || strcasestr(name, "media")) {
      match = true;
    }

    if (match) {
      // printf("[Soggfy-SCAN] Found class: %s\n", name);

      // List methods that look like decode/render/buffer operations
      unsigned int methodCount = 0;
      Method *methods = class_copyMethodList(allClasses[i], &methodCount);
      for (unsigned int j = 0; j < methodCount && j < 30; ++j) {
        SEL sel = method_getName(methods[j]);
        const char *selName = sel_getName(sel);
        if (strcasestr(selName, "decode") || strcasestr(selName, "render") ||
            strcasestr(selName, "buffer") || strcasestr(selName, "frame") ||
            strcasestr(selName, "sample") || strcasestr(selName, "pcm") ||
            strcasestr(selName, "init") || strcasestr(selName, "read") ||
            strcasestr(selName, "write") || strcasestr(selName, "play") ||
            strcasestr(selName, "output") || strcasestr(selName, "process")) {
          // printf("[Soggfy-SCAN]   -> %s\n", selName);
        }
      }
      free(methods);
    }
  }
  free(allClasses);

  // ── Strategy 3: Hook CoreAudio AudioUnitRender ──
  // This is the LOWEST level audio render function. All audio on macOS
  // eventually passes through here. If Spotify uses AudioToolbox/CoreAudio
  // (which it does), this WILL fire.
  void *auRender = dlsym(RTLD_DEFAULT, "AudioUnitRender");
  if (auRender) {
    printf("[Soggfy-INFO] Found AudioUnitRender at %p — hooking as fallback\n",
           auRender);
    int res = DobbyHook(auRender, (void *)my_AudioUnitRender,
                        (void **)&orig_AudioUnitRender);
    printf("[Soggfy-INFO] Hooked AudioUnitRender: result=%d\n", res);
  } else {
    printf("[Soggfy-WARN] AudioUnitRender not found via dlsym\n");
  }

  // ── Strategy 4: Hook AudioConverterFillComplexBuffer ──
  void *acFill = dlsym(RTLD_DEFAULT, "AudioConverterFillComplexBuffer");
  if (acFill) {
    printf("[Soggfy-INFO] Found AudioConverterFillComplexBuffer at %p\n",
           acFill);
    int res = DobbyHook(acFill, (void *)my_AudioConverterFillComplexBuffer,
                        (void **)&orig_AudioConverterFillComplexBuffer);
    printf("[Soggfy-INFO] Hooked AudioConverterFillComplexBuffer: result=%d\n",
           res);
  } else {
    printf(
        "[Soggfy-WARN] AudioConverterFillComplexBuffer not found via dlsym\n");
  }

  // ── Strategy 5: Hook AudioUnitSetProperty (Render Callback Interception) ──
  void *auSetProp = dlsym(RTLD_DEFAULT, "AudioUnitSetProperty");
  if (auSetProp) {
    printf("[Soggfy-INFO] Found AudioUnitSetProperty at %p\n", auSetProp);
    int res = DobbyHook(auSetProp, (void *)my_AudioUnitSetProperty,
                        (void **)&orig_AudioUnitSetProperty);
    printf("[Soggfy-INFO] Hooked AudioUnitSetProperty: result=%d\n", res);
  } else {
    printf("[Soggfy-WARN] AudioUnitSetProperty not found via dlsym\n");
  }

  printf("[Soggfy-INFO] Audio hooks setup complete.\n");
}

// ── Entry Point ──

static void SyncTrackIdThread() {
  const char *env_save_path = getenv("SOGGFY_SAVE_PATH");
  std::string save_dir = env_save_path ? env_save_path : "/tmp/Soggfy";
  std::string track_file_path = save_dir + "/active_track.txt";

  while (true) {
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    FILE *f = fopen(track_file_path.c_str(), "r");
    if (f) {
      char buf[256] = {0};
      if (fgets(buf, sizeof(buf), f)) {
        std::string tid(buf);
        // trim newline
        if (!tid.empty() && tid.back() == '\n')
          tid.pop_back();
        std::string current_id;
        {
          std::lock_guard<std::mutex> lock(g_track_mutex);
          current_id = g_active_track_id;
        }
        if (!tid.empty() && tid != current_id) {
          std::lock_guard<std::mutex> lock(g_track_mutex);
          g_active_track_id = tid;
          g_capture_gated.store(false);
        }
      }
      fclose(f);
    }
  }
}

__attribute__((constructor)) void SoggfyEntryPoint() {
  freopen("/tmp/soggfy.log", "a", stdout);
  freopen("/tmp/soggfy.log", "a", stderr);
  setvbuf(stdout, NULL, _IONBF, 0);
  setvbuf(stderr, NULL, _IONBF, 0);

  // Setup focus, window and directory redirection hooks immediately at load
  // time
  SetupImmediateHooks();

  bool is_main_process = true;
  char path[1024];
  uint32_t size = sizeof(path);
  if (_NSGetExecutablePath(path, &size) == 0) {
    std::string exe_path(path);
    if (exe_path.find("Spotify Helper") != std::string::npos ||
        exe_path.find("SpotifyHelper") != std::string::npos) {
      is_main_process = false;
    }
  }

  printf("[Soggfy-INFO] Soggfy payload v2.0 active (PID %d, Main=%d)\n",
         getpid(), is_main_process);

  // Create Soggfy dir if it doesn't exist
  const char *env_save_path = getenv("SOGGFY_SAVE_PATH");
  std::string save_dir = env_save_path ? env_save_path : "/tmp/Soggfy";
  mkdir(save_dir.c_str(), 0777);

  if (is_main_process) {
    // Register for Spotify's PlaybackStateChanged notifications to detect
    // ads vs target tracks. This gates audio capture so only the requested
    // track's audio is written to the output WAV.
    [[NSDistributedNotificationCenter defaultCenter]
        addObserverForName:@"com.spotify.client.PlaybackStateChanged"
        object:nil
        queue:nil
        usingBlock:^(NSNotification *note) {
          NSDictionary *info = note.userInfo;
          NSString *trackIdNS = info[@"Track ID"];
          NSString *playerState = info[@"Player State"];
          if (!trackIdNS) return;

          std::string uri = [trackIdNS UTF8String];
          {
            std::lock_guard<std::mutex> lock(g_playing_mutex);
            g_confirmed_playing_uri = uri;
          }

          std::string target;
          {
            std::lock_guard<std::mutex> lock(g_track_mutex);
            target = g_active_track_id;
          }

          bool is_ad = (uri.find("spotify:ad:") != std::string::npos);
          bool matches_target = (!target.empty() &&
                                 uri.find(target) != std::string::npos);

          if (is_ad) {
            g_capture_gated.store(true);
            printf("[Soggfy-AD] Advertisement detected: %s — capture gated\n",
                   uri.c_str());
          } else if (matches_target) {
            g_capture_gated.store(false);
            printf("[Soggfy-AD] Target track confirmed playing: %s\n",
                   uri.c_str());
          } else {
            // Non-target, non-ad track (e.g. autoplay next song) — keep gated
            g_capture_gated.store(true);
            printf("[Soggfy-AD] Non-target track playing: %s (target: %s) "
                   "— capture gated\n",
                   uri.c_str(), target.c_str());
          }
        }];
    printf("[Soggfy-INFO] Registered PlaybackStateChanged observer for "
           "ad-gated capture.\n");

    // Only main process handles IPC to avoid socket collisions
    std::thread(StartIPCServer).detach();
  } else {
    // Helper processes poll the shared file for track ID updates
    std::thread(SyncTrackIdThread).detach();
  }

  // Start audio idle watchdog (all processes, since we don't know which one
  // handles audio)
  std::thread(AudioWatchdog).detach();

  // Setup audio hooks immediately across processes
  SetupAudioHooks();
  g_hooks_initialized.store(true);
}