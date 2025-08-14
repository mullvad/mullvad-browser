/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  // newtab component is disabled. tor-browser#43886
  AWToolbarButton: "resource:///modules/aboutwelcome/AWToolbarUtils.sys.mjs",
  ASRouter: "resource:///modules/asrouter/ASRouter.sys.mjs",
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  BackupService: "resource:///modules/backup/BackupService.sys.mjs",
  BrowserSearchTelemetry:
    "moz-src:///browser/components/search/BrowserSearchTelemetry.sys.mjs",
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  BrowserUsageTelemetry: "resource:///modules/BrowserUsageTelemetry.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  ContextualIdentityService:
    "resource://gre/modules/ContextualIdentityService.sys.mjs",
  DAPTelemetrySender: "resource://gre/modules/DAPTelemetrySender.sys.mjs",
  DAPVisitCounter: "resource://gre/modules/DAPVisitCounter.sys.mjs",
  DefaultBrowserCheck:
    "moz-src:///browser/components/DefaultBrowserCheck.sys.mjs",
  DesktopActorRegistry:
    "moz-src:///browser/components/DesktopActorRegistry.sys.mjs",
  Discovery: "resource:///modules/Discovery.sys.mjs",
  DistributionManagement: "resource:///modules/distribution.sys.mjs",
  DownloadsViewableInternally:
    "resource:///modules/DownloadsViewableInternally.sys.mjs",
  ExtensionsUI: "resource:///modules/ExtensionsUI.sys.mjs",
  // FilePickerCrashed is used by the `listeners` object below.
  // eslint-disable-next-line mozilla/valid-lazy
  FilePickerCrashed: "resource:///modules/FilePickerCrashed.sys.mjs",
  FormAutofillUtils: "resource://gre/modules/shared/FormAutofillUtils.sys.mjs",
  Interactions: "resource:///modules/Interactions.sys.mjs",
  LoginBreaches: "resource:///modules/LoginBreaches.sys.mjs",
  LoginHelper: "resource://gre/modules/LoginHelper.sys.mjs",
  MigrationUtils: "resource:///modules/MigrationUtils.sys.mjs",
  NimbusFeatures: "resource://nimbus/ExperimentAPI.sys.mjs",
  OnboardingMessageProvider:
    "resource:///modules/asrouter/OnboardingMessageProvider.sys.mjs",
  PageDataService: "resource:///modules/pagedata/PageDataService.sys.mjs",
  PdfJs: "resource://pdf.js/PdfJs.sys.mjs",
  PlacesBrowserStartup:
    "moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs",
  // PluginManager is used by the `listeners` object below.
  // eslint-disable-next-line mozilla/valid-lazy
  PluginManager: "resource:///actors/PluginParent.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  ProfileDataUpgrader:
    "moz-src:///browser/components/ProfileDataUpgrader.sys.mjs",
  RemoteSecuritySettings:
    "resource://gre/modules/psm/RemoteSecuritySettings.sys.mjs",
  RemoteSettings: "resource://services-settings/remote-settings.sys.mjs",
  SafeBrowsing: "resource://gre/modules/SafeBrowsing.sys.mjs",
  Sanitizer: "resource:///modules/Sanitizer.sys.mjs",
  ScreenshotsUtils: "resource:///modules/ScreenshotsUtils.sys.mjs",
  SearchSERPTelemetry:
    "moz-src:///browser/components/search/SearchSERPTelemetry.sys.mjs",
  SecurityLevelRestartNotification:
    "resource:///modules/SecurityLevelRestartNotification.sys.mjs",
  SessionStartup: "resource:///modules/sessionstore/SessionStartup.sys.mjs",
  SessionStore: "resource:///modules/sessionstore/SessionStore.sys.mjs",
  ShortcutUtils: "resource://gre/modules/ShortcutUtils.sys.mjs",
  SpecialMessageActions:
    "resource://messaging-system/lib/SpecialMessageActions.sys.mjs",
  StartupOSIntegration:
    "moz-src:///browser/components/shell/StartupOSIntegration.sys.mjs",
  TelemetryReportingPolicy:
    "resource://gre/modules/TelemetryReportingPolicy.sys.mjs",
  TRRRacer: "resource:///modules/TRRPerformance.sys.mjs",
  WebChannel: "resource://gre/modules/WebChannel.sys.mjs",
  WebProtocolHandlerRegistrar:
    "resource:///modules/WebProtocolHandlerRegistrar.sys.mjs",
  WindowsRegistry: "resource://gre/modules/WindowsRegistry.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

XPCOMUtils.defineLazyServiceGetters(lazy, {
  BrowserHandler: ["@mozilla.org/browser/clh;1", "nsIBrowserHandler"],
  PushService: ["@mozilla.org/push/Service;1", "nsIPushService"],
});

if (AppConstants.ENABLE_WEBDRIVER) {
  XPCOMUtils.defineLazyServiceGetter(
    lazy,
    "Marionette",
    "@mozilla.org/remote/marionette;1",
    "nsIMarionette"
  );

  XPCOMUtils.defineLazyServiceGetter(
    lazy,
    "RemoteAgent",
    "@mozilla.org/remote/agent;1",
    "nsIRemoteAgent"
  );
} else {
  lazy.Marionette = { running: false };
  lazy.RemoteAgent = { running: false };
}

const PREF_PDFJS_ISDEFAULT_CACHE_STATE = "pdfjs.enabledCache.state";

// Empty clipboard content from private windows on exit
// (tor-browser#42154)
const ClipboardPrivacy = {
  _lastClipboardHash: null,
  _globalActivation: false,
  _isPrivateClipboard: false,
  _hasher: null,
  _shuttingDown: false,
  _log: null,

  _createTransferable() {
    const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(
      Ci.nsITransferable
    );
    trans.init(null);
    return trans;
  },
  _computeClipboardHash() {
    const flavors = ["text/x-moz-url", "text/plain"];
    if (
      !Services.clipboard.hasDataMatchingFlavors(
        flavors,
        Ci.nsIClipboard.kGlobalClipboard
      )
    ) {
      return null;
    }
    const trans = this._createTransferable();
    flavors.forEach(trans.addDataFlavor);
    try {
      Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard);
      const clipboardContent = {};
      trans.getAnyTransferData({}, clipboardContent);
      const { data } = clipboardContent.value.QueryInterface(
        Ci.nsISupportsString
      );
      const bytes = new TextEncoder().encode(data);
      const hasher = (this._hasher ||= Cc[
        "@mozilla.org/security/hash;1"
      ].createInstance(Ci.nsICryptoHash));
      hasher.init(hasher.SHA256);
      hasher.update(bytes, bytes.length);
      return hasher.finish(true);
    } catch (e) {}
    return null;
  },

  startup() {
    this._log = console.createInstance({
      prefix: "ClipboardPrivacy",
    });
    this._lastClipboardHash = this._computeClipboardHash();

    // Here we track changes in active window / application,
    // by filtering focus events and window closures.
    const handleActivation = (win, activation) => {
      if (activation) {
        if (!this._globalActivation) {
          // focus changed within this window, bail out.
          return;
        }
        this._globalActivation = false;
      } else if (!Services.focus.activeWindow) {
        // focus is leaving this window:
        // let's track whether it remains within the browser.
        lazy.setTimeout(() => {
          this._globalActivation = !Services.focus.activeWindow;
        }, 100);
      }

      const checkClipboardContent = () => {
        const clipboardHash = this._computeClipboardHash();
        if (clipboardHash !== this._lastClipboardHash) {
          this._isPrivateClipboard =
            !activation &&
            (lazy.PrivateBrowsingUtils.permanentPrivateBrowsing ||
              lazy.PrivateBrowsingUtils.isWindowPrivate(win));
          this._lastClipboardHash = clipboardHash;
          this._log.debug(
            `Clipboard changed: private ${this._isPrivateClipboard}, hash ${clipboardHash}.`
          );
        }
      };

      if (win.closed) {
        checkClipboardContent();
      } else {
        // defer clipboard access on DOM events to work-around tor-browser#42306
        lazy.setTimeout(checkClipboardContent, 0);
      }
    };
    const focusListener = e =>
      e.isTrusted && handleActivation(e.currentTarget, e.type === "focusin");
    const initWindow = win => {
      for (const e of ["focusin", "focusout"]) {
        win.addEventListener(e, focusListener);
      }
    };
    for (const w of Services.ww.getWindowEnumerator()) {
      initWindow(w);
    }
    Services.ww.registerNotification((win, event) => {
      switch (event) {
        case "domwindowopened":
          initWindow(win);
          break;
        case "domwindowclosed":
          handleActivation(win, false);
          if (
            this._isPrivateClipboard &&
            lazy.PrivateBrowsingUtils.isWindowPrivate(win) &&
            (this._shuttingDown ||
              !Array.from(Services.ww.getWindowEnumerator()).find(
                w =>
                  lazy.PrivateBrowsingUtils.isWindowPrivate(w) &&
                  // We need to filter out the HIDDEN WebExtensions window,
                  // which might be private as well but is not UI-relevant.
                  !w.location.href.startsWith("chrome://extensions/")
              ))
          ) {
            // no more private windows, empty private content if needed
            this.emptyPrivate();
          }
      }
    });

    lazy.AsyncShutdown.quitApplicationGranted.addBlocker(
      "ClipboardPrivacy: removing private data",
      () => {
        this._shuttingDown = true;
        this.emptyPrivate();
      }
    );
  },
  emptyPrivate() {
    if (
      this._isPrivateClipboard &&
      !Services.prefs.getBoolPref(
        "browser.privatebrowsing.preserveClipboard",
        false
      ) &&
      this._lastClipboardHash === this._computeClipboardHash()
    ) {
      // nsIClipboard.emptyClipboard() does nothing in Wayland:
      // we'll set an empty string as a work-around.
      const trans = this._createTransferable();
      const flavor = "text/plain";
      trans.addDataFlavor(flavor);
      const emptyString = Cc["@mozilla.org/supports-string;1"].createInstance(
        Ci.nsISupportsString
      );
      emptyString.data = "";
      trans.setTransferData(flavor, emptyString);
      const { clipboard } = Services,
        { kGlobalClipboard } = clipboard;
      clipboard.setData(trans, null, kGlobalClipboard);
      clipboard.emptyClipboard(kGlobalClipboard);
      this._lastClipboardHash = null;
      this._isPrivateClipboard = false;
      this._log.info("Private clipboard emptied.");
    }
  },
};

