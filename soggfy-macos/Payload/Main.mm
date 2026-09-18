#include "CapturePolicy.h"
#include "DecodeHook.h"
#include "OggPreRoll.h"
#include "Scanner.h"
#include "StateManager.h"
#include "ProcessRole.h"
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
#include <condition_variable>
#include <dlfcn.h>
#include <fcntl.h>
#include <fstream>
#include <iostream>
#include <sstream>
#include <mach-o/dyld.h>
#include <mach/mach.h>
#include <map>
#include <memory>
#include <mutex>
#include <objc/message.h>
#include <objc/runtime.h>
#include <string>
#include <sys/socket.h>
#include <sys/time.h>
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
    printf("[Soggfy-INFO] setActivationPolicy: Forcing prohibited activation "
           "policy for faceless daemon runtime.\n");
    return orig_setActivationPolicy(self, _cmd,
                                    NSApplicationActivationPolicyProhibited);
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
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1") return;
  orig_makeKeyAndOrderFront(self, _cmd, sender);
}

typedef void (*orderFront_t)(id self, SEL _cmd, id sender);
static orderFront_t orig_orderFront = nullptr;

static void my_orderFront(id self, SEL _cmd, id sender) {
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1") return;
  orig_orderFront(self, _cmd, sender);
}

typedef void (*orderFrontRegardless_t)(id self, SEL _cmd);
static orderFrontRegardless_t orig_orderFrontRegardless = nullptr;

static void my_orderFrontRegardless(id self, SEL _cmd) {
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1") return;
  orig_orderFrontRegardless(self, _cmd);
}

typedef void (*orderWindow_t)(id self, SEL _cmd, NSWindowOrderingMode place,
                              NSInteger relativeTo);
static orderWindow_t orig_orderWindow = nullptr;

static void my_orderWindow(id self, SEL _cmd, NSWindowOrderingMode place,
                           NSInteger relativeTo) {
  const char *env_hidden = getenv("SOGGFY_HIDDEN");
  if (env_hidden && std::string(env_hidden) == "1" && place != NSWindowOut) {
    orig_orderWindow(self, _cmd, NSWindowOut, relativeTo);
    return;
  }
  orig_orderWindow(self, _cmd, place, relativeTo);
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
std::atomic<bool> g_capture_gated{true};
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

void MarkAudioActivity() {
  g_last_audio_time_ms.store(now_ms());
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

// ── Output muting hook ──
// Ogg capture happens before decoded PCM reaches CoreAudio. This wrapper never
// interprets audio bytes; it only zeroes the buffers after Spotify renders them.
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
    if (it != g_render_callbacks.end()) orig_cb = it->second;
  }
  if (!orig_cb) return noErr;

  const OSStatus result = orig_cb(inRefCon, ioActionFlags, inTimeStamp,
                                  inBusNumber, inNumberFrames, ioData);
  if (result == noErr) MuteAudioBufferListIfRequested(ioData);
  return result;
}

