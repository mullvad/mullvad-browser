const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
});

const logger = console.createInstance({
  maxLogLevel: "Info",
  prefix: "SecurityLevel",
});

const BrowserTopics = Object.freeze({
  ProfileAfterChange: "profile-after-change",
});

// The Security Settings prefs in question.
const kSliderPref = "browser.security_level.security_slider";
const kCustomPref = "browser.security_level.security_custom";
const kNoScriptInitedPref = "browser.security_level.noscript_inited";

// __getPrefValue(prefName)__
// Returns the current value of a preference, regardless of its type.
var getPrefValue = function (prefName) {
  switch (Services.prefs.getPrefType(prefName)) {
    case Services.prefs.PREF_BOOL:
      return Services.prefs.getBoolPref(prefName);
    case Services.prefs.PREF_INT:
      return Services.prefs.getIntPref(prefName);
    case Services.prefs.PREF_STRING:
      return Services.prefs.getCharPref(prefName);
    default:
      return null;
  }
};

// __bindPref(prefName, prefHandler)__
// Applies prefHandler whenever the value of the pref changes.
// If init is true, applies prefHandler to the current value.
// Returns the observer that was added.
var bindPref = function (prefName, prefHandler) {
  let update = () => {
      prefHandler(getPrefValue(prefName));
    },
    observer = {
      observe(subject, topic, data) {
        if (data === prefName) {
          update();
        }
      },
    };
  Services.prefs.addObserver(prefName, observer);
  return observer;
};

async function waitForExtensionMessage(extensionId, checker = () => {}) {
  const { torWaitForExtensionMessage } = lazy.ExtensionParent;
  if (torWaitForExtensionMessage) {
    return torWaitForExtensionMessage(extensionId, checker);
  }
  return undefined;
}

async function sendExtensionMessage(extensionId, message) {
  const { torSendExtensionMessage } = lazy.ExtensionParent;
  if (torSendExtensionMessage) {
    return await torSendExtensionMessage(extensionId, message);
  }
  return undefined;
}

// ## NoScript settings

// Minimum and maximum capability states as controlled by NoScript.
const max_caps = [
  "fetch",
  "font",
  "frame",
  "media",
  "object",
  "other",
  "script",
  "webgl",
  "noscript",
];
const min_caps = ["frame", "other", "noscript"];

// Untrusted capabilities for [Standard, Safer, Safest] safety levels.
const untrusted_caps = [
  max_caps, // standard safety: neither http nor https
  ["frame", "font", "object", "other", "noscript"], // safer: http
  min_caps, // safest: neither http nor https
];

// Default capabilities for [Standard, Safer, Safest] safety levels.
const default_caps = [
  max_caps, // standard: both http and https
  ["fetch", "font", "frame", "object", "other", "script", "noscript"], // safer: https only
  min_caps, // safest: both http and https
];

// __noscriptSettings(safetyLevel)__.
// Produces NoScript settings with policy according to
// the safetyLevel which can be:
// 0 = Standard, 1 = Safer, 2 = Safest
//
// At the "Standard" safety level, we leave all sites at
// default with maximal capabilities. Essentially no content
// is blocked.
//
// At "Safer", we set all http sites to untrusted,
// and all https sites to default. Scripts are only permitted
// on https sites. Neither type of site is supposed to allow
// media, but both allow fonts (as we used in legacy NoScript).
//
// At "Safest", all sites are at default with minimal
// capabilities. Most things are blocked.
let noscriptSettings = safetyLevel => ({
  __meta: {
    name: "updateSettings",
    recipientInfo: null,
  },
  policy: {
    DEFAULT: {
      capabilities: default_caps[safetyLevel],
      temp: false,
    },
    TRUSTED: {
      capabilities: max_caps,
      temp: false,
    },
    UNTRUSTED: {
      capabilities: untrusted_caps[safetyLevel],
      temp: false,
    },
    sites: {
      trusted: [],
      untrusted: [[], ["http:"], []][safetyLevel],
      custom: {},
      temp: [],
    },
    enforced: true,
    autoAllowTop: false,
  },
  sync: {
    // Apply cross-tab identity leak protection to PBM windows
    TabGuardMode: "incognito",
    // Prompt only on problematic POST requests
    TabGuardPrompt: "post",
  },
  // host-specific metadata
  settingsHost: {
    // help NoScript cooperate by versioning these settings
    id: "mullvad",
    version: 2,
  },
  isTorBrowser: true,
  tabId: -1,
});

// ## Communications

