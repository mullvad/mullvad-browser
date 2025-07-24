/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// See also: docshell/base/nsAboutRedirector.cpp

#include "AboutRedirector.h"
#include "nsNetUtil.h"
#include "nsIAppStartup.h"
#include "nsIChannel.h"
#include "nsIURI.h"
#include "nsIProtocolHandler.h"
#include "nsServiceManagerUtils.h"
#include "mozilla/Components.h"
#include "mozilla/StaticPrefs_browser.h"
#include "mozilla/dom/ContentChild.h"
#include "mozilla/browser/NimbusFeatures.h"

#define PROFILES_ENABLED_PREF "browser.profiles.enabled"
#define ABOUT_WELCOME_CHROME_URL \
  "chrome://browser/content/aboutwelcome/aboutwelcome.html"
#define ABOUT_HOME_URL "about:home"
#define BASE_BROWSER_HOME_PAGE_URL "about:mullvad-browser"

namespace mozilla {
namespace browser {

NS_IMPL_ISUPPORTS(AboutRedirector, nsIAboutModule)

struct RedirEntry {
  const char* id;
  const char* url;
  uint32_t flags;
};

static const uint32_t BASE_BROWSER_HOME_PAGE_FLAGS =
    nsIAboutModule::URI_MUST_LOAD_IN_CHILD |
    nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
    nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::IS_SECURE_CHROME_UI;

/*
  Entries which do not have URI_SAFE_FOR_UNTRUSTED_CONTENT will run with chrome
  privileges. This is potentially dangerous. Please use
  URI_SAFE_FOR_UNTRUSTED_CONTENT in the third argument to each map item below
  unless your about: page really needs chrome privileges. Security review is
  required before adding new map entries without
  URI_SAFE_FOR_UNTRUSTED_CONTENT.

  NOTE: changes to this redir map need to be accompanied with changes to
    browser/components/about/components.conf
*/
static const RedirEntry kRedirMap[] = {
    {"asrouter", "chrome://browser/content/asrouter/asrouter-admin.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"blocked", "chrome://browser/content/blockedSite.xhtml",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_CAN_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"certerror", "chrome://global/content/aboutNetError.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_CAN_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"unloads", "chrome://browser/content/tabunloader/aboutUnloads.html",
     nsIAboutModule::ALLOW_SCRIPT},
    {"framecrashed", "chrome://browser/content/aboutFrameCrashed.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_CAN_LOAD_IN_CHILD |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"logins", "chrome://browser/content/aboutlogins/aboutLogins.html",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::URI_MUST_LOAD_IN_CHILD |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
         nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::IS_SECURE_CHROME_UI},
    {"loginsimportreport",
     "chrome://browser/content/aboutlogins/aboutLoginsImportReport.html",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::URI_MUST_LOAD_IN_CHILD |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
         nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::IS_SECURE_CHROME_UI},
    {"policies", "chrome://browser/content/policies/aboutPolicies.html",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::IS_SECURE_CHROME_UI},
    {"privatebrowsing", "about:blank", BASE_BROWSER_HOME_PAGE_FLAGS},
    {"profiling",
     "chrome://devtools/content/performance-new/aboutprofiling/index.html",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::IS_SECURE_CHROME_UI},
    {"rights", "chrome://global/content/aboutRights.xhtml",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD},
#ifndef BASE_BROWSER_VERSION
    {"robots", "chrome://browser/content/aboutRobots.xhtml",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::ALLOW_SCRIPT},
#endif
    {"sessionrestore", "chrome://browser/content/aboutSessionRestore.xhtml",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::HIDE_FROM_ABOUTABOUT |
         nsIAboutModule::IS_SECURE_CHROME_UI},
    {"tabcrashed", "chrome://browser/content/aboutTabCrashed.xhtml",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"welcomeback", "chrome://browser/content/aboutWelcomeBack.xhtml",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::HIDE_FROM_ABOUTABOUT |
         nsIAboutModule::IS_SECURE_CHROME_UI},
    {"welcome", "about:blank", BASE_BROWSER_HOME_PAGE_FLAGS},
    {"home", "about:blank", BASE_BROWSER_HOME_PAGE_FLAGS},
    {"newtab", "chrome://browser/content/blanktab.html",
     BASE_BROWSER_HOME_PAGE_FLAGS},
    {"messagepreview",
     "chrome://browser/content/messagepreview/messagepreview.html",
     nsIAboutModule::URI_MUST_LOAD_IN_CHILD |
         nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::HIDE_FROM_ABOUTABOUT},
#ifndef BASE_BROWSER_VERSION
    {"pocket-saved", "chrome://pocket/content/panels/saved.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"pocket-signup", "chrome://pocket/content/panels/signup.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"pocket-home", "chrome://pocket/content/panels/home.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"pocket-style-guide", "chrome://pocket/content/panels/style-guide.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
#endif
    {"settings", "chrome://browser/content/preferences/preferences.xhtml",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::IS_SECURE_CHROME_UI |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"preferences", "chrome://browser/content/preferences/preferences.xhtml",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::IS_SECURE_CHROME_UI},
    {"downloads",
     "chrome://browser/content/downloads/contentAreaDownloadsView.xhtml",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::IS_SECURE_CHROME_UI},
    {"reader", "chrome://global/content/reader/aboutReader.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::URI_MUST_LOAD_IN_CHILD |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"restartrequired", "chrome://browser/content/aboutRestartRequired.xhtml",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::HIDE_FROM_ABOUTABOUT},
#ifdef MOZ_SELECTABLE_PROFILES
    {"profilemanager", "chrome://browser/content/profiles/profiles.html",
     nsIAboutModule::ALLOW_SCRIPT | nsIAboutModule::IS_SECURE_CHROME_UI |
         nsIAboutModule::HIDE_FROM_ABOUTABOUT},
    {"editprofile", "chrome://browser/content/profiles/edit-profile.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::IS_SECURE_CHROME_UI | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS},
    {"deleteprofile", "chrome://browser/content/profiles/delete-profile.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::IS_SECURE_CHROME_UI |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS},
    {"newprofile", "chrome://browser/content/profiles/new-profile.html",
     nsIAboutModule::URI_SAFE_FOR_UNTRUSTED_CONTENT |
         nsIAboutModule::IS_SECURE_CHROME_UI | nsIAboutModule::ALLOW_SCRIPT |
         nsIAboutModule::URI_MUST_LOAD_IN_CHILD |
         nsIAboutModule::URI_CAN_LOAD_IN_PRIVILEGEDABOUT_PROCESS},
#endif
    {"mullvad-browser",
     "chrome://browser/content/mullvad-browser/aboutMullvadBrowser.html",
     BASE_BROWSER_HOME_PAGE_FLAGS},
};

static nsAutoCString GetAboutModuleName(nsIURI* aURI) {
  nsAutoCString path;
  aURI->GetPathQueryRef(path);

  int32_t f = path.FindChar('#');
  if (f >= 0) path.SetLength(f);

  f = path.FindChar('?');
  if (f >= 0) path.SetLength(f);

  ToLowerCase(path);
  return path;
}

NS_IMETHODIMP
AboutRedirector::NewChannel(nsIURI* aURI, nsILoadInfo* aLoadInfo,
                            nsIChannel** result) {
  NS_ENSURE_ARG_POINTER(aURI);
  NS_ENSURE_ARG_POINTER(aLoadInfo);

  NS_ASSERTION(result, "must not be null");

  nsAutoCString path = GetAboutModuleName(aURI);

  if ((path.EqualsASCII("editprofile") || path.EqualsASCII("deleteprofile") ||
       path.EqualsASCII("newprofile")) &&
      !mozilla::Preferences::GetBool(PROFILES_ENABLED_PREF, false)) {
    return NS_ERROR_NOT_AVAILABLE;
  }

  if (path.EqualsASCII("profilemanager") &&
      !mozilla::Preferences::GetBool(PROFILES_ENABLED_PREF, false)) {
    bool startingUp;
    nsCOMPtr<nsIAppStartup> appStartup(
        mozilla::components::AppStartup::Service());
    if (NS_FAILED(appStartup->GetStartingUp(&startingUp)) || !startingUp) {
      return NS_ERROR_NOT_AVAILABLE;
    }
  }

  for (auto& redir : kRedirMap) {
    if (!strcmp(path.get(), redir.id)) {
      nsAutoCString url;

      if (path.EqualsLiteral("welcome") || path.EqualsLiteral("home") ||
          path.EqualsLiteral("privatebrowsing") ||
          (path.EqualsLiteral("newtab") &&
           StaticPrefs::browser_newtabpage_enabled())) {
        url.AssignASCII(BASE_BROWSER_HOME_PAGE_URL);
      }

      // fall back to the specified url in the map
      if (url.IsEmpty()) {
        url.AssignASCII(redir.url);
      }

      nsCOMPtr<nsIChannel> tempChannel;
      nsCOMPtr<nsIURI> tempURI;
      nsresult rv = NS_NewURI(getter_AddRefs(tempURI), url);
      NS_ENSURE_SUCCESS(rv, rv);

      // If tempURI links to an external URI (i.e. something other than
      // chrome:// or resource://) then set the result principal URI on the
      // load info which forces the channel prncipal to reflect the displayed
      // URL rather then being the systemPrincipal.
      bool isUIResource = false;
      rv = NS_URIChainHasFlags(tempURI, nsIProtocolHandler::URI_IS_UI_RESOURCE,
                               &isUIResource);
      NS_ENSURE_SUCCESS(rv, rv);

      rv = NS_NewChannelInternal(getter_AddRefs(tempChannel), tempURI,
                                 aLoadInfo);
      NS_ENSURE_SUCCESS(rv, rv);

      if (!isUIResource) {
        aLoadInfo->SetResultPrincipalURI(tempURI);
      }
      tempChannel->SetOriginalURI(aURI);

      NS_ADDREF(*result = tempChannel);
      return rv;
    }
  }

  return NS_ERROR_ILLEGAL_VALUE;
}

NS_IMETHODIMP
AboutRedirector::GetURIFlags(nsIURI* aURI, uint32_t* result) {
  NS_ENSURE_ARG_POINTER(aURI);

  nsAutoCString name = GetAboutModuleName(aURI);

  for (auto& redir : kRedirMap) {
    if (name.Equals(redir.id)) {
      *result = redir.flags;
      return NS_OK;
    }
  }

  return NS_ERROR_ILLEGAL_VALUE;
}

NS_IMETHODIMP
AboutRedirector::GetChromeURI(nsIURI* aURI, nsIURI** chromeURI) {
  NS_ENSURE_ARG_POINTER(aURI);

  nsAutoCString name = GetAboutModuleName(aURI);

  for (const auto& redir : kRedirMap) {
    if (name.Equals(redir.id)) {
      return NS_NewURI(chromeURI, redir.url);
    }
  }

  return NS_ERROR_ILLEGAL_VALUE;
}

nsresult AboutRedirector::Create(REFNSIID aIID, void** result) {
  AboutRedirector* about = new AboutRedirector();
  if (about == nullptr) return NS_ERROR_OUT_OF_MEMORY;
  NS_ADDREF(about);
  nsresult rv = about->QueryInterface(aIID, result);
  NS_RELEASE(about);
  return rv;
}

}  // namespace browser
}  // namespace mozilla