static OSStatus my_AudioUnitSetProperty(AudioUnit inUnit,
                                        AudioUnitPropertyID inID,
                                        AudioUnitScope inScope,
                                        AudioUnitElement inElement,
                                        const void *inData, UInt32 inDataSize) {
  if (inID == kAudioUnitProperty_SetRenderCallback &&
      inData && inDataSize == sizeof(AURenderCallbackStruct)) {
    const auto *cbStruct = static_cast<const AURenderCallbackStruct *>(inData);
    if (cbStruct->inputProc) {
      {
        std::lock_guard<std::mutex> lock(g_cb_mutex);
        g_render_callbacks[cbStruct->inputProcRefCon] = cbStruct->inputProc;
      }
      AURenderCallbackStruct replacement = *cbStruct;
      replacement.inputProc = my_render_callback;
      return orig_AudioUnitSetProperty(inUnit, inID, inScope, inElement,
                                       &replacement, sizeof(replacement));
    }
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
          // Ogg capture has an explicit, stream-authenticated EOS signal in
          // DecodeHook. Idle gaps can occur during accelerated/cached
          // extraction and are not evidence that the stream ended. Let the
          // Ogg path finalize only on EOS (or explicit cancel/finish); the
          // caller's bounded capture timeout remains the failure safety net.
          if (StateManager::Instance().OwnsWriter(track_id, "ogg")) {
            continue;
          }
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

static std::string SharedSaveDir() {
  const char *env_save_path = getenv("SOGGFY_SAVE_PATH");
  return env_save_path ? env_save_path : "/tmp/Soggfy";
}

static void WritePrivateSharedFile(const std::string &name, const std::string &value) {
  const std::string path = SharedSaveDir() + "/" + name;
  const std::string temp = path + ".tmp." + std::to_string(getpid());
  int fd = open(temp.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) {
    printf("[Soggfy-IPC] Failed to write %s: %s\n", temp.c_str(), strerror(errno));
    return;
  }
  const char *data = value.data();
  size_t remaining = value.size();
  while (remaining > 0) {
    const ssize_t written = write(fd, data, remaining);
    if (written <= 0) {
      printf("[Soggfy-IPC] Failed to write %s: %s\n", temp.c_str(), strerror(errno));
      close(fd);
      unlink(temp.c_str());
      return;
    }
    data += written;
    remaining -= (size_t)written;
  }
  close(fd);
  if (rename(temp.c_str(), path.c_str()) != 0) {
    printf("[Soggfy-IPC] Failed to publish %s: %s\n", path.c_str(), strerror(errno));
    unlink(temp.c_str());
  }
}

static std::atomic<uint64_t> g_capture_gate_epoch{0};
static std::mutex g_capture_gate_publish_mutex;

static void PersistCaptureGate(bool gated) {
  std::lock_guard<std::mutex> lock(g_capture_gate_publish_mutex);
  g_capture_gated.store(gated);
  const uint64_t epoch = g_capture_gate_epoch.fetch_add(1) + 1;
  WritePrivateSharedFile(
      "capture_gate.txt",
      std::string(gated ? "1 " : "0 ") + std::to_string(epoch) + "\n");
}

static void PersistActiveTrackId(const std::string &track) {
  WritePrivateSharedFile("active_track.txt",
                         track + " " + std::to_string(now_ms()) + "\n");
}

static void ApplySetTrack(const std::string &track) {
  // Arm the capture gate — no audio is captured until the correct track
  // is confirmed playing via PlaybackStateChanged notification.
  PersistCaptureGate(true);
  ResetOggCaptureState(track);

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
      StateManager::Instance().PublishFinish(prev_track);
      if (StateManager::Instance().OwnsWriter(prev_track))
        StateManager::Instance().FinishPlayback(prev_track);
    }
  }

  g_last_audio_time_ms.store(0);
  StateManager::Instance().ResetPlayback(track);
  PersistActiveTrackId(track);
}