// The extension ID for NoScript (WebExtension)
const noscriptID = "{73a6fe31-595d-460b-a920-fcc0f8843232}";

// Ensure binding only occurs once.
let initialized = false;

// __initialize()__.
// The main function that binds the NoScript settings to the security
// slider pref state.
var initializeNoScriptControl = () => {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    // LegacyExtensionContext is not there anymore. Using raw
    // Services.cpmm.sendAsyncMessage mechanism to communicate with
    // NoScript.

    // The component that handles WebExtensions' sendMessage.

    // __setNoScriptSettings(settings)__.
    // NoScript listens for internal settings with onMessage. We can send
    // a new settings JSON object according to NoScript's
    // protocol and these are accepted! See the use of
    // `browser.runtime.onMessage.addListener(...)` in NoScript's bg/main.js.

    // TODO: Is there a better way?
    let sendNoScriptSettings = async settings =>
      await sendExtensionMessage(noscriptID, settings);

    // __securitySliderToSafetyLevel(sliderState)__.
    // Converts the "browser.security_level.security_slider" pref value
    // to a "safety level" value: 0 = Standard, 1 = Safer, 2 = Safest
    let securitySliderToSafetyLevel = sliderState =>
      [undefined, 2, 1, 1, 0][sliderState];

    // Wait for the first message from NoScript to arrive, and then
    // bind the security_slider pref to the NoScript settings.
    let messageListener = async a => {
      try {
        logger.debug("Message received from NoScript:", a);
        const persistPref = "browser.security_level.noscript_persist";
        let noscriptPersist = Services.prefs.getBoolPref(persistPref, false);
        let noscriptInited = Services.prefs.getBoolPref(
          kNoScriptInitedPref,
          false
        );
        // Set the noscript safety level once at startup.
        // If a user has set noscriptPersist, then we only send this if the
        // security level was changed in a previous session.
        // NOTE: We do not re-send this when the security_slider preference
        // changes mid-session because this should always require a restart.
        if (noscriptPersist && noscriptInited) {
          logger.warn(
            `Not initialising NoScript since the user has set ${persistPref}`
          );
          return;
        }
        // Read the security level, even if the user has the "custom"
        // preference.
        const securityIndex = Services.prefs.getIntPref(kSliderPref, 0);
        const safetyLevel = securitySliderToSafetyLevel(securityIndex);
        // May throw if NoScript fails to apply the settings:
        const noscriptResult = await sendNoScriptSettings(
          noscriptSettings(safetyLevel)
        );
        // Mark the NoScript extension as initialised so we do not reset it
        // at the next startup for noscript_persist users.
        Services.prefs.setBoolPref(kNoScriptInitedPref, true);
        logger.info("NoScript successfully initialised.");
        // In the future NoScript may tell us more about how it applied our
        // settings, e.g. if user is overriding per-site permissions.
        // Up to NoScript 12.6 noscriptResult is undefined.
        logger.debug("NoScript response:", noscriptResult);
      } catch (e) {
        logger.error("Could not apply NoScript settings", e);
        // Treat as a custom security level for the rest of the session.
        Services.prefs.setBoolPref(kCustomPref, true);
      }
    };
    waitForExtensionMessage(noscriptID, a => a.__meta.name === "started").then(
      messageListener
    );
    logger.info("Listening for messages from NoScript.");
  } catch (e) {
    logger.exception(e);
    // Treat as a custom security level for the rest of the session.
    Services.prefs.setBoolPref(kCustomPref, true);
  }
};

// ### Constants

// __kSecuritySettings__.
// A table of all prefs bound to the security slider, and the value
// for each security setting. Note that 2-m and 3-m are identical,
// corresponding to the old 2-medium-high setting. We also separately
// bind NoScript settings to the browser.security_level.security_slider
// (see noscript-control.js).
/* eslint-disable */
// prettier-ignore
const kSecuritySettings = {
  // Preference name:                        [0, 1-high 2-m    3-m    4-low]
  "javascript.options.ion":                  [,  false, false, false, true ],
  "javascript.options.baselinejit":          [,  false, false, false, true ],
  "javascript.options.native_regexp":        [,  false, false, false, true ],
  "mathml.disabled":                         [,  true,  true,  true,  false],
  "gfx.font_rendering.graphite.enabled":     [,  false, false, false, true ],
  "gfx.font_rendering.opentype_svg.enabled": [,  false, false, false, true ],
  "svg.disabled":                            [,  true,  false, false, false],
  "javascript.options.asmjs":                [,  false, false, false, true ],
  "javascript.options.wasm":                 [,  false, false, false, true ],
};
/* eslint-enable */

