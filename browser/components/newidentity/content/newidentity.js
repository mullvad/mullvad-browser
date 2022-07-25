"use strict";

/* eslint-env mozilla/browser-window */

// Use a lazy getter because NewIdentityButton is declared more than once
// otherwise.
ChromeUtils.defineLazyGetter(this, "NewIdentityButton", () => {
  // Logger adapted from CustomizableUI.jsm
  const logger = (() => {
    const consoleOptions = {
      maxLogLevelPref: "browser.new_identity.log_level",
      prefix: "NewIdentity",
    };
    return console.createInstance(consoleOptions);
  })();

  const topics = Object.freeze({
    newIdentityRequested: "new-identity-requested",
  });

  /**
   * This class contains the actual implementation of the various step involved
   * when running new identity.
   */
  class NewIdentityImpl {
    async run() {
      this.disableAllJS();
      await this.clearState();
      await this.openNewWindow();
      this.closeOldWindow();
      this.broadcast();
    }

    // Disable JS (as a defense-in-depth measure)

    disableAllJS() {
      logger.info("Disabling JavaScript");
      const enumerator = Services.wm.getEnumerator("navigator:browser");
      while (enumerator.hasMoreElements()) {
        const win = enumerator.getNext();
        this.disableWindowJS(win);
      }
    }

    disableWindowJS(win) {
      const browsers = win.gBrowser?.browsers || [];
      for (const browser of browsers) {
        if (!browser) {
          continue;
        }
        this.disableBrowserJS(browser);
        try {
          browser.webNavigation?.stop(browser.webNavigation.STOP_ALL);
        } catch (e) {
          logger.warn("Could not stop navigation", e, browser.currentURI);
        }
      }
    }

    disableBrowserJS(browser) {
      if (!browser) {
        return;
      }
      // Does the following still apply?
      // Solution from: https://bugzilla.mozilla.org/show_bug.cgi?id=409737
      // XXX: This kills the entire window. We need to redirect
      // focus and inform the user via a lightbox.
      const eventSuppressor = browser.contentWindow?.windowUtils;
      if (browser.browsingContext) {
        browser.browsingContext.allowJavascript = false;
      }
      try {
        // My estimation is that this does not get the inner iframe windows,
        // but that does not matter, because iframes should be destroyed
        // on the next load.
        // Should we log when browser.contentWindow is null?
        if (browser.contentWindow) {
          browser.contentWindow.name = null;
          browser.contentWindow.window.name = null;
        }
      } catch (e) {
        logger.warn("Failed to reset window.name", e);
      }
      eventSuppressor?.suppressEventHandling(true);
    }

    // Clear state

    async clearState() {
      logger.info("Clearing the state");
      this.closeTabs();
      this.clearSearchBar();
      this.clearPrivateSessionHistory();
      this.clearHTTPAuths();
      this.clearCryptoTokens();
      this.clearOCSPCache();
      this.clearSecuritySettings();
      this.clearImageCaches();
      this.clearStorage();
      this.clearPreferencesAndPermissions();
      await this.clearData();
      await this.reloadAddons();
      this.clearConnections();
      this.clearPrivateSession();
    }

    clearSiteSpecificZoom() {
      Services.prefs.setBoolPref(
        "browser.zoom.siteSpecific",
        !Services.prefs.getBoolPref("browser.zoom.siteSpecific")
      );
      Services.prefs.setBoolPref(
        "browser.zoom.siteSpecific",
        !Services.prefs.getBoolPref("browser.zoom.siteSpecific")
      );
    }

    closeTabs() {
      if (
        !Services.prefs.getBoolPref("browser.new_identity.close_newnym", true)
      ) {
        logger.info("Not closing tabs");
        return;
      }
      // TODO: muck around with browser.tabs.warnOnClose.. maybe..
      logger.info("Closing tabs...");
      const enumerator = Services.wm.getEnumerator("navigator:browser");
      const windowsToClose = [];
      while (enumerator.hasMoreElements()) {
        const win = enumerator.getNext();
        const browser = win.gBrowser;
        if (!browser) {
          logger.warn("No browser for possible window to close");
          continue;
        }
        const tabsToRemove = [];
        for (const b of browser.browsers) {
          const tab = browser.getTabForBrowser(b);
          if (tab) {
            tabsToRemove.push(tab);
          } else {
            logger.warn("Browser has a null tab", b);
          }
        }
        if (win == window) {
          browser.addWebTab("about:blank");
        } else {
          // It is a bad idea to alter the window list while iterating
          // over it, so add this window to an array and close it later.
          windowsToClose.push(win);
        }
        // Close each tab except the new blank one that we created.
        tabsToRemove.forEach(aTab => browser.removeTab(aTab));
      }
      // Close all XUL windows except this one.
      logger.info("Closing windows...");
      windowsToClose.forEach(aWin => aWin.close());
      logger.info("Closed all tabs");

      // This clears the undo tab history.
      const tabs = Services.prefs.getIntPref(
        "browser.sessionstore.max_tabs_undo"
      );
      Services.prefs.setIntPref("browser.sessionstore.max_tabs_undo", 0);
      Services.prefs.setIntPref("browser.sessionstore.max_tabs_undo", tabs);
    }

    clearSearchBar() {
      logger.info("Clearing searchbox");
      // Bug #10800: Trying to clear search/find can cause exceptions
      // in unknown cases. Just log for now.
      try {
        const searchBar = window.document.getElementById("searchbar");
        if (searchBar) {
          searchBar.textbox.reset();
        }
      } catch (e) {
        logger.error("Exception on clearing search box", e);
      }
      try {
        if (gFindBarInitialized) {
          const findbox = gFindBar.getElement("findbar-textbox");
          findbox.reset();
          gFindBar.close();
        }
      } catch (e) {
        logger.error("Exception on clearing find bar", e);
      }
    }

    clearPrivateSessionHistory() {
      logger.info("Emitting Private Browsing Session clear event");
      Services.obs.notifyObservers(null, "browser:purge-session-history");
    }

    clearHTTPAuths() {
      if (
        !Services.prefs.getBoolPref(
          "browser.new_identity.clear_http_auth",
          true
        )
      ) {
        logger.info("Skipping HTTP Auths, because disabled");
        return;
      }
      logger.info("Clearing HTTP Auths");
      const auth = Cc["@mozilla.org/network/http-auth-manager;1"].getService(
        Ci.nsIHttpAuthManager
      );
      auth.clearAll();
    }

    clearCryptoTokens() {
      logger.info("Clearing Crypto Tokens");
      // Clear all crypto auth tokens. This includes calls to PK11_LogoutAll(),
      // nsNSSComponent::LogoutAuthenticatedPK11() and clearing the SSL session
      // cache.
      const sdr = Cc["@mozilla.org/security/sdr;1"].getService(
        Ci.nsISecretDecoderRing
      );
      sdr.logoutAndTeardown();
    }

    clearOCSPCache() {
      // nsNSSComponent::Observe() watches security.OCSP.enabled, which calls
      // setValidationOptions(), which in turn calls setNonPkixOcspEnabled() which,
      // if security.OCSP.enabled is set to 0, calls CERT_DisableOCSPChecking(),
      // which calls CERT_ClearOCSPCache().
      // See: https://mxr.mozilla.org/comm-esr24/source/mozilla/security/manager/ssl/src/nsNSSComponent.cpp
      const ocsp = Services.prefs.getIntPref("security.OCSP.enabled");
      Services.prefs.setIntPref("security.OCSP.enabled", 0);
      Services.prefs.setIntPref("security.OCSP.enabled", ocsp);
    }

    clearSecuritySettings() {
      // Clear site security settings
      const sss = Cc["@mozilla.org/ssservice;1"].getService(
        Ci.nsISiteSecurityService
      );
      sss.clearAll();
    }

    clearImageCaches() {
      logger.info("Clearing Image Cache");
      // In Firefox 18 and newer, there are two image caches: one that is used
      // for regular browsing, and one that is used for private browsing.
      this.clearImageCacheRB();
      this.clearImageCachePB();
    }

    clearImageCacheRB() {
      try {
        const imgTools = Cc["@mozilla.org/image/tools;1"].getService(
          Ci.imgITools
        );
        const imgCache = imgTools.getImgCacheForDocument(null);
        // Evict all but chrome cache
        imgCache.clearCache(false);
      } catch (e) {
        // FIXME: This can happen in some rare cases involving XULish image data
        // in combination with our image cache isolation patch. Sure isn't
        // a good thing, but it's not really a super-cookie vector either.
        // We should fix it eventually.
        logger.error("Exception on image cache clearing", e);
      }
    }

    clearImageCachePB() {
      const imgTools = Cc["@mozilla.org/image/tools;1"].getService(
        Ci.imgITools
      );
      try {
        // Try to clear the private browsing cache. To do so, we must locate a
        // content document that is contained within a private browsing window.
        let didClearPBCache = false;
        const enumerator = Services.wm.getEnumerator("navigator:browser");
        while (!didClearPBCache && enumerator.hasMoreElements()) {
          const win = enumerator.getNext();
          let browserDoc = win.document.documentElement;
          if (!browserDoc.hasAttribute("privatebrowsingmode")) {
            continue;
          }
          const tabbrowser = win.gBrowser;
          if (!tabbrowser) {
            continue;
          }
          for (const browser of tabbrowser.browsers) {
            const doc = browser.contentDocument;
            if (doc) {
              const imgCache = imgTools.getImgCacheForDocument(doc);
              // Evict all but chrome cache
              imgCache.clearCache(false);
              didClearPBCache = true;
              break;
            }
          }
        }
      } catch (e) {
        logger.error("Exception on private browsing image cache clearing", e);
      }
    }

    clearStorage() {
      logger.info("Clearing Disk and Memory Caches");
      try {
        Services.cache2.clear();
      } catch (e) {
        logger.error("Exception on cache clearing", e);
      }

      logger.info("Clearing Cookies and DOM Storage");
      Services.cookies.removeAll();
    }

    clearPreferencesAndPermissions() {
      logger.info("Clearing Content Preferences");
      ChromeUtils.defineESModuleGetters(this, {
        PrivateBrowsingUtils:
          "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
      });
      const pbCtxt = PrivateBrowsingUtils.privacyContextFromWindow(window);
      const cps = Cc["@mozilla.org/content-pref/service;1"].getService(
        Ci.nsIContentPrefService2
      );
      cps.removeAllDomains(pbCtxt);
      this.clearSiteSpecificZoom();

      logger.info("Clearing permissions");
      try {
        Services.perms.removeAll();
      } catch (e) {
        // Actually, this catch does not appear to be needed. Leaving it in for
        // safety though.
        logger.error("Cannot clear permissions", e);
      }

      logger.info("Syncing prefs");
      // Force prefs to be synced to disk
      Services.prefs.savePrefFile(null);
    }

    async clearData() {
      logger.info("Calling the clearDataService");
      const flags =
        Services.clearData.CLEAR_ALL ^ Services.clearData.CLEAR_PASSWORDS;
      return new Promise(resolve => {
        Services.clearData.deleteData(flags, {
          onDataDeleted(code) {
            if (code !== Cr.NS_OK) {
              logger.error(`Error while calling the clearDataService: ${code}`);
            }
            // We always resolve, because we do not want to interrupt the new
            // identity procedure.
            resolve();
          },
        });
      });
    }

    clearConnections() {
      logger.info("Closing open connections");
      // Clear keep-alive
      Services.obs.notifyObservers(this, "net:prune-all-connections");
    }

    clearPrivateSession() {
      logger.info("Ending any remaining private browsing sessions.");
      Services.obs.notifyObservers(null, "last-pb-context-exited");
    }

    async reloadAddons() {
      logger.info("Reloading add-ons to clear their temporary state.");
      // Reload all active extensions except search engines, which would throw.
      const addons = await AddonManager.getAddonsByTypes(["extension"]);
      const isSearchEngine = async addon =>
        (await (await fetch(addon.getResourceURI("manifest.json").spec)).json())
          ?.chrome_settings_overrides?.search_provider;
      const reloadIfNeeded = async addon =>
        addon.isActive && !(await isSearchEngine(addon)) && addon.reload();
      await Promise.all(addons.map(addon => reloadIfNeeded(addon)));
    }

    // Broadcast as a hook to clear other data

    broadcast() {
      logger.info("Broadcasting the new identity");
      Services.obs.notifyObservers({}, topics.newIdentityRequested);
    }

    // Window management

    openNewWindow() {
      logger.info("Opening a new window");
      return new Promise(resolve => {
        // Open a new window forcing the about:privatebrowsing page (tor-browser#41765)
        // unless user explicitly overrides this policy (tor-browser #42236)
        const trustedHomePref = "browser.startup.homepage.new_identity";
        const homeURL = HomePage.get();
        const defaultHomeURL = HomePage.getDefault();
        const isTrustedHome =
          homeURL === defaultHomeURL ||
          homeURL === "chrome://browser/content/blanktab.html" || // about:blank
          homeURL === Services.prefs.getStringPref(trustedHomePref, "");
        const isCustomHome =
          Services.prefs.getIntPref("browser.startup.page") === 1;
        const win = OpenBrowserWindow({
          private: isCustomHome && isTrustedHome ? "private" : "no-home",
        });
        // This mechanism to know when the new window is ready is used by
        // OpenBrowserWindow itself (see its definition in browser.js).
        win.addEventListener(
          "MozAfterPaint",
          () => {
            resolve();
            if (isTrustedHome || !isCustomHome) {
              return;
            }
            const tbl = win.TabsProgressListener;
            const { onLocationChange } = tbl;
            tbl.onLocationChange = (...args) => {
              tbl.onLocationChange = onLocationChange;
              tbl.onLocationChange(...args);
              let displayAddress;
              try {
                const url = new URL(homeURL);
                displayAddress = url.hostname;
                if (!displayAddress) {
                  // no host, use full address and truncate if too long
                  const MAX_LEN = 32;
                  displayAddress = url.href;
                  if (displayAddress.length > MAX_LEN) {
                    displayAddress = `${displayAddress.substring(0, MAX_LEN)}…`;
                  }
                }
              } catch (e) {
                // malformed URL, bail out
                return;
              }
              const callback = () => {
                Services.prefs.setStringPref(trustedHomePref, homeURL);
                win.BrowserHome();
              };
              const notificationBox = win.gBrowser.getNotificationBox();
              notificationBox.appendNotification(
                "new-identity-safe-home",
                {
                  label: {
                    "l10n-id": "new-identity-blocked-home-notification",
                    "l10n-args": { url: displayAddress },
                  },
                  priority: notificationBox.PRIORITY_INFO_MEDIUM,
                },
                [
                  {
                    "l10n-id": "new-identity-blocked-home-ignore-button",
                    callback,
                  },
                ]
              );
            };
          },
          { once: true }
        );
      });
    }

    closeOldWindow() {
      logger.info("Closing the old window");

      // Run garbage collection and cycle collection after window is gone.
      // This ensures that blob URIs are forgotten.
      window.addEventListener("unload", function () {
        logger.debug("Initiating New Identity GC pass");
        // Clear out potential pending sInterSliceGCTimer:
        window.windowUtils.runNextCollectorTimer();
        // Clear out potential pending sICCTimer:
        window.windowUtils.runNextCollectorTimer();
        // Schedule a garbage collection in 4000-1000ms...
        window.windowUtils.garbageCollect();
        // To ensure the GC runs immediately instead of 4-10s from now, we need
        // to poke it at least 11 times.
        // We need 5 pokes for GC, 1 poke for the interSliceGC, and 5 pokes for
        // CC.
        // See nsJSContext::RunNextCollectorTimer() in
        // https://mxr.mozilla.org/mozilla-central/source/dom/base/nsJSEnvironment.cpp#1970.
        // XXX: We might want to make our own method for immediate full GC...
        for (let poke = 0; poke < 11; poke++) {
          window.windowUtils.runNextCollectorTimer();
        }
        // And now, since the GC probably actually ran *after* the CC last time,
        // run the whole thing again.
        window.windowUtils.garbageCollect();
        for (let poke = 0; poke < 11; poke++) {
          window.windowUtils.runNextCollectorTimer();
        }
        logger.debug("Completed New Identity GC pass");
      });

      // Close the current window for added safety
      window.close();
    }
  }

  let newIdentityInProgress = false;
  return {
    topics,

    init() {
      // We first search in the DOM for the identity button. If it does not
      // exist it may be in the toolbox palette. In the latter case we still
      // need to initialize the button in case it is added back later through
      // customization.
      const button =
        document.getElementById("new-identity-button") ||
        window.gNavToolbox.palette.querySelector("#new-identity-button");
      button?.addEventListener("command", () => {
        this.onCommand();
      });
      document
        .getElementById("appMenu-viewCache")
        .content.querySelector("#appMenu-new-identity")
        ?.addEventListener("command", () => {
          this.onCommand();
        });
      document
        .getElementById("menu_newIdentity")
        ?.addEventListener("command", () => {
          this.onCommand();
        });
    },

    uninit() {},

    async onCommand() {
      try {
        // Ignore if there's a New Identity in progress to avoid race
        // conditions leading to failures (see bug 11783 for an example).
        if (newIdentityInProgress) {
          return;
        }
        newIdentityInProgress = true;

        const prefConfirm = "browser.new_identity.confirm_newnym";
        const shouldConfirm = Services.prefs.getBoolPref(prefConfirm, true);
        if (shouldConfirm) {
          const params = {
            confirmed: false,
            neverAskAgain: false,
          };
          await window.gDialogBox.open(
            "chrome://browser/content/newIdentityDialog.xhtml",
            params
          );
          Services.prefs.setBoolPref(prefConfirm, !params.neverAskAgain);
          if (!params.confirmed) {
            return;
          }
        }

        const impl = new NewIdentityImpl();
        await impl.run();
      } catch (e) {
        // If something went wrong make sure we have the New Identity button
        // enabled (again).
        logger.error("Unexpected error", e);
        window.alert("New Identity unexpected error: " + e);
      } finally {
        newIdentityInProgress = false;
      }
    },
  };
});
