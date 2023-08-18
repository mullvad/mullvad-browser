/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DelayedInit } from "resource://gre/modules/DelayedInit.sys.mjs";
import { GeckoViewUtils } from "resource://gre/modules/GeckoViewUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ActorManagerParent: "resource://gre/modules/ActorManagerParent.sys.mjs",
  DoHController: "moz-src:///toolkit/components/doh/DoHController.sys.mjs",
  EventDispatcher: "resource://gre/modules/Messaging.sys.mjs",
  NimbusGeckoViewQATelemetry:
    "resource://gre/modules/NimbusGeckoViewQATelemetry.sys.mjs",
  PdfJs: "resource://pdf.js/PdfJs.sys.mjs",
  GeckoViewPreferences: "resource://gre/modules/GeckoViewPreferences.sys.mjs",
  RFPHelper: "resource://gre/modules/RFPHelper.sys.mjs",
});

const { debug, warn } = GeckoViewUtils.initLogging("Startup");

function InitLater(fn, object, name) {
  return DelayedInit.schedule(fn, object, name, 15000 /* 15s max wait */);
}

const JSPROCESSACTORS = {
  GeckoViewPermissionProcess: {
    parent: {
      esModuleURI:
        "resource:///actors/GeckoViewPermissionProcessParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/GeckoViewPermissionProcessChild.sys.mjs",
      observers: [
        "getUserMedia:ask-device-permission",
        "getUserMedia:request",
        "recording-device-events",
        "PeerConnection:request",
      ],
    },
  },
  GeckoViewPush: {
    parent: {
      esModuleURI: "resource:///actors/GeckoViewPushParent.sys.mjs",
    },
    includeParent: true,
  },
};

const JSWINDOWACTORS = {
  LoadURIDelegate: {
    parent: {
      esModuleURI: "resource:///actors/LoadURIDelegateParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/LoadURIDelegateChild.sys.mjs",
    },
    messageManagerGroups: ["browsers"],
  },
  GeckoViewPermission: {
    parent: {
      esModuleURI: "resource:///actors/GeckoViewPermissionParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/GeckoViewPermissionChild.sys.mjs",
    },
    allFrames: true,
    includeChrome: true,
  },
  GeckoViewPrompt: {
    parent: {
      esModuleURI: "resource:///actors/GeckoViewPromptParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource:///actors/GeckoViewPromptChild.sys.mjs",
      events: {
        click: { capture: false, mozSystemGroup: true },
        mozshowdropdown: {},
        "mozshowdropdown-sourcetouch": {},
        MozOpenDateTimePicker: {},
        DOMPopupBlocked: { capture: false, mozSystemGroup: true },
        DOMRedirectBlocked: { capture: false, mozSystemGroup: true },
      },
    },
    allFrames: true,
    messageManagerGroups: ["browsers"],
  },
  GeckoViewFormValidation: {
    child: {
      esModuleURI: "resource:///actors/GeckoViewFormValidationChild.sys.mjs",
      events: {
        MozInvalidForm: {},
      },
    },
    allFrames: true,
    messageManagerGroups: ["browsers"],
  },
  GeckoViewPdfjs: {
    parent: {
      esModuleURI: "resource://pdf.js/GeckoViewPdfjsParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource://pdf.js/GeckoViewPdfjsChild.sys.mjs",
    },
    allFrames: true,
  },
};