// ### Prefs

/**
 * Amend the security level index to a standard value.
 *
 * @param {integer} index - The input index value.
 * @returns {integer} - A standard index value.
 */
function fixupIndex(index) {
  if (!Number.isInteger(index) || index < 1 || index > 4) {
    // Unexpected value out of range, go to the "safest" level as a fallback.
    return 1;
  }
  if (index === 3) {
    // Migrate from old medium-low (3) to new medium (2).
    return 2;
  }
  return index;
}

/**
 * A list of preference observers that should be disabled whilst we write our
 * preference values.
 *
 * @type {{ prefName: string, observer: object }[]}
 */
const prefObservers = [];

// __write_setting_to_prefs(settingIndex)__.
// Take a given setting index and write the appropriate pref values
// to the pref database.
var write_setting_to_prefs = function (settingIndex) {
  settingIndex = fixupIndex(settingIndex);
  // Don't want to trigger our internal observers when setting ourselves.
  for (const { prefName, observer } of prefObservers) {
    Services.prefs.removeObserver(prefName, observer);
  }
  try {
    // Make sure noscript is re-initialised at the next startup when the
    // security level changes.
    Services.prefs.setBoolPref(kNoScriptInitedPref, false);
    Services.prefs.setIntPref(kSliderPref, settingIndex);
    // NOTE: We do not clear kCustomPref. Instead, we rely on the preference
    // being cleared on the next startup.
    Object.keys(kSecuritySettings).forEach(prefName =>
      Services.prefs.setBoolPref(
        prefName,
        kSecuritySettings[prefName][settingIndex]
      )
    );
  } finally {
    // Re-add the observers.
    for (const { prefName, observer } of prefObservers) {
      Services.prefs.addObserver(prefName, observer);
    }
  }
};

// __read_setting_from_prefs()__.
// Read the current pref values, and decide if any of our
// security settings matches. Otherwise return null.
var read_setting_from_prefs = function (prefNames) {
  prefNames = prefNames || Object.keys(kSecuritySettings);
  for (let settingIndex of [1, 2, 3, 4]) {
    let possibleSetting = true;
    // For the given settingIndex, check if all current pref values
    // match the setting.
    for (let prefName of prefNames) {
      if (
        kSecuritySettings[prefName][settingIndex] !==
        Services.prefs.getBoolPref(prefName)
      ) {
        possibleSetting = false;
      }
    }
    if (possibleSetting) {
      // We have a match!
      return settingIndex;
    }
  }
  // No matching setting; return null.
  return null;
};

// __initialized__.
// Have we called initialize() yet?
var initializedSecPrefs = false;

