/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/chrome/RegistryMessageUtils.h"
#include "mozilla/dom/ContentParent.h"
#include "mozilla/ClearOnShutdown.h"

#include "nsResProtocolHandler.h"
#include "nsNetCID.h"
#include "nsNetUtil.h"
#include "nsURLHelper.h"
#include "nsEscape.h"

#include "mozilla/Omnijar.h"

#ifdef MOZ_WIDGET_ANDROID
#  include "mozilla/java/GeckoAppShellWrappers.h"
#endif

using mozilla::LogLevel;
using mozilla::dom::ContentParent;

#define kAPP "app"
#define kGRE "gre"
#define kAndroid "android"

mozilla::StaticRefPtr<nsResProtocolHandler> nsResProtocolHandler::sSingleton;

already_AddRefed<nsResProtocolHandler> nsResProtocolHandler::GetSingleton() {
  MOZ_ASSERT(NS_IsMainThread() || sSingleton);
  if (!sSingleton) {
    RefPtr<nsResProtocolHandler> handler = new nsResProtocolHandler();
    if (NS_WARN_IF(NS_FAILED(handler->Init()))) {
      return nullptr;
    }
    sSingleton = handler;
    ClearOnShutdown(&sSingleton);
  }
  return do_AddRef(sSingleton);
}

nsresult nsResProtocolHandler::Init() {
  nsresult rv;
  rv = mozilla::Omnijar::GetURIString(mozilla::Omnijar::APP, mAppURI);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = mozilla::Omnijar::GetURIString(mozilla::Omnijar::GRE, mGREURI);
  NS_ENSURE_SUCCESS(rv, rv);

  // mozilla::Omnijar::GetURIString always returns a string ending with /,
  // and we want to remove it.
  mGREURI.Truncate(mGREURI.Length() - 1);
  if (mAppURI.Length()) {
    mAppURI.Truncate(mAppURI.Length() - 1);
  } else {
    mAppURI = mGREURI;
  }

#ifdef ANDROID
  rv = GetApkURI(mApkURI);
#endif

  // XXXbsmedberg Neil wants a resource://pchrome/ for the profile chrome dir...
  // but once I finish multiple chrome registration I'm not sure that it is
  // needed

  // XXX dveditz: resource://pchrome/ defeats profile directory salting
  // if web content can load it. Tread carefully.

  return rv;
}

#ifdef ANDROID
nsresult nsResProtocolHandler::GetApkURI(nsACString& aResult) {
  mozilla::jni::String::LocalRef path =
      mozilla::java::GeckoAppShell::GetPackageResourcePath();
  if (!path) {
    return NS_ERROR_UNEXPECTED;
  }
  aResult = "jar:file://"_ns + path->ToCString() + "!"_ns;
  return NS_OK;
}
#endif

//----------------------------------------------------------------------------
// nsResProtocolHandler::nsISupports
//----------------------------------------------------------------------------

NS_IMPL_QUERY_INTERFACE(nsResProtocolHandler, nsIResProtocolHandler,
                        nsISubstitutingProtocolHandler, nsIProtocolHandler,
                        nsISupportsWeakReference)
NS_IMPL_ADDREF_INHERITED(nsResProtocolHandler, SubstitutingProtocolHandler)
NS_IMPL_RELEASE_INHERITED(nsResProtocolHandler, SubstitutingProtocolHandler)

NS_IMETHODIMP
nsResProtocolHandler::AllowContentToAccess(nsIURI* aURI, bool* aResult) {
  *aResult = false;

  nsAutoCString host;
  nsresult rv = aURI->GetAsciiHost(host);
  NS_ENSURE_SUCCESS(rv, rv);

  uint32_t flags;
  rv = GetSubstitutionFlags(host, &flags);
  NS_ENSURE_SUCCESS(rv, rv);

  *aResult = flags & nsISubstitutingProtocolHandler::ALLOW_CONTENT_ACCESS;
  return NS_OK;
}

uint32_t nsResProtocolHandler::GetJARFlags(const nsACString& aRoot) {
  if (aRoot.Equals(kAndroid)) {
    return nsISubstitutingProtocolHandler::RESOLVE_JAR_URI;
  }

  // 0 implies no content access.
  return 0;
}

nsresult nsResProtocolHandler::GetSubstitutionInternal(const nsACString& aRoot,
                                                       nsIURI** aResult) {
  nsAutoCString uri;

  if (!ResolveSpecialCases(aRoot, "/"_ns, "/"_ns, uri)) {
    return NS_ERROR_NOT_AVAILABLE;
  }

  return NS_NewURI(aResult, uri);
}

bool nsResProtocolHandler::ResolveSpecialCases(const nsACString& aHost,
                                               const nsACString& aPath,
                                               const nsACString& aPathname,
                                               nsACString& aResult) {
  if (aHost.EqualsLiteral("") || aHost.EqualsLiteral(kAPP)) {
    aResult.Assign(mAppURI);
  } else if (aHost.Equals(kGRE)) {
    aResult.Assign(mGREURI);
#ifdef ANDROID
  } else if (aHost.Equals(kAndroid)) {
    aResult.Assign(mApkURI);
#endif
  } else {
    return false;
  }
  aResult.Append(aPath);
  return true;
}

nsresult nsResProtocolHandler::SetSubstitution(const nsACString& aRoot,
                                               nsIURI* aBaseURI) {
  MOZ_ASSERT(!aRoot.EqualsLiteral(""));
  MOZ_ASSERT(!aRoot.EqualsLiteral(kAPP));
  MOZ_ASSERT(!aRoot.EqualsLiteral(kGRE));
  MOZ_ASSERT(!aRoot.EqualsLiteral(kAndroid));
  return SubstitutingProtocolHandler::SetSubstitution(aRoot, aBaseURI);
}

nsresult nsResProtocolHandler::SetSubstitutionWithFlags(const nsACString& aRoot,
                                                        nsIURI* aBaseURI,
                                                        uint32_t aFlags) {
  MOZ_ASSERT(!aRoot.EqualsLiteral(""));
  MOZ_ASSERT(!aRoot.EqualsLiteral(kAPP));
  MOZ_ASSERT(!aRoot.EqualsLiteral(kGRE));
  MOZ_ASSERT(!aRoot.EqualsLiteral(kAndroid));
  return SubstitutingProtocolHandler::SetSubstitutionWithFlags(aRoot, aBaseURI,
                                                               aFlags);
}

nsresult nsResProtocolHandler::HasSubstitution(const nsACString& aRoot,
                                               bool* aResult) {
  if (aRoot.EqualsLiteral(kAPP) || aRoot.EqualsLiteral(kGRE)
#ifdef ANDROID
      || aRoot.EqualsLiteral(kAndroid)
#endif
  ) {
    *aResult = true;
    return NS_OK;
  }

  return mozilla::net::SubstitutingProtocolHandler::HasSubstitution(aRoot,
                                                                    aResult);
}
