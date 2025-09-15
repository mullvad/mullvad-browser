/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SandboxLaunch.h"

#include <fcntl.h>
#include <sched.h>
#include <setjmp.h>
#include <signal.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <utility>

#include "LinuxCapabilities.h"
#include "LinuxSched.h"
#include "SandboxChrootProto.h"
#include "SandboxInfo.h"
#include "SandboxLogging.h"
#include "base/eintr_wrapper.h"
#include "base/strings/safe_sprintf.h"
#include "mozilla/Array.h"
#include "mozilla/ArrayUtils.h"
#include "mozilla/Assertions.h"
#include "mozilla/Attributes.h"
#include "mozilla/Preferences.h"
#include "mozilla/SandboxReporter.h"
#include "mozilla/SandboxSettings.h"
#include "mozilla/Components.h"
#include "mozilla/StaticPrefs_media.h"
#include "mozilla/StaticPrefs_security.h"
#include "mozilla/Unused.h"
#include "mozilla/ipc/UtilityProcessSandboxing.h"
#include "nsCOMPtr.h"
#include "nsDebug.h"
#include "nsIGfxInfo.h"
#include "nsString.h"
#include "nsThreadUtils.h"
#include "prenv.h"
#include "sandbox/linux/system_headers/linux_syscalls.h"

#ifdef MOZ_X11
#  ifndef MOZ_WIDGET_GTK
#    error "Unknown toolkit"
#  endif
#  include "mozilla/WidgetUtilsGtk.h"
#  include <gdk/gdk.h>
#  include <gdk/gdkx.h>
#  include "X11UndefineNone.h"
#  include "gfxPlatform.h"
#endif