// __initialize()__.
// Defines the behavior of "browser.security_level.security_custom",
// "browser.security_level.security_slider", and the security-sensitive
// prefs declared in kSecuritySettings.
var initializeSecurityPrefs = function () {
  // Only run once.
  if (initializedSecPrefs) {
    return;
  }
  logger.info("Initializing security-prefs.js");
  initializedSecPrefs = true;

  const wasCustom = Services.prefs.getBoolPref(kCustomPref, false);
  // For new profiles with no user preference, the security level should be "4"
  // and it should not be custom.
  let desiredIndex = Services.prefs.getIntPref(kSliderPref, 4);
  desiredIndex = fixupIndex(desiredIndex);
  // Make sure the user has a set preference user value.
  Services.prefs.setIntPref(kSliderPref, desiredIndex);
  Services.prefs.setBoolPref(kCustomPref, wasCustom);

  // Make sure that the preference values at application startup match the
  // expected values for the desired security level. See tor-browser#43783.

  // NOTE: We assume that the controlled preference values that are read prior
  // to profile-after-change do not change in value before this method is
  // called. I.e. we expect the current preference values to match the
  // preference values that were used during the application initialisation.
  const effectiveIndex = read_setting_from_prefs();

  if (wasCustom && effectiveIndex !== null) {
    logger.info(`Custom startup values match index ${effectiveIndex}`);
    // Do not consider custom any more.
    // NOTE: This level needs to be set before it is read elsewhere. In
    // particular, for the NoScript addon.
    Services.prefs.setBoolPref(kCustomPref, false);
    Services.prefs.setIntPref(kSliderPref, effectiveIndex);
  } else if (!wasCustom && effectiveIndex !== desiredIndex) {
    // NOTE: We assume all our controlled preferences require a restart.
    // In practice, only a subset of these preferences may actually require a
    // restart, so we could switch their values. But we treat them all the same
    // for simplicity, consistency and stability in case mozilla changes the
    // restart requirements.
    logger.info(`Startup values do not match for index ${desiredIndex}`);
    SecurityLevelPrefs.requireRestart();
  }

  // Start listening for external changes to the controlled preferences.
  prefObservers.push({
    prefName: kCustomPref,
    observer: bindPref(kCustomPref, custom => {
      // Custom flag was removed mid-session. Requires a restart to apply the
      // security level.
      if (custom === false) {
        logger.info("Custom flag was cleared externally");
        SecurityLevelPrefs.requireRestart();
      }
    }),
  });
  prefObservers.push({
    prefName: kSliderPref,
    observer: bindPref(kSliderPref, () => {
      // Security level was changed mid-session. Requires a restart to apply.
      logger.info("Security level was changed externally");
      SecurityLevelPrefs.requireRestart();
    }),
  });

  for (const prefName of Object.keys(kSecuritySettings)) {
    prefObservers.push({
      prefName,
      observer: bindPref(prefName, () => {
        logger.warn(
          `The controlled preference ${prefName} was changed externally.` +
            " Treating as a custom security level."
        );
        // Something outside of this module changed the preference value for a
        // preference we control.
        // Always treat as a custom security level for the rest of this session,
        // even if the new preference values match a pre-set security level. We
        // do this because some controlled preferences require a restart to be
        // properly applied. See tor-browser#43783.
        // In the case where it does match a pre-set security level, the custom
        // flag will be cleared at the next startup.
        Services.prefs.setBoolPref(kCustomPref, true);
      }),
    });
  }

  logger.info("security-prefs.js initialization complete");
};

// tor-browser#41460: we changed preference names in 12.0.
// 11.5.8 is an obligated step for desktop users, so this code is helpful only
// to alpha users, and we could remove it quite soon.
function migratePreferences() {
  const kPrefCheck = "extensions.torbutton.noscript_inited";
  // For 12.0, check for extensions.torbutton.noscript_inited, which was set
  // as a user preference for sure, if someone used security level in previous
  // versions.
  if (!Services.prefs.prefHasUserValue(kPrefCheck)) {
    return;
  }
  const migrate = (oldName, newName, getter, setter) => {
    oldName = `extensions.torbutton.${oldName}`;
    newName = `browser.${newName}`;
    if (Services.prefs.prefHasUserValue(oldName)) {
      setter(newName, getter(oldName));
      Services.prefs.clearUserPref(oldName);
    }
  };
  const prefs = {
    security_custom: "security_level.security_custom",
    noscript_persist: "security_level.noscript_persist",
    noscript_inited: "security_level.noscript_inited",
  };
  for (const [oldName, newName] of Object.entries(prefs)) {
    migrate(
      oldName,
      newName,
      Services.prefs.getBoolPref.bind(Services.prefs),
      Services.prefs.setBoolPref.bind(Services.prefs)
    );
  }
  migrate(
    "security_slider",
    "security_level.security_slider",
    Services.prefs.getIntPref.bind(Services.prefs),
    Services.prefs.setIntPref.bind(Services.prefs)
  );
}

/**
 * This class is used to initialize the security level stuff at the startup
 */
export class SecurityLevel {
  QueryInterface = ChromeUtils.generateQI(["nsIObserver"]);

  init() {
    migratePreferences();
    // Fixup our preferences before we pass on the security level to NoScript.
    initializeSecurityPrefs();
    initializeNoScriptControl();
  }

  observe(aSubject, aTopic) {
    if (aTopic === BrowserTopics.ProfileAfterChange) {
      this.init();
    }
  }
}

/**
 * @typedef {object} SecurityLevelRestartNotificationHandler
 *
 * An object that can serve the user a restart notification.
 *
 * @property {Function} tryRestartBrowser - The method that should be called to
 *   ask the user to restart the browser.
 */