ChromeUtils.defineLazyGetter(
  lazy,
  "WeaveService",
  () => Cc["@mozilla.org/weave/service;1"].getService().wrappedJSObject
);

if (AppConstants.MOZ_CRASHREPORTER) {
  ChromeUtils.defineESModuleGetters(lazy, {
    UnsubmittedCrashHandler: "resource:///modules/ContentCrashHandlers.sys.mjs",
  });
}

ChromeUtils.defineLazyGetter(lazy, "gBrandBundle", function () {
  return Services.strings.createBundle(
    "chrome://branding/locale/brand.properties"
  );
});

ChromeUtils.defineLazyGetter(lazy, "gBrowserBundle", function () {
  return Services.strings.createBundle(
    "chrome://browser/locale/browser.properties"
  );
});

const listeners = {
  observers: {
    "file-picker-crashed": ["FilePickerCrashed"],
    "gmp-plugin-crash": ["PluginManager"],
    "plugin-crashed": ["PluginManager"],
  },

  observe(subject, topic, data) {
    for (let module of this.observers[topic]) {
      try {
        lazy[module].observe(subject, topic, data);
      } catch (e) {
        console.error(e);
      }
    }
  },

  init() {
    for (let observer of Object.keys(this.observers)) {
      Services.obs.addObserver(this, observer);
    }
  },
};
if (AppConstants.MOZ_UPDATER) {
  ChromeUtils.defineESModuleGetters(lazy, {
    // This listeners/observers/lazy indirection is too much for eslint:
    // eslint-disable-next-line mozilla/valid-lazy
    UpdateListener: "resource://gre/modules/UpdateListener.sys.mjs",
  });

  listeners.observers["update-downloading"] = ["UpdateListener"];
  listeners.observers["update-staged"] = ["UpdateListener"];
  listeners.observers["update-downloaded"] = ["UpdateListener"];
  listeners.observers["update-available"] = ["UpdateListener"];
  listeners.observers["update-error"] = ["UpdateListener"];
  listeners.observers["update-swap"] = ["UpdateListener"];
}

// Seconds of idle time before the late idle tasks will be scheduled.
const LATE_TASKS_IDLE_TIME_SEC = 20;
// Time after we stop tracking startup crashes.
const STARTUP_CRASHES_END_DELAY_MS = 30 * 1000;

/*
 * OS X has the concept of zero-window sessions and therefore ignores the
 * browser-lastwindow-close-* topics.
 */
const OBSERVE_LASTWINDOW_CLOSE_TOPICS = AppConstants.platform != "macosx";

export let BrowserInitState = {};
BrowserInitState.startupIdleTaskPromise = new Promise(resolve => {
  BrowserInitState._resolveStartupIdleTask = resolve;
});
// Whether this launch was initiated by the OS.  A launch-on-login will contain
// the "os-autostart" flag in the initial launch command line.
BrowserInitState.isLaunchOnLogin = false;
// Whether this launch was initiated by a taskbar tab shortcut. A launch from
// a taskbar tab shortcut will contain the "taskbar-tab" flag.
BrowserInitState.isTaskbarTab = false;

export function BrowserGlue() {
  XPCOMUtils.defineLazyServiceGetter(
    this,
    "_userIdleService",
    "@mozilla.org/widget/useridleservice;1",
    "nsIUserIdleService"
  );

  this._init();
}