namespace mozilla {

// Returns true if graphics will work from a content process
// started in a new network namespace.  Specifically, named
// Unix-domain sockets will work, but TCP/IP will not, even if it's a
// connection to localhost: the child process has its own private
// loopback interface.
//
// (Longer-term we intend to either proxy or remove X11 access from
// content processes, at which point this will stop being an issue.)
static bool IsGraphicsOkWithoutNetwork() {
  // For X11, check whether the parent's connection is a Unix-domain
  // socket.  This is done instead of trying to parse the display name
  // because an empty hostname (e.g., ":0") will fall back to TCP in
  // case of failure to connect using Unix-domain sockets.
#ifdef MOZ_X11
  // First, ensure that the parent process's graphics are initialized.
  DebugOnly<gfxPlatform*> gfxPlatform = gfxPlatform::GetPlatform();

  const auto display = gdk_display_get_default();
  if (!display) {
    // In this case, the browser is headless, but WebGL could still
    // try to use X11.  However, WebGL isn't supported with remote
    // X11, and in any case these connections are made after sandbox
    // startup (lazily when WebGL is used), so they aren't being done
    // directly by the process anyway.  (For local X11, they're
    // brokered.)
    MOZ_ASSERT(gfxPlatform->IsHeadless());
    return true;
  }
  if (mozilla::widget::GdkIsX11Display(display)) {
    const int xSocketFd = ConnectionNumber(GDK_DISPLAY_XDISPLAY(display));
    if (NS_WARN_IF(xSocketFd < 0)) {
      return false;
    }

    int domain;
    socklen_t optlen = static_cast<socklen_t>(sizeof(domain));
    int rv = getsockopt(xSocketFd, SOL_SOCKET, SO_DOMAIN, &domain, &optlen);
    if (NS_WARN_IF(rv != 0)) {
      return false;
    }
    MOZ_RELEASE_ASSERT(static_cast<size_t>(optlen) == sizeof(domain));
    if (domain != AF_LOCAL) {
      return false;
    }
    // There's one more complication: Xorg listens on named sockets
    // (actual filesystem nodes) as well as abstract addresses (opaque
    // octet strings scoped to the network namespace; this is a Linux
    // extension).
    //
    // Inside a container environment (e.g., when running as a Snap
    // package), it's possible that only the abstract addresses are
    // accessible.  In that case, the display must be considered
    // remote.  See also bug 1450740.
    //
    // Unfortunately, the Xorg client libraries prefer the abstract
    // addresses, so this isn't directly detectable by inspecting the
    // parent process's socket.  Instead, parse the DISPLAY env var
    // (which was updated if necessary in nsAppRunner.cpp) to get the
    // display number and construct the socket path, falling back to
    // testing the directory in case that doesn't work.  (See bug
    // 1565972 and bug 1559368 for cases where we need to test the
    // specific socket.)
    const char* const displayStr = PR_GetEnv("DISPLAY");
    nsAutoCString socketPath("/tmp/.X11-unix");
    int accessFlags = X_OK;
    int displayNum;
    // sscanf ignores trailing text, so display names with a screen
    // number (e.g., ":0.2") will parse correctly.
    if (displayStr && (sscanf(displayStr, ":%d", &displayNum) == 1 ||
                       sscanf(displayStr, "unix:%d", &displayNum) == 1)) {
      socketPath.AppendPrintf("/X%d", displayNum);
      accessFlags = R_OK | W_OK;
    }
    if (access(socketPath.get(), accessFlags) != 0) {
      SANDBOX_LOG_ERRNO(
          "%s is inaccessible; can't isolate network namespace in"
          " content processes",
          socketPath.get());
      return false;
    }
  }
#endif

  // Assume that other backends (e.g., Wayland) will not use the
  // network namespace.
  return true;
}

bool HasAtiDrivers() {
  nsCOMPtr<nsIGfxInfo> gfxInfo = components::GfxInfo::Service();
  nsAutoString vendorID;
  static const Array<nsresult (nsIGfxInfo::*)(nsAString&), 2> kMethods = {
      &nsIGfxInfo::GetAdapterVendorID,
      &nsIGfxInfo::GetAdapterVendorID2,
  };
  for (const auto method : kMethods) {
    if (NS_SUCCEEDED((gfxInfo->*method)(vendorID))) {
      // This test is based on telemetry data.  The proprietary ATI
      // drivers seem to use this vendor string, including for some
      // newer devices that have AMD branding in the device name, such
      // as those using AMDGPU-PRO drivers.
      // The open-source drivers integrated into Mesa appear to use
      // the vendor ID "X.Org" instead.
      if (vendorID.EqualsLiteral("ATI Technologies Inc.")) {
        return true;
      }
    }
  }

  return false;
}

// Content processes may need direct access to SysV IPC in certain
// uncommon use cases.
static bool ContentNeedsSysVIPC() {
  // The ALSA dmix plugin uses SysV semaphores and shared memory to
  // coordinate software mixing.
#ifdef MOZ_ALSA
  if (!StaticPrefs::media_cubeb_sandbox()) {
    return true;
  }
#endif

  if (!StaticPrefs::security_sandbox_content_headless_AtStartup()) {
    // Bug 1438391: VirtualGL uses SysV shm for images and configuration.
    if (PR_GetEnv("VGL_ISACTIVE") != nullptr) {
      return true;
    }

    // The fglrx (ATI Catalyst) GPU drivers use SysV IPC.
    if (HasAtiDrivers()) {
      return true;
    }
  }

  return false;
}

static void PreloadSandboxLib(base::environment_map* aEnv) {
  // Preload libmozsandbox.so so that sandbox-related interpositions
  // can be defined there instead of in the executable.
  // (This could be made conditional on intent to use sandboxing, but
  // it's harmless for non-sandboxed processes.)
  nsAutoCString preload;
  // Prepend this, because people can and do preload libpthread.
  // (See bug 1222500.)
  preload.AssignLiteral("libmozsandbox.so");
  if (const char* oldPreload = PR_GetEnv("LD_PRELOAD")) {
    // Doesn't matter if oldPreload is ""; extra separators are ignored.
    preload.Append(' ');
    preload.Append(oldPreload);
    (*aEnv)["MOZ_ORIG_LD_PRELOAD"] = oldPreload;
  }
  MOZ_ASSERT(aEnv->count("LD_PRELOAD") == 0);
  (*aEnv)["LD_PRELOAD"] = preload.get();
}

static void AttachSandboxReporter(base::file_handle_mapping_vector* aFdMap) {
  int srcFd, dstFd;
  SandboxReporter::Singleton()->GetClientFileDescriptorMapping(&srcFd, &dstFd);
  aFdMap->push_back({srcFd, dstFd});
}

static int GetEffectiveSandboxLevel(GeckoProcessType aType,
                                    ipc::SandboxingKind aKind) {
  auto info = SandboxInfo::Get();
  switch (aType) {
#ifdef MOZ_ENABLE_FORKSERVER
      // With this env MOZ_SANDBOXED will be set, and mozsandbox will
      // be preloaded for the fork server.  Sandboxed child processes
      // rely on wrappers defined by mozsandbox to work properly.
    case GeckoProcessType_ForkServer:
      return 1;
      break;
#endif
    case GeckoProcessType_Content:
      // GetEffectiveContentSandboxLevel is main-thread-only due to prefs.
      MOZ_ASSERT(NS_IsMainThread());
      if (info.Test(SandboxInfo::kEnabledForContent)) {
        return GetEffectiveContentSandboxLevel();
      }
      return 0;
    case GeckoProcessType_GMPlugin:
      if (info.Test(SandboxInfo::kEnabledForMedia)) {
        return 1;
      }
      return 0;
    case GeckoProcessType_RDD:
      return PR_GetEnv("MOZ_DISABLE_RDD_SANDBOX") == nullptr ? 1 : 0;
    case GeckoProcessType_Socket:
      // GetEffectiveSocketProcessSandboxLevel is main-thread-only due to prefs.
      MOZ_ASSERT(NS_IsMainThread());
      return GetEffectiveSocketProcessSandboxLevel();
    case GeckoProcessType_Utility:
      return IsUtilitySandboxEnabled(aKind);
    default:
      return 0;
  }
}

// static
void SandboxLaunch::Configure(GeckoProcessType aType, SandboxingKind aKind,
                              LaunchOptions* aOptions) {
  MOZ_ASSERT(aOptions->fork_flags == 0 && !aOptions->sandbox_chroot);
  auto info = SandboxInfo::Get();

  // We won't try any kind of sandboxing without seccomp-bpf.
  if (!info.Test(SandboxInfo::kHasSeccompBPF)) {
    return;
  }

  // Check prefs (and env vars) controlling sandbox use.
  int level = GetEffectiveSandboxLevel(aType, aKind);
  if (level == 0) {
    return;
  }

  // At this point, we know we'll be using sandboxing; generic
  // sandboxing support goes here.  The MOZ_SANDBOXED env var tells
  // the child process whether this is the case.
  aOptions->env_map["MOZ_SANDBOXED"] = "1";
  PreloadSandboxLib(&aOptions->env_map);
  AttachSandboxReporter(&aOptions->fds_to_remap);

  bool canChroot = false;
  int flags = 0;

  if (aType == GeckoProcessType_Content && level >= 1) {
    static const bool needSysV = ContentNeedsSysVIPC();
    if (needSysV) {
      // Tell the child process so it can adjust its seccomp-bpf
      // policy.
      aOptions->env_map["MOZ_SANDBOX_ALLOW_SYSV"] = "1";
    } else {
      flags |= CLONE_NEWIPC;
    }

    if (StaticPrefs::security_sandbox_content_headless_AtStartup()) {
      aOptions->env_map["MOZ_HEADLESS"] = "1";
    }
  }

  // Anything below this requires unprivileged user namespaces.
  if (!info.Test(SandboxInfo::kHasUserNamespaces)) {
    return;
  }

  // Warning: don't combine multiple case labels, even if the code is
  // currently the same, to avoid mistakes when changes are made.
  switch (aType) {
    case GeckoProcessType_Socket:
      if (level >= 1) {
        canChroot = true;
        flags |= CLONE_NEWIPC;
      }
      break;
    case GeckoProcessType_GMPlugin:
      if (level >= 1) {
        canChroot = true;
        flags |= CLONE_NEWIPC;
        flags |= CLONE_NEWNET;
      }
      break;
    case GeckoProcessType_RDD:
      if (level >= 1) {
        canChroot = true;
        // Can't use CLONE_NEWIPC because of intel-media-driver.
        flags |= CLONE_NEWNET;
      }
      break;
    case GeckoProcessType_Utility:
      if (level >= 1) {
        canChroot = true;
        flags |= CLONE_NEWIPC;
        flags |= CLONE_NEWNET;
      }
      break;
    case GeckoProcessType_Content:
      if (level >= 4) {
        canChroot = true;

        // Unshare network namespace if allowed by graphics; see
        // function definition above for details.  (The display
        // local-ness is cached because it won't change.)
        static const bool canCloneNet =
            StaticPrefs::security_sandbox_content_headless_AtStartup() ||
            (IsGraphicsOkWithoutNetwork() &&
             !PR_GetEnv("RENDERDOC_CAPTUREOPTS"));

        if (canCloneNet) {
          flags |= CLONE_NEWNET;
        }
      }
      // Hidden pref to allow testing user namespaces separately, even
      // if there's nothing that would require them.
      if (Preferences::GetBool("security.sandbox.content.force-namespace",
                               false)) {
        flags |= CLONE_NEWUSER;
      }
      break;
    default:
      // Nothing yet.
      break;
  }

  if (canChroot || flags != 0) {
    flags |= CLONE_NEWUSER;
  }

  aOptions->env_map[kSandboxChrootEnvFlag] = std::to_string(canChroot ? 1 : 0);

  aOptions->sandbox_chroot = canChroot;
  aOptions->fork_flags = flags;
}

SandboxLaunch::SandboxLaunch()
    : mFlags(0), mChrootServer(-1), mChrootClient(-1) {}

SandboxLaunch::~SandboxLaunch() {
  if (mChrootClient >= 0) {
    close(mChrootClient);
  }
  if (mChrootServer >= 0) {
    close(mChrootServer);
  }
}

bool SandboxLaunch::Prepare(LaunchOptions* aOptions) {
  MOZ_ASSERT(mChrootClient < 0 && mChrootServer < 0);

  mFlags = aOptions->fork_flags;

  // Create the socket for communication between the child process and
  // the chroot helper process.  The client end is passed to the child
  // via `fds_to_remap` and the server end is inherited and used in
  // `StartChrootServer`.
  if (aOptions->sandbox_chroot) {
    int fds[2];
    int rv = socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, fds);
    if (rv != 0) {
      SANDBOX_LOG_ERRNO("socketpair");
      return false;
    }
    mChrootClient = fds[0];
    mChrootServer = fds[1];

    aOptions->fds_to_remap.push_back({mChrootClient, kSandboxChrootClientFd});
  }