/*
  Security Level Prefs

  Getters and Setters for relevant security level prefs
*/
export const SecurityLevelPrefs = {
  SecurityLevels: Object.freeze({
    safest: 1,
    safer: 2,
    standard: 4,
  }),
  security_slider_pref: "browser.security_level.security_slider",
  security_custom_pref: "browser.security_level.security_custom",

  /**
   * The current security level preference.
   *
   * This ignores any custom settings the user may have changed, and just
   * gives the underlying security level.
   *
   * @type {?string}
   */
  get securityLevel() {
    // Set the default return value to 0, which won't match anything in
    // SecurityLevels.
    const val = Services.prefs.getIntPref(this.security_slider_pref, 0);
    return Object.entries(this.SecurityLevels).find(
      entry => entry[1] === val
    )?.[0];
  },

  /**
   * Set the desired security level just before a restart.
   *
   * The caller must restart the browser after calling this method.
   *
   * @param {string} level - The name of the new security level to set.
   */
  setSecurityLevelBeforeRestart(level) {
    write_setting_to_prefs(this.SecurityLevels[level]);
  },

  /**
   * Whether the user has any custom setting values that do not match a pre-set
   * security level.
   *
   * @type {boolean}
   */
  get securityCustom() {
    return Services.prefs.getBoolPref(this.security_custom_pref);
  },

  /**
   * A summary of the current security level.
   *
   * If the user has some custom settings, this returns "custom". Otherwise
   * returns the name of the security level.
   *
   * @type {string}
   */
  get securityLevelSummary() {
    if (this.securityCustom) {
      return "custom";
    }
    return this.securityLevel ?? "custom";
  },

  /**
   * Whether the browser should be restarted to apply the security level.
   *
   * @type {boolean}
   */
  _needRestart: false,

  /**
   * The external handler that can show a notification to the user, if any.
   *
   * @type {?SecurityLevelRestartNotificationHandler}
   */
  _restartNotificationHandler: null,

  /**
   * Set the external handler for showing notifications to the user.
   *
   * This should only be called once per session once the handler is ready to
   * show a notification, which may occur immediately during this call.
   *
   * @param {SecurityLevelRestartNotificationHandler} handler - The new handler
   *   to use.
   */
  setRestartNotificationHandler(handler) {
    logger.info("Restart notification handler is set");
    this._restartNotificationHandler = handler;
    if (this._needRestart) {
      // Show now using the new handler.
      this._tryShowRestartNotification();
    }
  },

  /**
   * A promise for any ongoing notification prompt task.
   *
   * @type {Promise}
   */
  _restartNotificationPromise: null,

  /**
   * Try show a notification to the user.
   *
   * If no notification handler has been attached yet, this will do nothing.
   */
  async _tryShowRestartNotification() {
    if (!this._restartNotificationHandler) {
      logger.info("Missing a restart notification handler");
      // This may be added later in the session.
      return;
    }

    const prevPromise = this._restartNotificationPromise;
    let resolve;
    ({ promise: this._restartNotificationPromise, resolve } =
      Promise.withResolvers());
    await prevPromise;

    try {
      await this._restartNotificationHandler?.tryRestartBrowser();
    } finally {
      // Allow the notification to be shown again.
      resolve();
    }
  },

  /**
   * Mark the session as requiring a restart to apply a change in security
   * level.
   *
   * The security level will immediately be switched to "custom", and the user
   * may be shown a notification to restart the browser.
   */
  requireRestart() {
    logger.warn("The browser needs to be restarted to set the security level");
    // Treat as a custom security level for the rest of the session.
    // At the next startup, the custom flag may be cleared if the settings are
    // as expected.
    Services.prefs.setBoolPref(kCustomPref, true);
    this._needRestart = true;

    // NOTE: We need to change the controlled security level preferences in
    // response to the desired change in security level. We could either:
    // 1. Only change the controlled preferences after the user confirms a
    //    restart. Or
    // 2. Change the controlled preferences and then try and ask the user to
    //    restart.
    //
    // We choose the latter:
    // 1. To allow users to manually restart.
    // 2. If the user ignores or misses the notification, they will at least be
    //    in the correct state when the browser starts again. Although they will
    //    be in a custom/undefined state in the mean time.
    // 3. Currently Android relies on triggering the change in security level
    //    by setting the browser.security_level.security_slider preference
    //    value. So it currently uses this path. So we need to set the values
    //    now, before it preforms a restart.
    // TODO: Have android use the `setSecurityLevelBeforeRestart` method
    // instead of setting the security_slider preference value directly, so that
    // it knows exactly when it can restart the browser. tor-browser#43820
    write_setting_to_prefs(Services.prefs.getIntPref(kSliderPref, 0));
    // NOTE: Even though we have written the preferences, the session should
    // still be marked as "custom" because:
    // 1. Some preferences require a browser restart to be applied.
    // 2. NoScript has not been updated with the new settings.
    this._tryShowRestartNotification();
  },
}; /* Security Level Prefs */