// Called on the IPC worker, never the UI thread. Do not inject the payload
// into control tools or their children, or redirect their protocol output.
static bool RunSpotifyTool(NSString *path, NSArray<NSString *> *arguments, double timeout) {
  @try {
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:path];
    task.arguments = arguments;
    NSMutableDictionary *env = [[[NSProcessInfo processInfo] environment] mutableCopy];
    [env removeObjectForKey:@"DYLD_INSERT_LIBRARIES"];
    task.environment = env;
    task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) return false;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds((int)(timeout * 1000));
    while (task.running && std::chrono::steady_clock::now() < deadline)
      std::this_thread::sleep_for(std::chrono::milliseconds(20));
    if (task.running) { kill(task.processIdentifier, SIGKILL); [task waitUntilExit]; return false; }
    [task waitUntilExit];
    return task.terminationStatus == 0;
  } @catch (NSException *) { return false; }
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
  if (chmod(socket_path, 0600) != 0) {
    printf("[Soggfy-WARN] IPC chmod(%s) failed: %s\n", socket_path, strerror(errno));
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

    const struct timeval receive_timeout = {2, 0};
    if (setsockopt(client_fd, SOL_SOCKET, SO_RCVTIMEO, &receive_timeout,
                   sizeof(receive_timeout)) != 0) {
      printf("[Soggfy-WARN] IPC receive timeout setup failed: %s\n", strerror(errno));
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
    } else if (req == "get_capabilities") {
      char response[512];
      snprintf(response, sizeof(response),
               R"({"hooksInitialized":%s,"decoderHooksReady":%s,"captureBackend":"%s"})",
               g_hooks_initialized.load() ? "true" : "false",
               g_decoder_hooks_ready.load() ? "true" : "false",
               CaptureBackendName(SelectedCaptureBackend()));
      SendResponse(client_fd, response);
    } else if (req.rfind("play ", 0) == 0) {
      std::string uri = req.substr(5);
      TrimInPlace(uri);
      if (uri.rfind("spotify:track:", 0) != 0 || uri.size() != 36 ||
          uri.find_first_not_of("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 14) != std::string::npos) {
        SendResponse(client_fd, "error invalid track URI");
      } else {
        // AppleEvent PCtx triggers a second auto_play_on_load context transition
        // in Spotify 1.2.98. Use Spotify's signed local CLI exactly once instead.
        @autoreleasepool {
          NSString *cli = [[[NSBundle mainBundle] bundlePath]
              stringByAppendingPathComponent:@"Contents/MacOS/spotify_cli"];
          NSString *pid = [NSString stringWithFormat:@"%d", getpid()];
          bool ownsListener = RunSpotifyTool(@"/usr/sbin/lsof",
              @[@"-nP", @"-a", @"-p", pid, @"-iTCP:7768", @"-sTCP:LISTEN"], 2.0);
          bool signedCli = ownsListener && RunSpotifyTool(@"/usr/bin/codesign",
              @[@"--verify", @"--strict", @"-R",
                @"=anchor apple generic and certificate leaf[subject.OU] = \"2FNC3A47ZF\"", cli], 2.0);
          if (!ownsListener) {
            SendResponse(client_fd, "error Spotify local control port 7768 is not owned by this instance");
          } else if (!signedCli) {
            SendResponse(client_fd, "error Spotify CLI signature invalid; reinstall from the official bundle");
          } else if (RunSpotifyTool(cli, @[@"play", [NSString stringWithUTF8String:uri.c_str()]], 8.0)) {
            SendResponse(client_fd, "ok");
          } else {
            SendResponse(client_fd, "error Spotify CLI playback failed or timed out; not replaying");
          }
        }
      }
    } else if (req == "pause") {
      printf("[Soggfy-IPC] Received command: pause\n");
      @autoreleasepool {
        NSString *cli = [[[NSBundle mainBundle] bundlePath]
            stringByAppendingPathComponent:@"Contents/MacOS/spotify_cli"];
        if (RunSpotifyTool(cli, @[@"pause"], 5.0)) {
          SendResponse(client_fd, "ok");
        } else {
          SendResponse(client_fd, "error Spotify CLI pause failed or timed out");
        }
      }
    } else if (req.rfind("set_track ", 0) == 0) {
      std::string track = req.substr(10);
      TrimInPlace(track);
      ApplySetTrack(track);
      SendResponse(client_fd, "ok");
      printf("[Soggfy-IPC] Received command: set_track %s (captureBackend=%s)\n",
             track.c_str(), CaptureBackendName(SelectedCaptureBackend()));
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
        auto &state = StateManager::Instance();
        state.PublishDuration(track_buf, duration_ms);
        if (state.OwnsWriter(track_buf)) state.SetPlaybackDuration(track_buf, duration_ms);
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
               JsonEscape(CaptureBackendName(SelectedCaptureBackend())).c_str(),
               (unsigned long long)bytes, (unsigned long long)limit,
               JsonEscape(file).c_str());
      SendResponse(client_fd, response);
    } else if (req.rfind("set_decode_speed ", 0) == 0) {
      double speed = 0.0;
      char extra = 0;
      const std::string args = req.substr(17);
      if (sscanf(args.c_str(), "%lf %c", &speed, &extra) == 1 && SetCaptureDecodeSpeed(speed)) {
        char response[96];
        snprintf(response, sizeof(response), "decode speed %.3f", GetCaptureDecodeSpeed());
        SendResponse(client_fd, response);
      } else {
        SendResponse(client_fd, "error decode speed must be between 1 and 64");
      }
    } else if (req == "get_decode_speed") {
      char response[64];
      snprintf(response, sizeof(response), "%.3f", GetCaptureDecodeSpeed());
      SendResponse(client_fd, response);
    } else if (req.rfind("get_status ", 0) == 0) {
      std::string track = req.substr(11);
      TrimInPlace(track);
      std::string status = StateManager::Instance().GetPlaybackStatus(track);
      SendResponse(client_fd, status);
    } else if (req.rfind("cancel_track ", 0) == 0) {
      std::string track = req.substr(13);
      TrimInPlace(track);
      auto &state = StateManager::Instance();
      state.PublishCancel(track);
      if (state.OwnsWriter(track)) state.CancelPlayback(track);
      SendResponse(client_fd, "track cancelled");
    } else if (req.rfind("finish_track ", 0) == 0) {
      std::string track = req.substr(13);
      TrimInPlace(track);
      auto &state = StateManager::Instance();
      state.PublishFinish(track);
      if (state.OwnsWriter(track)) state.FinishPlayback(track);
      SendResponse(client_fd, "track finished");
    } else if (req.rfind("reset_track ", 0) == 0) {
      std::string track = req.substr(12);
      TrimInPlace(track);
      StateManager::Instance().ResetPlayback(track);
      SendResponse(client_fd, "track reset");
    } else if (req == "get_playing") {
      struct SnapshotRequest {
        std::mutex mutex;
        std::condition_variable ready;
        std::string response = "{}";
        bool completed = false;
      };
      auto snapshot_request = std::make_shared<SnapshotRequest>();
      dispatch_async(dispatch_get_main_queue(), ^{
        std::string response = "{}";
        @autoreleasepool {
          @try {
            id app = [NSClassFromString(@"NSApplication") performSelector:@selector(sharedApplication)];
            id track = [app valueForKey:@"currentTrack"];
            NSString *uri = track ? [track valueForKey:@"applescriptID"] : @"";
            NSNumber *state = [app valueForKey:@"playerState"];
            NSNumber *position = [app valueForKey:@"playbackPosition"];
            NSString *state_value = @"unknown";
            if (state) {
              state_value = state.intValue == 1 ? @"playing"
                          : state.intValue == 2 ? @"paused"
                          : state.intValue == 0 ? @"stopped"
                          : @"unknown";
            }
            NSDictionary *snapshot = @{
              @"uri": uri ?: @"", @"state": state_value,
              @"position": position ?: @0, @"is_ad": @([uri hasPrefix:@"spotify:ad:"]),
              @"gated": @(g_capture_gated.load())
            };
            NSData *data = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:nil];
            if (data) response.assign((const char *)data.bytes, data.length);
          } @catch (NSException *) {}
        }
        {
          std::lock_guard<std::mutex> lock(snapshot_request->mutex);
          snapshot_request->response = std::move(response);
          snapshot_request->completed = true;
        }
        snapshot_request->ready.notify_one();
      });

      std::string response = "{}";
      {
        std::unique_lock<std::mutex> lock(snapshot_request->mutex);
        const bool completed = snapshot_request->ready.wait_for(
            lock, std::chrono::milliseconds(750),
            [&] { return snapshot_request->completed; });
        if (completed) response = snapshot_request->response;
        else printf("[Soggfy-IPC] get_playing main-queue snapshot timed out\n");
      }
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
  if (keylog_env && strlen(keylog_env) > 0) {
    printf("[Soggfy-DEBUG] TLS key logging enabled at %s\n", keylog_env);
  }

  printf("[Soggfy-DEBUG] Initializing immediate hooks (focus containment, "
         "window hiding, profile redirection)...\n");

  @try {
    [[NSProcessInfo processInfo] beginActivityWithOptions:0x00FFFFFFULL reason:@"Soggfy Audio Interception"];
  } @catch (id ex) {}

  // ── Strategy 6: Focus Suppression & Headless/Hidden Window Hooks ──
  Class appCls = objc_getClass("NSApplication");
  if (appCls) {
    Method activationPolicyMethod = class_getInstanceMethod(
        appCls, sel_registerName("setActivationPolicy:"));
    if (activationPolicyMethod) {
      IMP imp = method_getImplementation(activationPolicyMethod);
      int res = DobbyHook((void *)imp, (void *)my_setActivationPolicy,
                          (void **)&orig_setActivationPolicy);
      printf("[Soggfy-INFO] Hooked setActivationPolicy: result=%d\n", res);
    }

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
    Method m4 = class_getInstanceMethod(
        winCls, sel_registerName("orderWindow:relativeTo:"));
    if (m4) {
      IMP imp = method_getImplementation(m4);
      int res = DobbyHook((void *)imp, (void *)my_orderWindow,
                          (void **)&orig_orderWindow);
      printf("[Soggfy-INFO] Hooked orderWindow:relativeTo: result=%d\n", res);
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

  printf("[Soggfy-INFO] Immediate hooks setup complete.\n");
}

static std::atomic<bool> g_audio_hooks_installed{false};

void SetupAudioHooks() {
  if (g_audio_hooks_installed.exchange(true)) return;
  const CaptureBackend backend = SelectedCaptureBackend();
  printf("[Soggfy-INFO] Configuring capture backend: %s\n",
         CaptureBackendName(backend));

  if (backend == CaptureBackend::Disabled) {
    printf("[Soggfy-INFO] Capture is disabled; no audio hooks installed.\n");
    return;
  }
  if (backend != CaptureBackend::Ogg) {
    printf("[Soggfy-ERROR] Unsupported SOGGFY_CAPTURE_BACKEND; capture disabled.\n");
    return;
  }

  InstallDecoderHook();

  if (EnvFlagEnabled("SOGGFY_MUTE_OUTPUT", false)) {
    void *target = dlsym(RTLD_DEFAULT, "AudioUnitSetProperty");
    const int result = target
        ? DobbyHook(target, (void *)my_AudioUnitSetProperty,
                    (void **)&orig_AudioUnitSetProperty)
        : -1;
    if (result == 0 && orig_AudioUnitSetProperty) {
      printf("[Soggfy-INFO] Output muting hook installed.\n");
    } else {
      orig_AudioUnitSetProperty = nullptr;
      printf("[Soggfy-WARN] Output muting hook unavailable (result=%d).\n", result);
    }
  }
}

// ── Entry Point ──

struct SharedCaptureGateState {
  bool gated = true;
  uint64_t epoch = 0;
};

static SharedCaptureGateState ReadSharedCaptureGate(const std::string &save_dir) {
  SharedCaptureGateState state;
  std::ifstream in(save_dir + "/capture_gate.txt");
  char value = '1';
  if (in) {
    in >> value;
    uint64_t epoch = 0;
    if (in >> epoch) state.epoch = epoch;
  }
  state.gated = value != '0';
  return state;
}

static std::mutex g_shared_capture_sync_mutex;
static std::string g_last_shared_track_token;
static OggGateEpochTracker g_shared_gate_tracker;

void SyncSharedCaptureStateNow() {
  std::lock_guard<std::mutex> sync_lock(g_shared_capture_sync_mutex);
  const std::string save_dir = SharedSaveDir();
  const std::string track_file_path = save_dir + "/active_track.txt";

  std::ifstream track_file(track_file_path);
  std::string token;
  if (track_file) std::getline(track_file, token);
  TrimInPlace(token);
  if (!token.empty() && token != g_last_shared_track_token) {
    std::istringstream parsed(token);
    std::string track;
    parsed >> track;
    if (!track.empty()) {
      std::string previous;
      {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        previous = g_active_track_id;
      }
      if (!previous.empty() && previous != "prototype_track" && previous != track &&
          StateManager::Instance().OwnsWriter(previous)) {
        StateManager::Instance().ApplySharedControls(previous);
        if (StateManager::Instance().GetPlaybackStatus(previous) == "downloading")
          StateManager::Instance().FinishPlayback(previous);
      }
      StateManager::Instance().ResetLocalPlayback(track);
      {
        std::lock_guard<std::mutex> lock(g_track_mutex);
        g_active_track_id = track;
      }
      ResetOggCaptureState(track);
      g_last_shared_track_token = token;
    }
  }

  const SharedCaptureGateState gate_state = ReadSharedCaptureGate(save_dir);
  if (g_shared_gate_tracker.ShouldDiscard(gate_state.gated, gate_state.epoch)) {
    DiscardPendingOggCapture();
  }
  g_capture_gated.store(gate_state.gated);

  std::string active;
  {
    std::lock_guard<std::mutex> lock(g_track_mutex);
    active = g_active_track_id;
  }
  if (!active.empty() && active != "prototype_track")
    StateManager::Instance().ApplySharedControls(active);
}

static void SyncTrackIdThread() {
  while (true) {
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    SyncSharedCaptureStateNow();
  }
}

__attribute__((constructor)) void SoggfyEntryPoint() {
  char path[4096] = {0};
  uint32_t size = sizeof(path);
  SoggfyProcessRole process_role = SoggfyProcessRole::Unrelated;
  if (_NSGetExecutablePath(path, &size) == 0) {
    process_role = ClassifySoggfyProcess(path);
  }

  // DYLD has already loaded this payload into the current process. Clear the
  // insertion variable immediately so no child process inherits it. This is
  // critical for Spotify's system helpers (for example arm64e lsof).
  unsetenv("DYLD_INSERT_LIBRARIES");

  if (process_role == SoggfyProcessRole::Unrelated) {
    return;
  }

  const std::string save_dir = SharedSaveDir();
  mkdir(save_dir.c_str(), 0700);
  chmod(save_dir.c_str(), 0700);
  const std::string log_path = save_dir + "/payload-" + std::to_string(getpid()) + ".log";
  int log_fd = open(log_path.c_str(), O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (log_fd >= 0) {
    dup2(log_fd, STDOUT_FILENO);
    dup2(log_fd, STDERR_FILENO);
    close(log_fd);
  }
  setvbuf(stdout, NULL, _IONBF, 0);
  setvbuf(stderr, NULL, _IONBF, 0);

  const bool is_main_process = process_role == SoggfyProcessRole::MainSpotify;

  SetupImmediateHooks();

  printf("[Soggfy-INFO] Soggfy payload v2.0 active (PID %d, Main=%d)\n",
         getpid(), is_main_process);

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
          if (!trackIdNS) return;
          id playerStateValue = info[@"Player State"];
          NSString *playerStateNS = [playerStateValue isKindOfClass:[NSString class]]
                                        ? (NSString *)playerStateValue
                                        : [playerStateValue description];

          std::string uri = [trackIdNS UTF8String];
          std::string player_state = playerStateNS ? [playerStateNS UTF8String] : "";
          std::string target;
          {
            std::lock_guard<std::mutex> lock(g_track_mutex);
            target = g_active_track_id;
          }

          bool is_ad = (uri.rfind("spotify:ad:", 0) == 0);
          bool matches_target = (!target.empty() &&
                                 uri == "spotify:track:" + target);
          bool is_playing = (player_state == "Playing" || player_state == "playing");

          if (is_ad) {
            PersistCaptureGate(true);
            DiscardPendingOggCapture();
            printf("[Soggfy-AD] Advertisement detected: %s — capture gated\n",
                   uri.c_str());
          } else if (matches_target && is_playing) {
            PersistCaptureGate(false);
            printf("[Soggfy-AD] Target track confirmed playing: %s\n", uri.c_str());
          } else {
            // Non-target, non-ad track (e.g. autoplay next song) — keep gated
            PersistCaptureGate(true);
            DiscardPendingOggCapture();
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