  return true;
}

static void BlockAllSignals(sigset_t* aOldSigs) {
  sigset_t allSigs;
  int rv = sigfillset(&allSigs);
  MOZ_RELEASE_ASSERT(rv == 0);
  rv = pthread_sigmask(SIG_BLOCK, &allSigs, aOldSigs);
  if (rv != 0) {
    SANDBOX_LOG_WITH_ERROR(rv, "pthread_sigmask (block all)");
    MOZ_CRASH("pthread_sigmask");
  }
}

static void RestoreSignals(const sigset_t* aOldSigs) {
  // Assuming that pthread_sigmask is a thin layer over rt_sigprocmask
  // and doesn't try to touch TLS, which may be in an "interesting"
  // state right now:
  int rv = pthread_sigmask(SIG_SETMASK, aOldSigs, nullptr);
  if (rv != 0) {
    SANDBOX_LOG_WITH_ERROR(rv, "pthread_sigmask (restore)");
    MOZ_CRASH("pthread_sigmask");
  }
}

static bool IsSignalIgnored(int aSig) {
  struct sigaction sa {};

  if (sigaction(aSig, nullptr, &sa) != 0) {
    if (errno != EINVAL) {
      SANDBOX_LOG_ERRNO("sigaction(%d)", aSig);
    }
    return false;
  }
  return sa.sa_handler == SIG_IGN;
}