export class GeckoViewStartup {
  /* ----------  nsIObserver  ---------- */
  observe(aSubject, aTopic) {
    debug`observe: ${aTopic}`;
    switch (aTopic) {
      case "content-process-ready-for-script":
      case "app-startup": {
        GeckoViewUtils.addLazyGetter(this, "GeckoViewConsole", {
          module: "resource://gre/modules/GeckoViewConsole.sys.mjs",
        });

        GeckoViewUtils.addLazyGetter(this, "GeckoViewStorageController", {
          module: "resource://gre/modules/GeckoViewStorageController.sys.mjs",
          ged: [
            "GeckoView:ClearData",
            "GeckoView:ClearSessionContextData",
            "GeckoView:ClearHostData",
            "GeckoView:ClearBaseDomainData",
            "GeckoView:GetAllPermissions",
            "GeckoView:GetPermissionsByURI",
            "GeckoView:SetPermission",
            "GeckoView:SetPermissionByURI",
            "GeckoView:GetCookieBannerModeForDomain",
            "GeckoView:SetCookieBannerModeForDomain",
            "GeckoView:RemoveCookieBannerModeForDomain",
          ],
        });

        GeckoViewUtils.addLazyGetter(this, "GeckoViewTrackingDB", {
          module: "resource://gre/modules/GeckoViewTrackingDB.sys.mjs",
          ged: [
            "GeckoView:TrackingDB:GetEventsByDateRange",
            "GeckoView:TrackingDB:SumAllEvents",
            "GeckoView:TrackingDB:GetEarliestRecordedDate",
            "GeckoView:TrackingDB:ClearAll",
          ],
        });

        GeckoViewUtils.addLazyGetter(this, "GeckoViewPushController", {
          module: "resource://gre/modules/GeckoViewPushController.sys.mjs",
          ged: ["GeckoView:PushEvent", "GeckoView:PushSubscriptionChanged"],
        });

        GeckoViewUtils.addLazyPrefObserver(
          {
            name: "geckoview.console.enabled",
            default: false,
          },
          {
            handler: _ => this.GeckoViewConsole,
          }
        );

        // Parent process only
        if (
          Services.appinfo.processType == Services.appinfo.PROCESS_TYPE_DEFAULT
        ) {
          lazy.ActorManagerParent.addJSWindowActors(JSWINDOWACTORS);
          lazy.ActorManagerParent.addJSProcessActors(JSPROCESSACTORS);

          GeckoViewUtils.addLazyGetter(this, "GeckoViewSessionStore", {
            module: "resource://gre/modules/GeckoViewSessionStore.sys.mjs",
            observers: [
              "browsing-context-did-set-embedder",
              "browsing-context-discarded",
            ],
          });

          GeckoViewUtils.addLazyGetter(this, "GeckoViewWebExtension", {
            module: "resource://gre/modules/GeckoViewWebExtension.sys.mjs",
            ged: [
              "GeckoView:ActionDelegate:Attached",
              "GeckoView:BrowserAction:Click",
              "GeckoView:PageAction:Click",
              "GeckoView:RegisterWebExtension",
              "GeckoView:UnregisterWebExtension",
              "GeckoView:WebExtension:CancelInstall",
              "GeckoView:WebExtension:Disable",
              "GeckoView:WebExtension:Enable",
              "GeckoView:WebExtension:EnsureBuiltIn",
              "GeckoView:WebExtension:Get",
              "GeckoView:WebExtension:Install",
              "GeckoView:WebExtension:InstallBuiltIn",
              "GeckoView:WebExtension:List",
              "GeckoView:WebExtension:PortDisconnect",
              "GeckoView:WebExtension:PortMessageFromApp",
              "GeckoView:WebExtension:SetPBAllowed",
              "GeckoView:WebExtension:AddOptionalPermissions",
              "GeckoView:WebExtension:RemoveOptionalPermissions",
              "GeckoView:WebExtension:Uninstall",
              "GeckoView:WebExtension:Update",
              "GeckoView:WebExtension:EnableProcessSpawning",
              "GeckoView:WebExtension:DisableProcessSpawning",
            ],
            observers: [
              "devtools-installed-addon",
              "testing-installed-addon",
              "testing-uninstalled-addon",
            ],
          });

          GeckoViewUtils.addLazyGetter(this, "GeckoViewIPProtection", {
            module: "resource://gre/modules/GeckoViewIPProtection.sys.mjs",
            ged: [
              "GeckoView:IPProtection:Init",
              "GeckoView:IPProtection:Uninit",
              "GeckoView:IPProtection:IPProtectionService:GetState",
              "GeckoView:IPProtection:IPPProxyManager:GetState",
              "GeckoView:IPProtection:Activate",
              "GeckoView:IPProtection:Deactivate",
              "GeckoView:IPProtection:Enroll",
            ],
          });

          GeckoViewUtils.addLazyGetter(this, "ChildCrashHandler", {
            module: "resource://gre/modules/ChildCrashHandler.sys.mjs",
            observers: [
              "compositor:process-aborted",
              "ipc:content-created",
              "ipc:content-shutdown",
              "process-type-set",
            ],
          });

          lazy.EventDispatcher.instance.registerListener(this, [
            "GeckoView:StorageDelegate:Attached",
            "GeckoView:CrashPullController.Delegate:Attached",
          ]);
        }

        GeckoViewUtils.addLazyGetter(this, "GeckoViewAIFeatures", {
          module: "resource://gre/modules/GeckoViewAIFeatures.sys.mjs",
          ged: [
            "GeckoView:AIFeature:ListFeatures",
            "GeckoView:AIFeature:SetEnabled",
            "GeckoView:AIFeature:MakeAvailable",
          ],
        });

        GeckoViewUtils.addLazyGetter(this, "GeckoViewTranslationsSettings", {
          module: "resource://gre/modules/GeckoViewTranslations.sys.mjs",
          ged: [
            "GeckoView:Translations:IsTranslationEngineSupported",
            "GeckoView:Translations:PreferredLanguages",
            "GeckoView:Translations:ManageModel",
            "GeckoView:Translations:TranslationInformation",
            "GeckoView:Translations:ModelInformation",
            "GeckoView:Translations:GetLanguageSetting",
            "GeckoView:Translations:GetLanguageSettings",
            "GeckoView:Translations:SetLanguageSettings",
            "GeckoView:Translations:GetNeverTranslateSpecifiedSites",
            "GeckoView:Translations:SetNeverTranslateSpecifiedSite",
            "GeckoView:Translations:GetTranslateDownloadSize",
          ],
        });

        GeckoViewUtils.addLazyGetter(this, "GeckoViewPageExtractor", {
          module: "resource://gre/modules/GeckoViewPageExtractor.sys.mjs",
          ged: ["GeckoView:PageExtractor:GetTextContent"],
        });

        GeckoViewUtils.addLazyGetter(this, "GeckoViewAutofillRuntime", {
          module: "resource://gre/modules/GeckoViewAutofill.sys.mjs",
          ged: ["GeckoView:Autofill:GetAddressStructure"],
        });

        // We don't register this using the LazyGetter because it needs to be ready before
        // the first call to the listener is received.
        lazy.EventDispatcher.instance.registerListener(
          lazy.GeckoViewPreferences,
          [
            "GeckoView:Preferences:GetPref",
            "GeckoView:Preferences:SetPref",
            "GeckoView:Preferences:ClearPref",
            "GeckoView:Preferences:RegisterObserver",
            "GeckoView:Preferences:UnregisterObserver",
          ]
        );

        break;
      }

      case "profile-after-change": {
        GeckoViewUtils.addLazyGetter(this, "GeckoViewRemoteDebugger", {
          module: "resource://gre/modules/GeckoViewRemoteDebugger.sys.mjs",
          init: gvrd => gvrd.onInit(),
        });

        GeckoViewUtils.addLazyPrefObserver(
          {
            name: "devtools.debugger.remote-enabled",
            default: false,
          },
          {
            handler: _ => this.GeckoViewRemoteDebugger,
          }
        );

        // Initialize the cookie service early so the DB is loaded by
        // the time we make the first HTTP request. Skip in xpcshell tests,
        // which expect to control when (and against which DB file) the
        // cookie service first opens the database.
        if (!Services.env.exists("XPCSHELL_TEST_PROFILE_DIR")) {
          Services.cookies;
        }

        GeckoViewUtils.addLazyGetter(this, "DownloadTracker", {
          module: "resource://gre/modules/GeckoViewWebExtension.sys.mjs",
          ged: ["GeckoView:WebExtension:DownloadChanged"],
        });

        // Listen for global EventDispatcher messages
        lazy.EventDispatcher.instance.registerListener(this, [
          "GeckoView:ResetUserPrefs",
          "GeckoView:SetDefaultPrefs",
          "GeckoView:SetLocale",
          "GeckoView:InitialForeground",
        ]);

        this.#migratePreferences();

        Services.obs.addObserver(this, "browser-idle-startup-tasks-finished");
        Services.obs.addObserver(this, "handlersvc-store-initialized");

        lazy.NimbusGeckoViewQATelemetry.init();

        Services.obs.notifyObservers(null, "geckoview-startup-complete");
        break;
      }
      case "browser-idle-startup-tasks-finished": {
        // TODO bug 1730026: when an alternative is introduced that runs once,
        // replace this observer topic with that alternative.
        // This only needs to happen once during startup.
        Services.obs.removeObserver(this, aTopic);
        // Notify the start up crash tracker that the browser has successfully
        // started up so the startup cache isn't rebuilt on next startup.
        Services.startup.trackStartupCrashEnd();
        break;
      }
      case "handlersvc-store-initialized": {
        // Initialize PdfJs when running in-process and remote. This only
        // happens once since PdfJs registers global hooks. If the PdfJs
        // extension is installed the init method below will be overridden
        // leaving initialization to the extension.
        // parent only: configure default prefs, set up pref observers, register
        // pdf content handler, and initializes parent side message manager
        // shim for privileged api access.
        try {
          lazy.PdfJs.init(this._isNewProfile);
        } catch {}
        break;
      }
    }
  }

