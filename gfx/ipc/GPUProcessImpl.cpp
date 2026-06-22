/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include "GPUProcessImpl.h"
#include "nsXPCOM.h"
#include "mozilla/ipc/ProcessUtils.h"
#include "mozilla/GeckoArgs.h"

#if defined(XP_WIN) && defined(MOZ_SANDBOX)
#  include "nsAppShell.h"
#  include "mozilla/sandboxTarget.h"
#elif defined(__OpenBSD__) && defined(MOZ_SANDBOX)
#  include "mozilla/SandboxSettings.h"
#elif defined(XP_MACOSX) && defined(MOZ_BUNDLED_FONTS)
#  include "gfxPlatformMac.h"
#endif

namespace mozilla {
namespace gfx {

using namespace ipc;

GPUProcessImpl::~GPUProcessImpl() = default;

bool GPUProcessImpl::Init(int aArgc, char* aArgv[]) {
#if defined(MOZ_SANDBOX) && defined(XP_WIN)
  nsAppShell::PrecacheEventWindow();
  mozilla::SandboxTarget::Instance()->StartSandbox();
#elif defined(__OpenBSD__) && defined(MOZ_SANDBOX)
  StartOpenBSDSandbox(GeckoProcessType_GPU);
#endif

  Maybe<const char*> parentBuildID =
      geckoargs::sParentBuildID.Get(aArgc, aArgv);
  if (parentBuildID.isNothing()) {
    return false;
  }

#if defined(XP_MACOSX) && defined(MOZ_BUNDLED_FONTS)
  // On macOS, bundled fonts shipped with the application need to be activated
  // in the GPU process, otherwise they will fail to render (and fall back to
  // garbage glyphs from another font).
  // The bundled fonts directory is a sibling of the appDir, so we use the
  // sAppDir arg as a starting-point to locate it.
  nsCOMPtr<nsIFile> appDirArg;
  Maybe<const char*> appDir = geckoargs::sAppDir.Get(aArgc, aArgv);
  if (appDir.isSome()) {
    bool flag;
    if (NS_FAILED(XRE_GetFileFromPath(*appDir, getter_AddRefs(appDirArg))) ||
        NS_FAILED(appDirArg->Exists(&flag)) || !flag) {
      NS_WARNING("Invalid application directory passed to GPU process.");
      appDirArg = nullptr;
    }
  }
  if (appDirArg) {
    // appDirArg is the <app package>/Contents/Resources/browser directory.
    // Get its parent (/Resources), and then append /fonts.
    nsCOMPtr<nsIFile> fontsDir;
    bool flag;
    if (NS_SUCCEEDED(appDirArg->GetParent(getter_AddRefs(fontsDir))) &&
        NS_SUCCEEDED(fontsDir->AppendRelativeNativePath("fonts"_ns)) &&
        NS_SUCCEEDED(fontsDir->Exists(&flag)) && flag) {
      gfxPlatformMac::ActivateFontsFromDir(fontsDir->NativePath());
    }
  }
#endif

  if (!ProcessChild::InitPrefs(aArgc, aArgv)) {
    return false;
  }

  return mGPU->Init(TakeInitialEndpoint(), *parentBuildID);
}

void GPUProcessImpl::CleanUp() { NS_ShutdownXPCOM(nullptr); }

}  // namespace gfx
}  // namespace mozilla