static void ResetSignalHandlers() {
  for (int signum = 1; signum <= SIGRTMAX; ++signum) {
    if (IsSignalIgnored(signum)) {
      continue;
    }
    if (signal(signum, SIG_DFL) == SIG_ERR) {
      MOZ_DIAGNOSTIC_ASSERT(errno == EINVAL);
    }
  }
}

namespace {

// The libc clone() routine insists on calling a provided function on
// a new stack, even if the address space isn't shared and it would be
// safe to expose the underlying system call's fork()-like behavior.
// So, we work around this by longjmp()ing back onto the original stack;
// this technique is also used by Chromium.
//
// In theory, the clone syscall could be used directly if we ensure
// that functions like raise() are never used in the child, including
// by inherited signal handlers, but the longjmp approach isn't much
// extra code and avoids a class of potential bugs.
static int CloneCallee(void* aPtr) {
  auto ctxPtr = reinterpret_cast<jmp_buf*>(aPtr);
  longjmp(*ctxPtr, 1);
  MOZ_CRASH("unreachable");
  return 1;
}

// According to the Chromium developers, builds with FORTIFY_SOURCE
// require that longjump move the stack pointer towards the root
// function of the call stack.  Therefore, we must ensure that the
// clone callee stack is leafward of the stack pointer captured in
// setjmp() below by using this no-inline helper function.
//
// ASan apparently also causes problems, by the combination of
// allocating the large stack-allocated buffer outside of the actual
// stack and then assuming that longjmp is used only to unwind a
// stack, not switch stacks.
//
// Valgrind would disapprove of using clone() without CLONE_VM;
// Chromium uses the raw syscall as a workaround in that case, but
// we don't currently support sandboxing under valgrind.
MOZ_NEVER_INLINE MOZ_ASAN_IGNORE static pid_t DoClone(int aFlags,
                                                      jmp_buf* aCtx) {
  static constexpr size_t kStackAlignment = 16;
  uint8_t miniStack[4096] __attribute__((aligned(kStackAlignment)));
#ifdef __hppa__
  void* stackPtr = miniStack;
#else
  void* stackPtr = ArrayEnd(miniStack);
#endif
  return clone(CloneCallee, stackPtr, aFlags, aCtx);
}

}  // namespace