  onEvent(aEvent, aData) {
    debug`onEvent ${aEvent}`;

    switch (aEvent) {
      case "GeckoView:InitialForeground": {
        // ExtensionProcessCrashObserver observes this topic to determine when
        // the app goes into the foreground for the first time. This could be useful
        // when the app is initially created in the background because, in this case,
        // the "application-foreground" topic isn't notified when the application is
        // moved into the foreground later. That is because "application-foreground"
        // is only going to be notified when the application was first paused.
        Services.obs.notifyObservers(null, "geckoview-initial-foreground");

        // This pref is set when during GeckoEngine initialization
        // and holds the value of FxNimbus.doh.autoselect-enabled (see nimbus.fml.yaml)
        // We check it here insead of using GeckoViewUtils.addLazyPrefObserver
        // because GeckoView:ResetUserPrefs also clears it during startup.
        if (
          Services.prefs.getBoolPref("network.android_doh.autoselect_enabled")
        ) {
          debug`init DoH controller`;
          lazy.DoHController.init();
        } else {
          // When the autoselect isn't enabled, these prefs should be
          // cleared. Otherwise doh-rollout.mode will override
          // network.trr.mode forever as DoHController isn't running.
          debug`cleanup DoH prefs`;
          lazy.DoHController.cleanupPrefs();
        }

        break;
      }
      case "GeckoView:ResetUserPrefs": {
        for (const name of aData.names) {
          Services.prefs.clearUserPref(name);
        }
        break;
      }
      case "GeckoView:SetDefaultPrefs": {
        const prefs = Services.prefs.getDefaultBranch("");
        for (const [name, value] of Object.entries(aData)) {
          try {
            switch (typeof value) {
              case "string":
                prefs.setStringPref(name, value);
                break;
              case "number":
                prefs.setIntPref(name, value);
                break;
              case "boolean":
                prefs.setBoolPref(name, value);
                break;
              default:
                throw new Error(
                  `Can't set ${name} to ${value}. Type ${typeof value} is not supported.`
                );
            }
          } catch (e) {
            warn`Failed to set preference ${name}: ${e}`;
          }
        }
        break;
      }
      case "GeckoView:SetLocale": {
        if (aData.requestedLocales) {
          Services.locale.requestedLocales = aData.requestedLocales;
        }
        lazy.RFPHelper._handleSpoofEnglishChanged();
        if (Services.prefs.getIntPref("privacy.spoof_english", 0) === 2) {
          break;
        }
        const pls = Cc["@mozilla.org/pref-localizedstring;1"].createInstance(
          Ci.nsIPrefLocalizedString
        );
        pls.data = aData.acceptLanguages;
        Services.prefs.setComplexValue(
          "intl.accept_languages",
          Ci.nsIPrefLocalizedString,
          pls
        );
        break;
      }

      case "GeckoView:StorageDelegate:Attached":
        InitLater(() => {
          const loginDetection = Cc[
            "@mozilla.org/login-detection-service;1"
          ].createInstance(Ci.nsILoginDetectionService);
          loginDetection.init();
        });
        break;

      case "GeckoView:CrashPullController.Delegate:Attached":
        if (!this.RemoteSettingsCrashPull) {
          GeckoViewUtils.addLazyGetter(this, "RemoteSettingsCrashPull", {
            module: "resource://gre/modules/RemoteSettingsCrashPull.sys.mjs",
          });
          GeckoViewUtils.addLazyGetter(this, "crashPullCallback", {
            module: "resource://gre/modules/ChildCrashHandler.sys.mjs",
          });
          InitLater(() =>
            this.RemoteSettingsCrashPull.start(this.crashPullCallback)
          );
        }
        break;
    }
  }