BrowserGlue.prototype = {
  _saveSession: false,
  _isNewProfile: undefined,
  _defaultCookieBehaviorAtStartup: null,

  _setPrefToSaveSession: function BG__setPrefToSaveSession(aForce) {
    if (!this._saveSession && !aForce) {
      return;
    }

    if (!lazy.PrivateBrowsingUtils.permanentPrivateBrowsing) {
      Services.prefs.setBoolPref(
        "browser.sessionstore.resume_session_once",
        true
      );
    }

    // This method can be called via [NSApplication terminate:] on Mac, which
    // ends up causing prefs not to be flushed to disk, so we need to do that
    // explicitly here. See bug 497652.
    Services.prefs.savePrefFile(null);
  },

  // nsIObserver implementation
  observe: async function BG_observe(subject, topic, data) {
    switch (topic) {
      case "notifications-open-settings":
        this._openPreferences("privacy-permissions");
        break;
      case "final-ui-startup":
        this._beforeUIStartup();
        break;
      case "browser-delayed-startup-finished":
        this._onFirstWindowLoaded(subject);
        Services.obs.removeObserver(this, "browser-delayed-startup-finished");
        break;
      case "sessionstore-windows-restored":
        this._onWindowsRestored();
        break;
      case "browser:purge-session-history":
        // reset the console service's error buffer
        Services.console.logStringMessage(null); // clear the console (in case it's open)
        Services.console.reset();
        break;
      case "restart-in-safe-mode":
        this._onSafeModeRestart(subject);
        break;
      case "quit-application-requested":
        this._onQuitRequest(subject, data);
        break;
      case "quit-application-granted":
        this._onQuitApplicationGranted();
        break;
      case "browser-lastwindow-close-requested":
        if (OBSERVE_LASTWINDOW_CLOSE_TOPICS) {
          // The application is not actually quitting, but the last full browser
          // window is about to be closed.
          this._onQuitRequest(subject, "lastwindow");
        }
        break;
      case "browser-lastwindow-close-granted":
        if (OBSERVE_LASTWINDOW_CLOSE_TOPICS) {
          this._setPrefToSaveSession();
        }
        break;
      case "session-save":
        this._setPrefToSaveSession(true);
        subject.QueryInterface(Ci.nsISupportsPRBool);
        subject.data = true;
        break;
      case "places-init-complete":
        Services.obs.removeObserver(this, "places-init-complete");
        lazy.PlacesBrowserStartup.backendInitComplete();
        break;
      case "browser-glue-test": // used by tests
        if (data == "force-ui-migration") {
          this._migrateUI();
        } else if (data == "places-browser-init-complete") {
          lazy.PlacesBrowserStartup.notifyIfInitializationComplete();
        } else if (data == "add-breaches-sync-handler") {
          this._addBreachesSyncHandler();
        }
        break;
      case "handle-xul-text-link": {
        let linkHandled = subject.QueryInterface(Ci.nsISupportsPRBool);
        if (!linkHandled.data) {
          let win = lazy.BrowserWindowTracker.getTopWindow();
          if (win) {
            data = JSON.parse(data);
            let where = lazy.BrowserUtils.whereToOpenLink(data);
            // Preserve legacy behavior of non-modifier left-clicks
            // opening in a new selected tab.
            if (where == "current") {
              where = "tab";
            }
            win.openTrustedLinkIn(data.href, where);
            linkHandled.data = true;
          }
        }
        break;
      }
      case "profile-before-change":
        // Any component that doesn't need to act after
        // the UI has gone should be finalized in _onQuitApplicationGranted.
        this._dispose();
        break;
      case "keyword-search": {
        // This notification is broadcast by the docshell when it "fixes up" a
        // URI that it's been asked to load into a keyword search.
        let engine = null;
        try {
          engine = Services.search.getEngineByName(
            subject.QueryInterface(Ci.nsISupportsString).data
          );
        } catch (ex) {
          console.error(ex);
        }
        let win = lazy.BrowserWindowTracker.getTopWindow();
        lazy.BrowserSearchTelemetry.recordSearch(
          win.gBrowser.selectedBrowser,
          engine,
          "urlbar"
        );
        break;
      }
      case "xpi-signature-changed": {
        let disabledAddons = JSON.parse(data).disabled;
        let addons = await lazy.AddonManager.getAddonsByIDs(disabledAddons);
        if (addons.some(addon => addon)) {
          this._notifyUnsignedAddonsDisabled();
        }
        break;
      }
      case "handlersvc-store-initialized":
        // Initialize PdfJs when running in-process and remote. This only
        // happens once since PdfJs registers global hooks. If the PdfJs
        // extension is installed the init method below will be overridden
        // leaving initialization to the extension.
        // parent only: configure default prefs, set up pref observers, register
        // pdf content handler, and initializes parent side message manager
        // shim for privileged api access.
        lazy.PdfJs.init(this._isNewProfile);

        // Allow certain viewable internally types to be opened from downloads.
        lazy.DownloadsViewableInternally.register();

        break;
      case "app-startup": {
        this._earlyBlankFirstPaint(subject);
        // The "taskbar-tab" flag and its param will be handled in
        // TaskbarTabCmd.sys.mjs
        BrowserInitState.isTaskbarTab =
          subject.findFlag("taskbar-tab", false) != -1;
        BrowserInitState.isLaunchOnLogin = subject.handleFlag(
          "os-autostart",
          false
        );
        if (AppConstants.platform == "win") {
          lazy.StartupOSIntegration.checkForLaunchOnLogin();
        }
        break;
      }
    }
  },

  // initialization (called on application startup)
  _init: function BG__init() {
    let os = Services.obs;
    [
      "notifications-open-settings",
      "final-ui-startup",
      "browser-delayed-startup-finished",
      "sessionstore-windows-restored",
      "browser:purge-session-history",
      "quit-application-requested",
      "quit-application-granted",
      "session-save",
      "places-init-complete",
      "handle-xul-text-link",
      "profile-before-change",
      "keyword-search",
      "restart-in-safe-mode",
      "xpi-signature-changed",
      "handlersvc-store-initialized",
    ].forEach(topic => os.addObserver(this, topic, true));
    if (OBSERVE_LASTWINDOW_CLOSE_TOPICS) {
      os.addObserver(this, "browser-lastwindow-close-requested", true);
      os.addObserver(this, "browser-lastwindow-close-granted", true);
    }

    lazy.DesktopActorRegistry.init();
  },

  // cleanup (called on application shutdown)
  _dispose: function BG__dispose() {
    // newtab component is disabled. tor-browser#43886

    if (this._lateTasksIdleObserver) {
      this._userIdleService.removeIdleObserver(
        this._lateTasksIdleObserver,
        LATE_TASKS_IDLE_TIME_SEC
      );
      delete this._lateTasksIdleObserver;
    }
    if (this._gmpInstallManager) {
      this._gmpInstallManager.uninit();
      delete this._gmpInstallManager;
    }
  },

  // runs on startup, before the first command line handler is invoked
  // (i.e. before the first window is opened)
  _beforeUIStartup: function BG__beforeUIStartup() {
    lazy.SessionStartup.init();

    // check if we're in safe mode
    if (Services.appinfo.inSafeMode) {
      Services.ww.openWindow(
        null,
        "chrome://browser/content/safeMode.xhtml",
        "_blank",
        "chrome,centerscreen,modal,resizable=no",
        null
      );
    }

    // apply distribution customizations
    lazy.DistributionManagement.applyCustomizations();

    // handle any UI migration
    this._migrateUI();

    // Base Browser-specific version of _migrateUI.
    this._migrateUIBB();

    // Mullvad Browser-specific version of _migrateUI.
    this._migrateUIMB();

    if (!Services.prefs.prefHasUserValue(PREF_PDFJS_ISDEFAULT_CACHE_STATE)) {
      lazy.PdfJs.checkIsDefault(this._isNewProfile);
    }

    if (!AppConstants.NIGHTLY_BUILD && this._isNewProfile) {
      lazy.FormAutofillUtils.setOSAuthEnabled(
        lazy.FormAutofillUtils.AUTOFILL_CREDITCARDS_REAUTH_PREF,
        false
      );
      lazy.LoginHelper.setOSAuthEnabled(
        lazy.LoginHelper.OS_AUTH_FOR_PASSWORDS_PREF,
        false
      );
    }

    listeners.init();

    lazy.BrowserUtils.callModulesFromCategory({
      categoryName: "browser-before-ui-startup",
    });

    Services.obs.notifyObservers(null, "browser-ui-startup-complete");
  },

  _checkForOldBuildUpdates() {
    // check for update if our build is old
    if (
      AppConstants.MOZ_UPDATER &&
      Services.prefs.getBoolPref("app.update.checkInstallTime")
    ) {
      let buildID = Services.appinfo.appBuildID;
      let today = new Date().getTime();
      /* eslint-disable no-multi-spaces */
      let buildDate = new Date(
        buildID.slice(0, 4), // year
        buildID.slice(4, 6) - 1, // months are zero-based.
        buildID.slice(6, 8), // day
        buildID.slice(8, 10), // hour
        buildID.slice(10, 12), // min
        buildID.slice(12, 14)
      ) // ms
        .getTime();
      /* eslint-enable no-multi-spaces */

      const millisecondsIn24Hours = 86400000;
      let acceptableAge =
        Services.prefs.getIntPref("app.update.checkInstallTime.days") *
        millisecondsIn24Hours;

      if (buildDate + acceptableAge < today) {
        // This is asynchronous, but just kick it off rather than waiting.
        Cc["@mozilla.org/updates/update-service;1"]
          .getService(Ci.nsIApplicationUpdateService)
          .checkForBackgroundUpdates();
      }
    }
  },

  async _onSafeModeRestart(window) {
    // prompt the user to confirm
    let productName = lazy.gBrandBundle.GetStringFromName("brandShortName");
    let strings = lazy.gBrowserBundle;
    let promptTitle = strings.formatStringFromName(
      "troubleshootModeRestartPromptTitle",
      [productName]
    );
    let promptMessage = strings.GetStringFromName(
      "troubleshootModeRestartPromptMessage"
    );
    let restartText = strings.GetStringFromName(
      "troubleshootModeRestartButton"
    );
    let buttonFlags =
      Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
      Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL +
      Services.prompt.BUTTON_POS_0_DEFAULT;

    let rv = await Services.prompt.asyncConfirmEx(
      window.browsingContext,
      Ci.nsIPrompt.MODAL_TYPE_INTERNAL_WINDOW,
      promptTitle,
      promptMessage,
      buttonFlags,
      restartText,
      null,
      null,
      null,
      {}
    );
    if (rv.get("buttonNumClicked") != 0) {
      return;
    }

    let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
      Ci.nsISupportsPRBool
    );
    Services.obs.notifyObservers(
      cancelQuit,
      "quit-application-requested",
      "restart"
    );

    if (!cancelQuit.data) {
      Services.startup.restartInSafeMode(Ci.nsIAppStartup.eAttemptQuit);
    }
  },

  /**
   * Show a notification bar offering a reset.
   *
   * @param reason
   *        String of either "unused" or "uninstall", specifying the reason
   *        why a profile reset is offered.
   */
  _resetProfileNotification(reason) {
    let win = lazy.BrowserWindowTracker.getTopWindow();
    if (!win) {
      return;
    }

    const { ResetProfile } = ChromeUtils.importESModule(
      "resource://gre/modules/ResetProfile.sys.mjs"
    );
    if (!ResetProfile.resetSupported()) {
      return;
    }

    let productName = lazy.gBrandBundle.GetStringFromName("brandShortName");
    let resetBundle = Services.strings.createBundle(
      "chrome://global/locale/resetProfile.properties"
    );

    let message;
    if (reason == "unused") {
      message = resetBundle.formatStringFromName("resetUnusedProfile.message", [
        productName,
      ]);
    } else if (reason == "uninstall") {
      message = resetBundle.formatStringFromName("resetUninstalled.message", [
        productName,
      ]);
    } else {
      throw new Error(
        `Unknown reason (${reason}) given to _resetProfileNotification.`
      );
    }
    let buttons = [
      {
        label: resetBundle.formatStringFromName(
          "refreshProfile.resetButton.label",
          [productName]
        ),
        accessKey: resetBundle.GetStringFromName(
          "refreshProfile.resetButton.accesskey"
        ),
        callback() {
          ResetProfile.openConfirmationDialog(win);
        },
      },
    ];

    win.gNotificationBox.appendNotification(
      "reset-profile-notification",
      {
        label: message,
        image: "chrome://global/skin/icons/question-64.png",
        priority: win.gNotificationBox.PRIORITY_INFO_LOW,
      },
      buttons
    );
  },

  _notifyUnsignedAddonsDisabled() {
    let win = lazy.BrowserWindowTracker.getTopWindow();
    if (!win) {
      return;
    }

    let message = win.gNavigatorBundle.getString(
      "unsignedAddonsDisabled.message"
    );
    let buttons = [
      {
        label: win.gNavigatorBundle.getString(
          "unsignedAddonsDisabled.learnMore.label"
        ),
        accessKey: win.gNavigatorBundle.getString(
          "unsignedAddonsDisabled.learnMore.accesskey"
        ),
        callback() {
          win.BrowserAddonUI.openAddonsMgr(
            "addons://list/extension?unsigned=true"
          );
        },
      },
    ];

    win.gNotificationBox.appendNotification(
      "unsigned-addons-disabled",
      {
        label: message,
        priority: win.gNotificationBox.PRIORITY_WARNING_MEDIUM,
      },
      buttons
    );
  },

  _earlyBlankFirstPaint(cmdLine) {
    let startTime = Cu.now();

    let shouldCreateWindow = isPrivateWindow => {
      if (cmdLine.findFlag("wait-for-jsdebugger", false) != -1) {
        return true;
      }

      if (
        AppConstants.platform == "macosx" ||
        Services.startup.wasSilentlyStarted ||
        !Services.prefs.getBoolPref("browser.startup.blankWindow", false)
      ) {
        return false;
      }

      // Until bug 1450626 and bug 1488384 are fixed, skip the blank window when
      // using a non-default theme.
      if (
        !Services.startup.showedPreXULSkeletonUI &&
        Services.prefs.getCharPref(
          "extensions.activeThemeID",
          "default-theme@mozilla.org"
        ) != "default-theme@mozilla.org"
      ) {
        return false;
      }

      // Bug 1448423: Skip the blank window if the user is resisting fingerprinting
      if (
        Services.prefs.getBoolPref(
          "privacy.resistFingerprinting.skipEarlyBlankFirstPaint",
          true
        ) &&
        ChromeUtils.shouldResistFingerprinting(
          "RoundWindowSize",
          null,
          isPrivateWindow ||
            Services.prefs.getBoolPref(
              "browser.privatebrowsing.autostart",
              false
            )
        )
      ) {
        return false;
      }

      let width = getValue("width");
      let height = getValue("height");

      // The clean profile case isn't handled yet. Return early for now.
      if (!width || !height) {
        return false;
      }

      return true;
    };

    let makeWindowPrivate =
      cmdLine.findFlag("private-window", false) != -1 &&
      lazy.StartupOSIntegration.isPrivateBrowsingAllowedInRegistry();
    if (!shouldCreateWindow(makeWindowPrivate)) {
      return;
    }

    let browserWindowFeatures =
      "chrome,all,dialog=no,extrachrome,menubar,resizable,scrollbars,status," +
      "location,toolbar,personalbar";
    // This needs to be set when opening the window to ensure that the AppUserModelID
    // is set correctly on Windows. Without it, initial launches with `-private-window`
    // will show up under the regular Firefox taskbar icon first, and then switch
    // to the Private Browsing icon shortly thereafter.
    if (makeWindowPrivate) {
      browserWindowFeatures += ",private";
    }
    let win = Services.ww.openWindow(
      null,
      "about:blank",
      null,
      browserWindowFeatures,
      null
    );

    // Hide the titlebar if the actual browser window will draw in it.
    let hiddenTitlebar = Services.appinfo.drawInTitlebar;
    if (hiddenTitlebar) {
      win.windowUtils.setCustomTitlebar(true);
    }

    let docElt = win.document.documentElement;
    docElt.setAttribute("screenX", getValue("screenX"));
    docElt.setAttribute("screenY", getValue("screenY"));

    // The sizemode="maximized" attribute needs to be set before first paint.
    let sizemode = getValue("sizemode");
    let width = getValue("width") || 500;
    let height = getValue("height") || 500;
    if (sizemode == "maximized") {
      docElt.setAttribute("sizemode", sizemode);

      // Set the size to use when the user leaves the maximized mode.
      // The persisted size is the outer size, but the height/width
      // attributes set the inner size.
      let appWin = win.docShell.treeOwner
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIAppWindow);
      height -= appWin.outerToInnerHeightDifferenceInCSSPixels;
      width -= appWin.outerToInnerWidthDifferenceInCSSPixels;
      docElt.setAttribute("height", height);
      docElt.setAttribute("width", width);
    } else {
      // Setting the size of the window in the features string instead of here
      // causes the window to grow by the size of the titlebar.
      win.resizeTo(width, height);
    }

    // Set this before showing the window so that graphics code can use it to
    // decide to skip some expensive code paths (eg. starting the GPU process).
    docElt.setAttribute("windowtype", "navigator:blank");

    // The window becomes visible after OnStopRequest, so make this happen now.
    win.stop();

    ChromeUtils.addProfilerMarker("earlyBlankFirstPaint", startTime);
    win.openTime = Cu.now();

    let { TelemetryTimestamps } = ChromeUtils.importESModule(
      "resource://gre/modules/TelemetryTimestamps.sys.mjs"
    );
    TelemetryTimestamps.add("blankWindowShown");

    function getValue(attr) {
      return Services.xulStore.getValue(
        AppConstants.BROWSER_CHROME_URL,
        "main-window",
        attr
      );
    }
  },

  _firstWindowTelemetry(aWindow) {
    let scaling = aWindow.devicePixelRatio * 100;
    Glean.gfxDisplay.scaling.accumulateSingleSample(scaling);
  },

  // the first browser window has finished initializing
  _onFirstWindowLoaded: function BG__onFirstWindowLoaded(aWindow) {
    // A channel for "remote troubleshooting" code...
    let channel = new lazy.WebChannel(
      "remote-troubleshooting",
      "remote-troubleshooting"
    );
    channel.listen((id, data, target) => {
      if (data.command == "request") {
        let { Troubleshoot } = ChromeUtils.importESModule(
          "resource://gre/modules/Troubleshoot.sys.mjs"
        );
        Troubleshoot.snapshot().then(snapshotData => {
          // for privacy we remove crash IDs and all preferences (but bug 1091944
          // exists to expose prefs once we are confident of privacy implications)
          delete snapshotData.crashes;
          delete snapshotData.modifiedPreferences;
          delete snapshotData.printingPreferences;
          channel.send(snapshotData, target);
        });
      }
    });

    this._maybeOfferProfileReset();

    this._checkForOldBuildUpdates();

    // Check if Sync is configured
    if (Services.prefs.prefHasUserValue("services.sync.username")) {
      lazy.WeaveService.init();
    }

    lazy.SecurityLevelRestartNotification.ready();

    ClipboardPrivacy.startup();

    lazy.BrowserUtils.callModulesFromCategory(
      {
        categoryName: "browser-first-window-ready",
        profilerMarker: "browserFirstWindowReady",
      },
      aWindow
    );

    this._firstWindowTelemetry(aWindow);
  },

  _maybeOfferProfileReset() {
    // Offer to reset a user's profile if it hasn't been used for 60 days.
    const OFFER_PROFILE_RESET_INTERVAL_MS = 60 * 24 * 60 * 60 * 1000;
    let lastUse = Services.appinfo.replacedLockTime;
    let disableResetPrompt = Services.prefs.getBoolPref(
      "browser.disableResetPrompt",
      false
    );

    // Also check prefs.js last modified timestamp as a backstop.
    // This helps for cases where the lock file checks don't work,
    // e.g. NFS or because the previous time Firefox ran, it ran
    // for a very long time. See bug 1054947 and related bugs.
    lastUse = Math.max(
      lastUse,
      Services.prefs.userPrefsFileLastModifiedAtStartup
    );

    if (
      !disableResetPrompt &&
      lastUse &&
      Date.now() - lastUse >= OFFER_PROFILE_RESET_INTERVAL_MS
    ) {
      this._resetProfileNotification("unused");
    } else if (AppConstants.platform == "win" && !disableResetPrompt) {
      // Check if we were just re-installed and offer Firefox Reset
      let updateChannel;
      try {
        updateChannel = ChromeUtils.importESModule(
          "resource://gre/modules/UpdateUtils.sys.mjs"
        ).UpdateUtils.UpdateChannel;
      } catch (ex) {}
      if (updateChannel) {
        let uninstalledValue = lazy.WindowsRegistry.readRegKey(
          Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
          "Software\\Mozilla\\Firefox",
          `Uninstalled-${updateChannel}`
        );
        let removalSuccessful = lazy.WindowsRegistry.removeRegKey(
          Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
          "Software\\Mozilla\\Firefox",
          `Uninstalled-${updateChannel}`
        );
        if (removalSuccessful && uninstalledValue == "True") {
          this._resetProfileNotification("uninstall");
        }
      }
    }
  },

  /**
   * Application shutdown handler.
   *
   * If you need new code to be called on shutdown, please use
   * the category manager browser-quit-application-granted category
   * instead of adding new manual code to this function.
   */
  _onQuitApplicationGranted() {
    function failureHandler(ex) {
      if (Cu.isInAutomation) {
        // This usually happens after the test harness is done collecting
        // test errors, thus we can't easily add a failure to it. The only
        // noticeable solution we have is crashing.
        Cc["@mozilla.org/xpcom/debug;1"]
          .getService(Ci.nsIDebug2)
          .abort(ex.filename, ex.lineNumber);
      }
    }

    lazy.BrowserUtils.callModulesFromCategory({
      categoryName: "browser-quit-application-granted",
      failureHandler,
    });

    let tasks = [
      // This pref must be set here because SessionStore will use its value
      // on quit-application.
      () => this._setPrefToSaveSession(),

      // Call trackStartupCrashEnd here in case the delayed call on startup hasn't
      // yet occurred (see trackStartupCrashEnd caller in browser.js).
      () => Services.startup.trackStartupCrashEnd(),

      () => {
        // bug 1839426 - The FOG service needs to be instantiated reliably so it
        // can perform at-shutdown tasks later in shutdown.
        Services.fog;
      },
    ];

    for (let task of tasks) {
      try {
        task();
      } catch (ex) {
        console.error(`Error during quit-application-granted: ${ex}`);
        failureHandler(ex);
      }
    }
  },

  _monitorWebcompatReporterPref() {
    const PREF = "extensions.webcompat-reporter.enabled";
    const ID = "webcompat-reporter@mozilla.org";
    Services.prefs.addObserver(PREF, async () => {
      let addon = await lazy.AddonManager.getAddonByID(ID);
      if (!addon) {
        return;
      }
      let enabled = Services.prefs.getBoolPref(PREF, false);
      if (enabled && !addon.isActive) {
        await addon.enable({ allowSystemAddons: true });
      } else if (!enabled && addon.isActive) {
        await addon.disable({ allowSystemAddons: true });
      }
    });
  },

  // All initial windows have opened.
  _onWindowsRestored: function BG__onWindowsRestored() {
    if (this._windowsWereRestored) {
      return;
    }
    this._windowsWereRestored = true;

    lazy.BrowserUsageTelemetry.init();
    lazy.SearchSERPTelemetry.init();

    lazy.Interactions.init();
    lazy.PageDataService.init();
    lazy.ExtensionsUI.init();

    let signingRequired;
    if (AppConstants.MOZ_REQUIRE_SIGNING) {
      signingRequired = true;
    } else {
      signingRequired = Services.prefs.getBoolPref(
        "xpinstall.signatures.required"
      );
    }

    if (signingRequired) {
      let disabledAddons = lazy.AddonManager.getStartupChanges(
        lazy.AddonManager.STARTUP_CHANGE_DISABLED
      );
      lazy.AddonManager.getAddonsByIDs(disabledAddons).then(addons => {
        for (let addon of addons) {
          if (addon.signedState <= lazy.AddonManager.SIGNEDSTATE_MISSING) {
            this._notifyUnsignedAddonsDisabled();
            break;
          }
        }
      });
    }

    if (AppConstants.MOZ_CRASHREPORTER) {
      lazy.UnsubmittedCrashHandler.init();
      lazy.UnsubmittedCrashHandler.scheduleCheckForUnsubmittedCrashReports();
    }

    if (AppConstants.ASAN_REPORTER) {
      var { AsanReporter } = ChromeUtils.importESModule(
        "resource://gre/modules/AsanReporter.sys.mjs"
      );
      AsanReporter.init();
    }

    lazy.Sanitizer.onStartup();
    this._maybeShowRestoreSessionInfoBar();
    this._scheduleStartupIdleTasks();
    this._lateTasksIdleObserver = (idleService, topic) => {
      if (topic == "idle") {
        idleService.removeIdleObserver(
          this._lateTasksIdleObserver,
          LATE_TASKS_IDLE_TIME_SEC
        );
        delete this._lateTasksIdleObserver;
        this._scheduleBestEffortUserIdleTasks();
      }
    };
    this._userIdleService.addIdleObserver(
      this._lateTasksIdleObserver,
      LATE_TASKS_IDLE_TIME_SEC
    );

    this._monitorWebcompatReporterPref();

    // Loading the MigrationUtils module does the work of registering the
    // migration wizard JSWindowActor pair. In case nothing else has done
    // this yet, load the MigrationUtils so that the wizard is ready to be
    // used.
    lazy.MigrationUtils;
  },

  /**
   * Use this function as an entry point to schedule tasks that
   * need to run only once after startup, and can be scheduled
   * by using an idle callback.
   *
   * The functions scheduled here will fire from idle callbacks
   * once every window has finished being restored by session
   * restore, and it's guaranteed that they will run before
   * the equivalent per-window idle tasks
   * (from _schedulePerWindowIdleTasks in browser.js).
   *
   * If you have something that can wait even further than the
   * per-window initialization, and is okay with not being run in some
   * sessions, please schedule them using
   * _scheduleBestEffortUserIdleTasks.
   * Don't be fooled by thinking that the use of the timeout parameter
   * will delay your function: it will just ensure that it potentially
   * happens _earlier_ than expected (when the timeout limit has been reached),
   * but it will not make it happen later (and out of order) compared
   * to the other ones scheduled together.
   */
  _scheduleStartupIdleTasks() {
    function runIdleTasks(idleTasks) {
      for (let task of idleTasks) {
        if ("condition" in task && !task.condition) {
          continue;
        }

        ChromeUtils.idleDispatch(
          async () => {
            if (!Services.startup.shuttingDown) {
              let startTime = Cu.now();
              try {
                await task.task();
              } catch (ex) {
                console.error(ex);
              } finally {
                ChromeUtils.addProfilerMarker(
                  "startupIdleTask",
                  startTime,
                  task.name
                );
              }
            }
          },
          task.timeout ? { timeout: task.timeout } : undefined
        );
      }
    }

    // Note: unless you need a timeout, please do not add new tasks here, and
    // instead use the category manager. You can do this in a manifest file in
    // the component that needs to run code, or in BrowserComponents.manifest
    // in this folder. The callModulesFromCategory call below will call them.
    const earlyTasks = [
      // It's important that SafeBrowsing is initialized reasonably
      // early, so we use a maximum timeout for it.
      {
        name: "SafeBrowsing.init",
        task: () => {
          lazy.SafeBrowsing.init();
        },
        timeout: 5000,
      },

      {
        name: "ContextualIdentityService.load",
        task: async () => {
          await lazy.ContextualIdentityService.load();
          lazy.Discovery.update();
        },
      },
    ];

    runIdleTasks(earlyTasks);

    lazy.BrowserUtils.callModulesFromCategory({
      categoryName: "browser-idle-startup",
      profilerMarker: "startupIdleTask",
      idleDispatch: true,
    });

    const lateTasks = [
      // Begin listening for incoming push messages.
      {
        name: "PushService.ensureReady",
        task: () => {
          try {
            lazy.PushService.wrappedJSObject.ensureReady();
          } catch (ex) {
            // NS_ERROR_NOT_AVAILABLE will get thrown for the PushService
            // getter if the PushService is disabled.
            if (ex.result != Cr.NS_ERROR_NOT_AVAILABLE) {
              throw ex;
            }
          }
        },
      },

      // Load the Login Manager data from disk off the main thread, some time
      // after startup.  If the data is required before this runs, for example
      // because a restored page contains a password field, it will be loaded on
      // the main thread, and this initialization request will be ignored.
      {
        name: "Services.logins",
        task: () => {
          try {
            Services.logins;
          } catch (ex) {
            console.error(ex);
          }
        },
        timeout: 3000,
      },

      // Add breach alerts pref observer reasonably early so the pref flip works
      {
        name: "_addBreachAlertsPrefObserver",
        task: () => {
          this._addBreachAlertsPrefObserver();
        },
      },

      {
        name: "BrowserGlue._maybeShowDefaultBrowserPrompt",
        task: () => {
          this._maybeShowDefaultBrowserPrompt();
        },
      },

      {
        name: "BrowserGlue._monitorScreenshotsPref",
        task: () => {
          lazy.ScreenshotsUtils.monitorScreenshotsPref();
        },
      },

      {
        name: "trackStartupCrashEndSetTimeout",
        task: () => {
          lazy.setTimeout(function () {
            Services.tm.idleDispatchToMainThread(
              Services.startup.trackStartupCrashEnd
            );
          }, STARTUP_CRASHES_END_DELAY_MS);
        },
      },

      {
        name: "handlerService.asyncInit",
        task: () => {
          let handlerService = Cc[
            "@mozilla.org/uriloader/handler-service;1"
          ].getService(Ci.nsIHandlerService);
          handlerService.asyncInit();
        },
      },

      {
        name: "webProtocolHandlerService.asyncInit",
        task: () => {
          lazy.WebProtocolHandlerRegistrar.prototype.init(true);
        },
      },

      // Run TRR performance measurements for DoH.
      {
        name: "doh-rollout.trrRacer.run",
        task: () => {
          let enabledPref = "doh-rollout.trrRace.enabled";
          let completePref = "doh-rollout.trrRace.complete";

          if (Services.prefs.getBoolPref(enabledPref, false)) {
            if (!Services.prefs.getBoolPref(completePref, false)) {
              new lazy.TRRRacer().run(() => {
                Services.prefs.setBoolPref(completePref, true);
              });
            }
          } else {
            Services.prefs.addObserver(enabledPref, function observer() {
              if (Services.prefs.getBoolPref(enabledPref, false)) {
                Services.prefs.removeObserver(enabledPref, observer);

                if (!Services.prefs.getBoolPref(completePref, false)) {
                  new lazy.TRRRacer().run(() => {
                    Services.prefs.setBoolPref(completePref, true);
                  });
                }
              }
            });
          }
        },
      },

      // Add the setup button if this is the first startup
      {
        name: "AWToolbarButton.SetupButton",
        task: async () => {
          if (
            // Not in automation: the button changes CUI state,
            // breaking tests. Check this first, so that the module
            // doesn't load if it doesn't have to.
            !Cu.isInAutomation &&
            lazy.AWToolbarButton.hasToolbarButtonEnabled
          ) {
            await lazy.AWToolbarButton.maybeAddSetupButton();
          }
        },
      },

      {
        name: "BackgroundUpdate",
        condition: AppConstants.MOZ_UPDATE_AGENT && AppConstants.MOZ_UPDATER,
        task: async () => {
          let updateServiceStub = Cc[
            "@mozilla.org/updates/update-service-stub;1"
          ].getService(Ci.nsIApplicationUpdateServiceStub);
          // Never in automation!
          if (!updateServiceStub.updateDisabledForTesting) {
            let { BackgroundUpdate } = ChromeUtils.importESModule(
              "resource://gre/modules/BackgroundUpdate.sys.mjs"
            );
            try {
              await BackgroundUpdate.scheduleFirefoxMessagingSystemTargetingSnapshotting();
            } catch (e) {
              console.error(
                "There was an error scheduling Firefox Messaging System targeting snapshotting: ",
                e
              );
            }
            await BackgroundUpdate.maybeScheduleBackgroundUpdateTask();
          }
        },
      },

      // Login detection service is used in fission to identify high value sites.
      {
        name: "LoginDetection.init",
        task: () => {
          let loginDetection = Cc[
            "@mozilla.org/login-detection-service;1"
          ].createInstance(Ci.nsILoginDetectionService);
          loginDetection.init();
        },
      },

      // Schedule a sync (if enabled) after we've loaded
      {
        name: "WeaveService",
        task: async () => {
          if (lazy.WeaveService.enabled) {
            await lazy.WeaveService.whenLoaded();
            lazy.WeaveService.Weave.Service.scheduler.autoConnect();
          }
        },
      },

      {
        name: "unblock-untrusted-modules-thread",
        condition: AppConstants.platform == "win",
        task: () => {
          Services.obs.notifyObservers(
            null,
            "unblock-untrusted-modules-thread"
          );
        },
      },

      {
        name: "DAPTelemetrySender.startup",
        condition: AppConstants.MOZ_TELEMETRY_REPORTING,
        task: async () => {
          await lazy.DAPTelemetrySender.startup();
          await lazy.DAPVisitCounter.startup();
        },
      },

      {
        // Starts the JSOracle process for ORB JavaScript validation, if it hasn't started already.
        name: "start-orb-javascript-oracle",
        task: () => {
          ChromeUtils.ensureJSOracleStarted();
        },
      },

      {
        name: "BackupService initialization",
        condition: Services.prefs.getBoolPref("browser.backup.enabled", false),
        task: () => {
          lazy.BackupService.init();
        },
      },

      {
        name: "Init hasSSD for SystemInfo",
        condition: AppConstants.platform == "win",
        // Initializes diskInfo to be able to get hasSSD which is part
        // of the PageLoad event. Only runs on windows, since diskInfo
        // is a no-op on other platforms
        task: () => Services.sysinfo.diskInfo,
      },

      {
        name: "browser-startup-idle-tasks-finished",
        task: () => {
          // Use idleDispatch a second time to run this after the per-window
          // idle tasks.
          ChromeUtils.idleDispatch(() => {
            Services.obs.notifyObservers(
              null,
              "browser-startup-idle-tasks-finished"
            );
            BrowserInitState._resolveStartupIdleTask();
          });
        },
      },
      // Do NOT add anything after idle tasks finished.
    ];

    runIdleTasks(lateTasks);
  },

  /**
   * Use this function as an entry point to schedule tasks that we hope
   * to run once per session, at any arbitrary point in time, and which we
   * are okay with sometimes not running at all.
   *
   * This function will be called from an idle observer. Check the value of
   * LATE_TASKS_IDLE_TIME_SEC to see the current value for this idle
   * observer.
   *
   * Note: this function may never be called if the user is never idle for the
   * requisite time (LATE_TASKS_IDLE_TIME_SEC). Be certain before adding
   * something here that it's okay that it never be run.
   */
  _scheduleBestEffortUserIdleTasks() {
    const idleTasks = [
      function GMPInstallManagerSimpleCheckAndInstall() {
        let { GMPInstallManager } = ChromeUtils.importESModule(
          "resource://gre/modules/GMPInstallManager.sys.mjs"
        );
        this._gmpInstallManager = new GMPInstallManager();
        // We don't really care about the results, if someone is interested they
        // can check the log.
        this._gmpInstallManager.simpleCheckAndInstall().catch(() => {});
      }.bind(this),

      function RemoteSettingsInit() {
        lazy.RemoteSettings.init();
        this._addBreachesSyncHandler();
      }.bind(this),

      function RemoteSecuritySettingsInit() {
        lazy.RemoteSecuritySettings.init();
      },

      function RemoteSettingsPollChanges() {
        // Support clients that use the "sync" event or "remote-settings:changes-poll-end".
        lazy.RemoteSettings.pollChanges({ trigger: "timer" });
      },

      function searchBackgroundChecks() {
        Services.search.runBackgroundChecks();
      },
    ];

    for (let task of idleTasks) {
      ChromeUtils.idleDispatch(async () => {
        if (!Services.startup.shuttingDown) {
          let startTime = Cu.now();
          try {
            await task();
          } catch (ex) {
            console.error(ex);
          } finally {
            ChromeUtils.addProfilerMarker(
              "startupLateIdleTask",
              startTime,
              task.name
            );
          }
        }
      });
    }

    lazy.BrowserUtils.callModulesFromCategory({
      categoryName: "browser-best-effort-idle-startup",
      idleDispatch: true,
      profilerMarker: "startupLateIdleTask",
    });
  },

  _addBreachesSyncHandler() {
    if (
      Services.prefs.getBoolPref(
        "signon.management.page.breach-alerts.enabled",
        false
      )
    ) {
      lazy
        .RemoteSettings(lazy.LoginBreaches.REMOTE_SETTINGS_COLLECTION)
        .on("sync", async event => {
          await lazy.LoginBreaches.update(event.data.current);
        });
    }
  },

  _addBreachAlertsPrefObserver() {
    const BREACH_ALERTS_PREF = "signon.management.page.breach-alerts.enabled";
    const clearVulnerablePasswordsIfBreachAlertsDisabled = async function () {
      if (!Services.prefs.getBoolPref(BREACH_ALERTS_PREF)) {
        // mullvad-browser#21: LoginBreaches is removed at compile time
        // await lazy.LoginBreaches.clearAllPotentiallyVulnerablePasswords();
      }
    };
    clearVulnerablePasswordsIfBreachAlertsDisabled();
    Services.prefs.addObserver(
      BREACH_ALERTS_PREF,
      clearVulnerablePasswordsIfBreachAlertsDisabled
    );
  },

  _quitSource: "unknown",
  _registerQuitSource(source) {
    this._quitSource = source;
  },

  _onQuitRequest: function BG__onQuitRequest(aCancelQuit, aQuitType) {
    // If user has already dismissed quit request, then do nothing
    if (aCancelQuit instanceof Ci.nsISupportsPRBool && aCancelQuit.data) {
      return;
    }

    // There are several cases where we won't show a dialog here:
    // 1. There is only 1 tab open in 1 window
    // 2. browser.warnOnQuit == false
    // 3. The browser is currently in Private Browsing mode
    // 4. The browser will be restarted.
    // 5. The user has automatic session restore enabled and
    //    browser.sessionstore.warnOnQuit is not set to true.
    // 6. The user doesn't have automatic session restore enabled
    //    and browser.tabs.warnOnClose is not set to true.
    //
    // Otherwise, we will show the "closing multiple tabs" dialog.
    //
    // aQuitType == "lastwindow" is overloaded. "lastwindow" is used to indicate
    // "the last window is closing but we're not quitting (a non-browser window is open)"
    // and also "we're quitting by closing the last window".

    if (aQuitType == "restart" || aQuitType == "os-restart") {
      return;
    }

    // browser.warnOnQuit is a hidden global boolean to override all quit prompts.
    if (!Services.prefs.getBoolPref("browser.warnOnQuit")) {
      return;
    }

    let windowcount = 0;
    let pagecount = 0;
    for (let win of lazy.BrowserWindowTracker.orderedWindows) {
      if (win.closed) {
        continue;
      }
      windowcount++;
      let tabbrowser = win.gBrowser;
      if (tabbrowser) {
        pagecount += tabbrowser.visibleTabs.length - tabbrowser.pinnedTabCount;
      }
    }

    // No windows open so no need for a warning.
    if (!windowcount) {
      return;
    }

    // browser.warnOnQuitShortcut is checked when quitting using the shortcut key.
    // The warning will appear even when only one window/tab is open. For other
    // methods of quitting, the warning only appears when there is more than one
    // window or tab open.
    let shouldWarnForShortcut =
      this._quitSource == "shortcut" &&
      Services.prefs.getBoolPref("browser.warnOnQuitShortcut");
    let shouldWarnForTabs =
      pagecount >= 2 && Services.prefs.getBoolPref("browser.tabs.warnOnClose");
    if (!shouldWarnForTabs && !shouldWarnForShortcut) {
      return;
    }

    if (!aQuitType) {
      aQuitType = "quit";
    }

    let win = lazy.BrowserWindowTracker.getTopWindow();

    // Our prompt for quitting is most important, so replace others.
    win.gDialogBox.replaceDialogIfOpen();

    let titleId = {
      id: "tabbrowser-confirm-close-tabs-title",
      args: { tabCount: pagecount },
    };
    let quitButtonLabelId = "tabbrowser-confirm-close-tabs-button";
    let closeTabButtonLabelId = "tabbrowser-confirm-close-tab-only-button";

    let showCloseCurrentTabOption = false;
    if (windowcount > 1) {
      // More than 1 window. Compose our own message based on whether
      // the shortcut warning is on or not.
      if (shouldWarnForShortcut) {
        showCloseCurrentTabOption = true;
        titleId = "tabbrowser-confirm-close-warn-shortcut-title";
        quitButtonLabelId =
          "tabbrowser-confirm-close-windows-warn-shortcut-button";
      } else {
        titleId = {
          id: "tabbrowser-confirm-close-windows-title",
          args: { windowCount: windowcount },
        };
        quitButtonLabelId = "tabbrowser-confirm-close-windows-button";
      }
    } else if (shouldWarnForShortcut) {
      if (win.gBrowser.visibleTabs.length > 1) {
        showCloseCurrentTabOption = true;
        titleId = "tabbrowser-confirm-close-warn-shortcut-title";
        quitButtonLabelId = "tabbrowser-confirm-close-tabs-with-key-button";
      } else {
        titleId = "tabbrowser-confirm-close-tabs-with-key-title";
        quitButtonLabelId = "tabbrowser-confirm-close-tabs-with-key-button";
      }
    }

    // The checkbox label is different depending on whether the shortcut
    // was used to quit or not.
    let checkboxLabelId;
    if (shouldWarnForShortcut) {
      const quitKeyElement = win.document.getElementById("key_quitApplication");
      const quitKey = lazy.ShortcutUtils.prettifyShortcut(quitKeyElement);
      checkboxLabelId = {
        id: "tabbrowser-ask-close-tabs-with-key-checkbox",
        args: { quitKey },
      };
    } else {
      checkboxLabelId = "tabbrowser-ask-close-tabs-checkbox";
    }

    const [title, quitButtonLabel, checkboxLabel] =
      win.gBrowser.tabLocalization.formatMessagesSync([
        titleId,
        quitButtonLabelId,
        checkboxLabelId,
      ]);

    // Only format the "close current tab" message if needed
    let closeTabButtonLabel;
    if (showCloseCurrentTabOption) {
      [closeTabButtonLabel] = win.gBrowser.tabLocalization.formatMessagesSync([
        closeTabButtonLabelId,
      ]);
    }

    let warnOnClose = { value: true };

    let flags;
    if (showCloseCurrentTabOption) {
      // Adds buttons for quit (BUTTON_POS_0), cancel (BUTTON_POS_1), and close current tab (BUTTON_POS_2).
      // Also sets a flag to reorder dialog buttons so that cancel is reordered on Unix platforms.
      flags =
        (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
          Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1 +
          Services.prompt.BUTTON_TITLE_IS_STRING *
            Services.prompt.BUTTON_POS_2) |
        Services.prompt.BUTTON_POS_1_IS_SECONDARY;
      Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1;
    } else {
      // Adds quit and cancel buttons
      flags =
        Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
        Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1;
    }

    // buttonPressed will be 0 for close all, 1 for cancel (don't close/quit), 2 for close current tab
    let buttonPressed = Services.prompt.confirmEx(
      win,
      title.value,
      null,
      flags,
      quitButtonLabel.value,
      null,
      showCloseCurrentTabOption ? closeTabButtonLabel.value : null,
      checkboxLabel.value,
      warnOnClose
    );

    // If the user has unticked the box, and has confirmed closing, stop showing
    // the warning.
    if (buttonPressed == 0 && !warnOnClose.value) {
      if (shouldWarnForShortcut) {
        Services.prefs.setBoolPref("browser.warnOnQuitShortcut", false);
      } else {
        Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
      }
    }

    // Close the current tab if user selected BUTTON_POS_2
    if (buttonPressed === 2) {
      win.gBrowser.removeTab(win.gBrowser.selectedTab);
    }

    this._quitSource = "unknown";

    aCancelQuit.data = buttonPressed != 0;
  },

  _migrateUI() {
    // Use an increasing number to keep track of the current state of the user's
    // profile, so we can move data around as needed as the browser evolves.
    // Completely unrelated to the current Firefox release number.
    const APP_DATA_VERSION = 155;
    const PREF = "browser.migration.version";

    let profileDataVersion = Services.prefs.getIntPref(PREF, -1);
    this._isNewProfile = profileDataVersion == -1;

    if (this._isNewProfile) {
      // This is a new profile, nothing to upgrade.
      Services.prefs.setIntPref(PREF, APP_DATA_VERSION);
    } else if (profileDataVersion < APP_DATA_VERSION) {
      lazy.ProfileDataUpgrader.upgrade(profileDataVersion, APP_DATA_VERSION);
    }
  },

  _migrateUIBB() {
    // Version 1: 13.0a3. Reset layout.css.prefers-color-scheme.content-override
    //            for tor-browser#41739.
    // Version 2: 14.0a5: Reset the privacy tracking headers preferences since
    //            the UI is hidden. tor-browser#42777.
    //            Also, do not set
    //            dom.security.https_only_mode_send_http_background_request in
    //            the security level anymore (tor-browser#42149).
    //            Also, reset security.xfocsp.errorReporting.automatic since we
    //            hid its neterror checkbox. tor-browser#42653.
    // Version 3: 14.0a7: Reset general.smoothScroll. tor-browser#42070.
    // Version 4: 15.0a2: Drop ML components. tor-browser#44045.
    const MIGRATION_VERSION = 4;
    const MIGRATION_PREF = "basebrowser.migration.version";
    if (this._isNewProfile) {
      // Do not migrate fresh profiles
      Services.prefs.setIntPref(MIGRATION_PREF, MIGRATION_VERSION);
      return;
    } else if (this._isNewProfile === undefined) {
      // If this happens, check if upstream updated their function and do not
      // set this member anymore!
      console.error("_migrateUIBB: this._isNewProfile is undefined.");
    }
    // We do not care whether this is a new or old profile, since in version 1
    // we just quickly clear a user preference, which should not do anything to
    // new profiles.
    // Shall we ever raise the version number and have a watershed, we can add
    // a check easily (any version > 0 will be an old profile).
    const currentVersion = Services.prefs.getIntPref(MIGRATION_PREF, 0);
    if (currentVersion < 1) {
      Services.prefs.clearUserPref(
        "layout.css.prefers-color-scheme.content-override"
      );
    }
    if (currentVersion < 2) {
      for (const prefName of [
        "privacy.globalprivacycontrol.enabled",
        "privacy.donottrackheader.enabled",
        // Telemetry preference for if the user changed the value.
        "privacy.globalprivacycontrol.was_ever_enabled",
        // The next two preferences have no corresponding UI, but are related.
        "privacy.globalprivacycontrol.functionality.enabled",
        "privacy.globalprivacycontrol.pbmode.enabled",
        "dom.security.https_only_mode_send_http_background_request",
        "security.xfocsp.errorReporting.automatic",
      ]) {
        Services.prefs.clearUserPref(prefName);
      }
    }
    if (currentVersion < 3) {
      Services.prefs.clearUserPref("general.smoothScroll");
    }
    if (currentVersion < 4) {
      for (const prefName of [
        "browser.translations.enable",
        "browser.ml.enable",
        "browser.ml.chat.enabled",
        "browser.ml.linkPreview.enabled",
        "browser.tabs.groups.smart.enabled",
        "browser.tabs.groups.smart.userEnabled",
        "extensions.ml.enabled",
        "pdfjs.enableAltText",
        "pdfjs.enableAltTextForEnglish",
        "pdfjs.enableGuessAltText",
        "pdfjs.enableAltTextModelDownload",
        "browser.urlbar.quicksuggest.mlEnabled",
        "places.semanticHistory.featureGate",
      ]) {
        // Preferences are locked. Do not want user values to linger in the
        // user's profile and become active if these preferences become unlocked
        // in the future.
        Services.prefs.clearUserPref(prefName);
      }
    }
    Services.prefs.setIntPref(MIGRATION_PREF, MIGRATION_VERSION);
  },

  // Use this method for any MB migration that can be run just before showing
  // the UI.
  // Anything that critically needs to be migrated earlier should not use this.
  async _migrateUIMB() {
    // Version 1: Mullvad Browser 14.5a6: Clear home page update url preference
    //            (mullvad-browser#411).
    // Version 2: Mullvad Browser 15.0a2: Remove legacy search addons
    //            (tor-browser#43111).
    const MB_MIGRATION_VERSION = 2;
    const MIGRATION_PREF = "mullvadbrowser.migration.version";

    // If we decide to force updating users to pass through any version
    // following 14.5, we can remove this check, and check only whether
    // MIGRATION_PREF has a user value, like Mozilla does.
    if (this._isNewProfile) {
      // Do not migrate fresh profiles
      Services.prefs.setIntPref(MIGRATION_PREF, MB_MIGRATION_VERSION);
      return;
    } else if (this._isNewProfile === undefined) {
      // If this happens, check if upstream updated their function and do not
      // set this member anymore!
      console.error("_migrateUIMB: this._isNewProfile is undefined.");
    }

    const currentVersion = Services.prefs.getIntPref(MIGRATION_PREF, 0);

    if (currentVersion < 1) {
      Services.prefs.clearUserPref("mullvadbrowser.post_update.url");
    }
    const dropAddons = async list => {
      for (const id of list) {
        try {
          const engine = await lazy.AddonManager.getAddonByID(id);
          await engine?.uninstall();
        } catch {}
      }
    };
    if (currentVersion < 2) {
      await dropAddons([
        "brave@search.mozilla.org",
        "ddg@search.mozilla.org",
        "ddg-html@search.mozilla.org",
        "metager@search.mozilla.org",
        "mojeek@search.mozilla.org",
        "mullvad-leta@search.mozilla.org",
        "startpage@search.mozilla.org",
      ]);
    }

    Services.prefs.setIntPref(MIGRATION_PREF, MB_MIGRATION_VERSION);
  },

  async _showUpgradeDialog() {
    const data = await lazy.OnboardingMessageProvider.getUpgradeMessage();
    const { gBrowser } = lazy.BrowserWindowTracker.getTopWindow();

    // We'll be adding a new tab open the tab-modal dialog in.
    let tab;

    const upgradeTabsProgressListener = {
      onLocationChange(aBrowser) {
        if (aBrowser === tab.linkedBrowser) {
          lazy.setTimeout(() => {
            // We're now far enough along in the load that we no longer have to
            // worry about a call to onLocationChange triggering SubDialog.abort,
            // so display the dialog
            const config = {
              type: "SHOW_SPOTLIGHT",
              data,
            };
            lazy.SpecialMessageActions.handleAction(config, tab.linkedBrowser);

            gBrowser.removeTabsProgressListener(upgradeTabsProgressListener);
          }, 0);
        }
      },
    };

    // Make sure we're ready to show the dialog once onLocationChange gets
    // called.
    gBrowser.addTabsProgressListener(upgradeTabsProgressListener);

    tab = gBrowser.addTrustedTab("about:home", {
      relatedToCurrent: true,
    });

    gBrowser.selectedTab = tab;
  },

  async _showSetToDefaultSpotlight(message, browser) {
    const config = {
      type: "SHOW_SPOTLIGHT",
      data: message,
    };

    try {
      lazy.SpecialMessageActions.handleAction(config, browser);
    } catch (e) {
      console.error("Couldn't render spotlight", message, e);
    }
  },

  async _maybeShowDefaultBrowserPrompt() {
    // Ensuring the user is notified arranges the following ordering.  Highest
    // priority is datareporting policy modal, if present.  Second highest
    // priority is the upgrade dialog, which can include a "primary browser"
    // request and is limited in various ways, e.g., major upgrades.
    await lazy.TelemetryReportingPolicy.ensureUserIsNotified();

    const dialogVersion = 106;
    const dialogVersionPref = "browser.startup.upgradeDialog.version";
    const dialogReason = await (async () => {
      if (!lazy.BrowserHandler.majorUpgrade) {
        return "not-major";
      }
      const lastVersion = Services.prefs.getIntPref(dialogVersionPref, 0);
      if (lastVersion > dialogVersion) {
        return "newer-shown";
      }
      if (lastVersion === dialogVersion) {
        return "already-shown";
      }

      // Check the default branch as enterprise policies can set prefs there.
      const defaultPrefs = Services.prefs.getDefaultBranch("");
      if (!defaultPrefs.getBoolPref("browser.aboutwelcome.enabled", true)) {
        return "no-welcome";
      }
      if (!Services.policies.isAllowed("postUpdateCustomPage")) {
        return "disallow-postUpdate";
      }

      const showUpgradeDialog =
        lazy.NimbusFeatures.upgradeDialog.getVariable("enabled");

      return showUpgradeDialog ? "" : "disabled";
    })();

    // Record why the dialog is showing or not.
    Glean.upgradeDialog.triggerReason.record({
      value: dialogReason || "satisfied",
    });

    // Show the upgrade dialog if allowed and remember the version.
    if (!dialogReason) {
      Services.prefs.setIntPref(dialogVersionPref, dialogVersion);
      this._showUpgradeDialog();
      return;
    }

    const willPrompt = await lazy.DefaultBrowserCheck.willCheckDefaultBrowser(
      /* isStartupCheck */ true
    );
    if (willPrompt) {
      let win = lazy.BrowserWindowTracker.getTopWindow();
      let setToDefaultFeature = lazy.NimbusFeatures.setToDefaultPrompt;

      // Send exposure telemetry if user will see default prompt or experimental
      // message
      await setToDefaultFeature.ready();
      await setToDefaultFeature.recordExposureEvent();

      const { showSpotlightPrompt, message } =
        setToDefaultFeature.getAllVariables();

      if (showSpotlightPrompt && message) {
        // Show experimental message
        this._showSetToDefaultSpotlight(message, win.gBrowser.selectedBrowser);
        return;
      }
      lazy.DefaultBrowserCheck.prompt(win);
    }

    await lazy.ASRouter.waitForInitialized;
    lazy.ASRouter.sendTriggerMessage({
      browser:
        lazy.BrowserWindowTracker.getTopWindow()?.gBrowser.selectedBrowser,
      // triggerId and triggerContext
      id: "defaultBrowserCheck",
      context: { willShowDefaultPrompt: willPrompt, source: "startup" },
    });
  },

  /**
   * Only show the infobar when canRestoreLastSession and the pref value == 1
   */
  async _maybeShowRestoreSessionInfoBar() {
    let count = Services.prefs.getIntPref(
      "browser.startup.couldRestoreSession.count",
      0
    );
    if (count < 0 || count >= 2) {
      return;
    }
    if (count == 0) {
      // We don't show the infobar right after the update which establishes this pref
      // Increment the counter so we can consider it next time
      Services.prefs.setIntPref(
        "browser.startup.couldRestoreSession.count",
        ++count
      );
      return;
    }

    const win = lazy.BrowserWindowTracker.getTopWindow();
    // We've restarted at least once; we will show the notification if possible.
    // We can't do that if there's no session to restore, or this is a private window.
    if (
      !lazy.SessionStore.canRestoreLastSession ||
      lazy.PrivateBrowsingUtils.isWindowPrivate(win)
    ) {
      return;
    }

    Services.prefs.setIntPref(
      "browser.startup.couldRestoreSession.count",
      ++count
    );

    const messageFragment = win.document.createDocumentFragment();
    const message = win.document.createElement("span");
    const icon = win.document.createElement("img");
    icon.src = "chrome://browser/skin/menu.svg";
    icon.setAttribute("data-l10n-name", "icon");
    icon.className = "inline-icon";
    message.appendChild(icon);
    messageFragment.appendChild(message);
    win.document.l10n.setAttributes(
      message,
      "restore-session-startup-suggestion-message"
    );

    const buttons = [
      {
        "l10n-id": "restore-session-startup-suggestion-button",
        primary: true,
        callback: () => {
          win.PanelUI.selectAndMarkItem([
            "appMenu-history-button",
            "appMenu-restoreSession",
          ]);
        },
      },
    ];

    const notifyBox = win.gBrowser.getNotificationBox();
    const notification = await notifyBox.appendNotification(
      "startup-restore-session-suggestion",
      {
        label: messageFragment,
        priority: notifyBox.PRIORITY_INFO_MEDIUM,
      },
      buttons
    );
    // Don't allow it to be immediately hidden:
    notification.timeout = Date.now() + 3000;
  },

  /**
   * Open preferences even if there are no open windows.
   */
  _openPreferences(...args) {
    let chromeWindow = lazy.BrowserWindowTracker.getTopWindow();
    if (chromeWindow) {
      chromeWindow.openPreferences(...args);
      return;
    }

    if (AppConstants.platform == "macosx") {
      Services.appShell.hiddenDOMWindow.openPreferences(...args);
    }
  },

  QueryInterface: ChromeUtils.generateQI([
    "nsIObserver",
    "nsISupportsWeakReference",
  ]),
};