// Similar to fork(), but allows passing flags to clone() and does not
// run pthread_atfork hooks.
static pid_t ForkWithFlags(int aFlags) {
  // Don't allow flags that would share the address space, or
  // require clone() arguments we're not passing:
  static const int kBadFlags = CLONE_VM | CLONE_VFORK | CLONE_SETTLS |
                               CLONE_PARENT_SETTID | CLONE_CHILD_SETTID |
                               CLONE_CHILD_CLEARTID;
  MOZ_RELEASE_ASSERT((aFlags & kBadFlags) == 0);

  // Block signals due to small stack in DoClone.
  sigset_t oldSigs;
  BlockAllSignals(&oldSigs);

  int ret = 0;
  jmp_buf ctx;
  if (setjmp(ctx) == 0) {
    // In the parent and just called setjmp:
    ret = DoClone(aFlags | SIGCHLD, &ctx);
  }
  RestoreSignals(&oldSigs);
  // In the child and have longjmp'ed:
  return ret;
}

// Returns true for success, or returns false and sets errno on
// failure.  Intended only for procfs pseudo-files.
static bool WriteStringToFile(const char* aPath, const char* aStr,
                              const size_t aLen) {
  int fd = open(aPath, O_WRONLY);
  if (fd < 0) {
    return false;
  }
  ssize_t written = write(fd, aStr, aLen);
  if (close(fd) != 0 || written != ssize_t(aLen)) {
    // procfs shouldn't ever cause a short write, but ensure that
    // errno is set to something distinctive if it does
    if (written >= 0) {
      errno = EMSGSIZE;
    }
    return false;
  }
  return true;
}

// This function sets up uid/gid mappings that preserve the
// process's previous ids.  Mapping the uid/gid to something is
// necessary in order to nest user namespaces (not currently being
// used, but could be useful), and leaving the ids unchanged is
// likely to minimize unexpected side-effects.
static void ConfigureUserNamespace(uid_t uid, gid_t gid) {
  using base::strings::SafeSPrintf;
  char buf[sizeof("18446744073709551615 18446744073709551615 1")];
  size_t len;

  len = static_cast<size_t>(SafeSPrintf(buf, "%d %d 1", uid, uid));
  MOZ_RELEASE_ASSERT(len < sizeof(buf));
  if (!WriteStringToFile("/proc/self/uid_map", buf, len)) {
    SANDBOX_LOG_ERRNO("writing /proc/self/uid_map");
    MOZ_CRASH("Failed to write /proc/self/uid_map");
  }

  // In recent kernels (3.19, 3.18.2, 3.17.8), for security reasons,
  // establishing gid mappings will fail unless the process first
  // revokes its ability to call setgroups() by using a /proc node
  // added in the same set of patches.
  Unused << WriteStringToFile("/proc/self/setgroups", "deny", 4);

  len = static_cast<size_t>(SafeSPrintf(buf, "%d %d 1", gid, gid));
  MOZ_RELEASE_ASSERT(len < sizeof(buf));
  if (!WriteStringToFile("/proc/self/gid_map", buf, len)) {
    SANDBOX_LOG_ERRNO("writing /proc/self/gid_map");
    MOZ_CRASH("Failed to write /proc/self/gid_map");
  }
}

static void DropAllCaps() {
  if (!LinuxCapabilities().SetCurrent()) {
    SANDBOX_LOG_ERRNO("capset (drop all)");
  }
}