  /**
   * This is the equivalent of BrowserGlue._migrateUITBB.
   */
  #migratePreferences() {
    const MIGRATION_VERSION = 1;
    const MIGRATION_PREF = "torbrowser.migration_android.version";

    // We do not have a way to check for new profiles on Android.
    // However, the first version is harmless for new installs, so run it
    // anyway.
    const currentVersion = Services.prefs.getIntPref(MIGRATION_PREF, 0);
    if (currentVersion < 1) {
      // First implementation of the migration on Android (tor-browser#43124,
      // 14.0a5, September 2024).
      const prefToClear = [
        // Old torbutton preferences not used anymore.
        // Some of them should have never been set on Android, as on Android we
        // force PBM... But who knows about very old profiles.
        "browser.cache.disk.enable",
        "places.history.enabled",
        "security.nocertdb",
        "permissions.memory_only",
        "extensions.torbutton.loglevel",
        "extensions.torbutton.logmethod",
        "extensions.torbutton.pref_fixup_version",
        "extensions.torbutton.resize_new_windows",
        "extensions.torbutton.startup",
        "extensions.torlauncher.prompt_for_locale",
        "extensions.torlauncher.loglevel",
        "extensions.torlauncher.logmethod",
        "extensions.torlauncher.torrc_fixup_version",
        // tor-browser#42149: Do not change HTTPS-Only settings in the security
        // level.
        "dom.security.https_only_mode_send_http_background_request",
      ];
      for (const pref of prefToClear) {
        if (Services.prefs.prefHasUserValue(pref)) {
          Services.prefs.clearUserPref(pref);
        }
      }
    }
    Services.prefs.setIntPref(MIGRATION_PREF, MIGRATION_VERSION);
  }
}

GeckoViewStartup.prototype.classID = Components.ID(
  "{8e993c34-fdd6-432c-967e-f995d888777f}"
);
GeckoViewStartup.prototype.QueryInterface = ChromeUtils.generateQI([
  "nsIObserver",
]);
