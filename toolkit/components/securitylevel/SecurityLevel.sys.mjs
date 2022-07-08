import { ConsoleAPI } from "resource://gre/modules/Console.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
});

const logger = new ConsoleAPI({
  maxLogLevel: "info",
  prefix: "SecurityLevel",
});

const BrowserTopics = Object.freeze({
  ProfileAfterChange: "profile-after-change",
});

// The Security Settings prefs in question.
const kSliderPref = "browser.security_level.security_slider";
const kCustomPref = "browser.security_level.security_custom";

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

// __bindPref(prefName, prefHandler, init)__
// Applies prefHandler whenever the value of the pref changes.
// If init is true, applies prefHandler to the current value.
// Returns a zero-arg function that unbinds the pref.
var bindPref = function (prefName, prefHandler, init = false) {
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
  if (init) {
    update();
  }
  return () => {
    Services.prefs.removeObserver(prefName, observer);
  };
};

// __bindPrefAndInit(prefName, prefHandler)__
// Applies prefHandler to the current value of pref specified by prefName.
// Re-applies prefHandler whenever the value of the pref changes.
// Returns a zero-arg function that unbinds the pref.
var bindPrefAndInit = (prefName, prefHandler) =>
  bindPref(prefName, prefHandler, true);

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
    return torSendExtensionMessage(extensionId, message);
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
    let sendNoScriptSettings = settings =>
      sendExtensionMessage(noscriptID, settings);

    // __setNoScriptSafetyLevel(safetyLevel)__.
    // Set NoScript settings according to a particular safety level
    // (security slider level): 0 = Standard, 1 = Safer, 2 = Safest
    let setNoScriptSafetyLevel = safetyLevel =>
      sendNoScriptSettings(noscriptSettings(safetyLevel));

    // __securitySliderToSafetyLevel(sliderState)__.
    // Converts the "browser.security_level.security_slider" pref value
    // to a "safety level" value: 0 = Standard, 1 = Safer, 2 = Safest
    let securitySliderToSafetyLevel = sliderState =>
      [undefined, 2, 1, 1, 0][sliderState];

    // Wait for the first message from NoScript to arrive, and then
    // bind the security_slider pref to the NoScript settings.
    let messageListener = a => {
      try {
        logger.debug("Message received from NoScript:", a);
        let noscriptPersist = Services.prefs.getBoolPref(
          "browser.security_level.noscript_persist",
          false
        );
        let noscriptInited = Services.prefs.getBoolPref(
          "browser.security_level.noscript_inited",
          false
        );
        // Set the noscript safety level once if we have never run noscript
        // before, or if we are not allowing noscript per-site settings to be
        // persisted between browser sessions. Otherwise make sure that the
        // security slider position, if changed, will rewrite the noscript
        // settings.
        bindPref(
          kSliderPref,
          sliderState =>
            setNoScriptSafetyLevel(securitySliderToSafetyLevel(sliderState)),
          !noscriptPersist || !noscriptInited
        );
        if (!noscriptInited) {
          Services.prefs.setBoolPref(
            "browser.security_level.noscript_inited",
            true
          );
        }
      } catch (e) {
        logger.exception(e);
      }
    };
    waitForExtensionMessage(noscriptID, a => a.__meta.name === "started").then(
      messageListener
    );
    logger.info("Listening for messages from NoScript.");
  } catch (e) {
    logger.exception(e);
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
  // Preference name :                                          [0, 1-high 2-m    3-m    4-low]
  "javascript.options.ion" :                                    [,  false, false, false, true ],
  "javascript.options.baselinejit" :                            [,  false, false, false, true ],
  "javascript.options.native_regexp" :                          [,  false, false, false, true ],
  "mathml.disabled" :                                           [,  true,  true,  true,  false],
  "gfx.font_rendering.graphite.enabled" :                       [,  false, false, false, true ],
  "gfx.font_rendering.opentype_svg.enabled" :                   [,  false, false, false, true ],
  "svg.disabled" :                                              [,  true,  false, false, false],
  "javascript.options.asmjs" :                                  [,  false, false, false, true ],
  "javascript.options.wasm" :                                   [,  false, false, false, true ],
  "dom.security.https_only_mode_send_http_background_request" : [,  false, false, false, true ],
};
/* eslint-enable */