pid_t SandboxLaunch::Fork() {
  if (mFlags == 0) {
    MOZ_ASSERT(mChrootServer < 0);
    return fork();
  }

  uid_t uid = getuid();
  gid_t gid = getgid();

  // Block signals so that the handlers can be safely reset in the
  // child process without races, and so that repeated SIGPROF from
  // the profiler won't prevent clone() from making progress.  (The
  // profiler uses pthread_atfork to do that, but ForkWithFlags
  // can't run atfork hooks.)
  sigset_t oldSigs;
  BlockAllSignals(&oldSigs);
  pid_t pid = ForkWithFlags(mFlags);
  if (pid != 0) {
    RestoreSignals(&oldSigs);
    return pid;
  }

  // WARNING: all code from this point on (and in StartChrootServer)
  // must be async signal safe.  In particular, it cannot do anything
  // that could allocate heap memory or use mutexes.
  prctl(PR_SET_NAME, "Sandbox Forked");

  // Clear signal handlers in the child, under the assumption that any
  // actions they would take (running the crash reporter, manipulating
  // the Gecko profile, etc.) wouldn't work correctly in the child.
  ResetSignalHandlers();
  RestoreSignals(&oldSigs);
  ConfigureUserNamespace(uid, gid);

  if (mChrootServer >= 0) {
    StartChrootServer();
    // Don't close the client fd when this object is destroyed.  At
    // this point we're in the child process proper, so it's "owned"
    // by the FileDescriptorShuffle / CloseSuperfluous code (i.e.,
    // that's what will consume it and close it).
    mChrootClient = -1;
  }

  // execve() will drop capabilities, but the fork server case doesn't
  // exec so we need to do this directly.  (Also, it's a good idea to
  // follow the principle of least privilege even when not strictly
  // necessary.)
  //
  // Note that, while capabilities within an unprivileged user
  // namespace are constrained in theory, in practice they expose a
  // lot of attack surface and there have been exploitable kernel bugs
  // related to that in the past, so we really want to drop them
  // before doing anything that needs sandboxing.
  DropAllCaps();
  return 0;
}

void SandboxLaunch::StartChrootServer() {
  // Run the rest of this function in a separate process that can
  // chroot() on behalf of this process after it's sandboxed.
  pid_t pid = ForkWithFlags(CLONE_FS);
  if (pid < 0) {
    MOZ_CRASH("failed to clone chroot helper process");
  }
  if (pid > 0) {
    return;
  }
  prctl(PR_SET_NAME, "Chroot Helper");

  LinuxCapabilities caps;
  caps.Effective(CAP_SYS_CHROOT) = true;
  if (!caps.SetCurrent()) {
    SANDBOX_LOG_ERRNO("capset (chroot helper)");
    MOZ_DIAGNOSTIC_ASSERT(false);
  }

  base::CloseSuperfluousFds(this, [](void* aCtx, int aFd) {
    return aFd == static_cast<decltype(this)>(aCtx)->mChrootServer;
  });

  char msg;
  ssize_t msgLen = HANDLE_EINTR(read(mChrootServer, &msg, 1));
  if (msgLen < 0) {
    SANDBOX_LOG_ERRNO("chroot server couldn't read request");
  }
  if (msgLen == 0) {
    // Process exited before chrooting (or chose not to chroot?).
    _exit(0);
  }
  MOZ_RELEASE_ASSERT(msgLen == 1);
  MOZ_RELEASE_ASSERT(msg == kSandboxChrootRequest);

  // This chroots both processes to this process's procfs fdinfo
  // directory, which becomes empty and unlinked when this process
  // exits at the end of this function, and which is always
  // unwriteable.
  int rv = chroot("/proc/self/fdinfo");
  if (rv != 0) {
    SANDBOX_LOG_ERRNO("chroot");
    MOZ_CRASH("chroot failed");
  }

  // Drop CAP_SYS_CHROOT ASAP.  This must happen before responding;
  // the main child won't be able to waitpid(), so it could start
  // handling hostile content before this process finishes exiting.
  DropAllCaps();

  // The working directory still grant access to the real filesystem;
  // remove that.  (Note: if the process can obtain directory fds, for
  // example via SandboxBroker, it must be blocked from using fchdir.)
  rv = chdir("/");
  if (rv != 0) {
    SANDBOX_LOG_ERRNO("chdir(\"/\")");
    MOZ_CRASH("chdir(\"/\") failed");
  }

  msg = kSandboxChrootResponse;
  msgLen = HANDLE_EINTR(write(mChrootServer, &msg, 1));
  if (msgLen < 0) {
    SANDBOX_LOG_ERRNO("chroot server couldn't send response");
  }
  MOZ_RELEASE_ASSERT(msgLen == 1);
  _exit(0);
}

}  // namespace mozilla