// ### Prefs

// __write_setting_to_prefs(settingIndex)__.
// Take a given setting index and write the appropriate pref values
// to the pref database.
var write_setting_to_prefs = function (settingIndex) {
  Object.keys(kSecuritySettings).forEach(prefName =>
    Services.prefs.setBoolPref(
      prefName,
      kSecuritySettings[prefName][settingIndex]
    )
  );
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

// __watch_security_prefs(onSettingChanged)__.
// Whenever a pref bound to the security slider changes, onSettingChanged
// is called with the new security setting value (1,2,3,4 or null).
// Returns a zero-arg function that ends this binding.
var watch_security_prefs = function (onSettingChanged) {
  let prefNames = Object.keys(kSecuritySettings);
  let unbindFuncs = [];
  for (let prefName of prefNames) {
    unbindFuncs.push(
      bindPrefAndInit(prefName, () =>
        onSettingChanged(read_setting_from_prefs())
      )
    );
  }
  // Call all the unbind functions.
  return () => unbindFuncs.forEach(unbind => unbind());
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
  // When security_custom is set to false, apply security_slider setting
  // to the security-sensitive prefs.
  bindPrefAndInit(kCustomPref, function (custom) {
    if (custom === false) {
      write_setting_to_prefs(Services.prefs.getIntPref(kSliderPref));
    }
  });
  // If security_slider is given a new value, then security_custom should
  // be set to false.
  bindPref(kSliderPref, function (prefIndex) {
    Services.prefs.setBoolPref(kCustomPref, false);
    write_setting_to_prefs(prefIndex);
  });
  // If a security-sensitive pref changes, then decide if the set of pref values
  // constitutes a security_slider setting or a custom value.
  watch_security_prefs(settingIndex => {
    if (settingIndex === null) {
      Services.prefs.setBoolPref(kCustomPref, true);
    } else {
      Services.prefs.setIntPref(kSliderPref, settingIndex);
      Services.prefs.setBoolPref(kCustomPref, false);
    }
  });
  // Migrate from old medium-low (3) to new medium (2).
  if (
    Services.prefs.getBoolPref(kCustomPref) === false &&
    Services.prefs.getIntPref(kSliderPref) === 3
  ) {
    Services.prefs.setIntPref(kSliderPref, 2);
    write_setting_to_prefs(2);
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

// This class is used to initialize the security level stuff at the startup
export class SecurityLevel {
  QueryInterface = ChromeUtils.generateQI(["nsIObserver"]);

  init() {
    migratePreferences();
    initializeNoScriptControl();
    initializeSecurityPrefs();
  }

  observe(aSubject, aTopic, aData) {
    if (aTopic === BrowserTopics.ProfileAfterChange) {
      this.init();
    }
  }
}

/*
  Security Level Prefs

  Getters and Setters for relevant torbutton prefs
*/
export const SecurityLevelPrefs = {
  SecurityLevels: Object.freeze({
    safest: 1,
    safer: 2,
    standard: 4,
  }),
  security_slider_pref: "browser.security_level.security_slider",
  security_custom_pref: "browser.security_level.security_custom",

  get securityLevel() {
    // Set the default return value to 0, which won't match anything in
    // SecurityLevels.
    const val = Services.prefs.getIntPref(this.security_slider_pref, 0);
    return Object.entries(this.SecurityLevels).find(
      entry => entry[1] === val
    )?.[0];
  },

  set securityLevel(level) {
    const val = this.SecurityLevels[level];
    if (val !== undefined) {
      Services.prefs.setIntPref(this.security_slider_pref, val);
    }
  },

  get securityCustom() {
    return Services.prefs.getBoolPref(this.security_custom_pref);
  },

  set securityCustom(val) {
    Services.prefs.setBoolPref(this.security_custom_pref, val);
  },
}; /* Security Level Prefs */
