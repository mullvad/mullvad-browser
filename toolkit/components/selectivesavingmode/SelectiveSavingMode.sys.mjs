/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pref to select browsing mode via this component
export const kSelectiveSavingModePref = "browser.selectiveSavingMode";

// Selective Saving Mode underlaying functionality prefs
// Sanitize site data upon shutdown
const kSanitizeOnShutdown = "privacy.sanitize.sanitizeOnShutdown";
// Start browser in private window
const kPrivateBrowsingAutostart = "browser.privatebrowsing.autostart";
// Keep site permissions stored in memory rather than on disk
const kKeepPermissionInMemory = "permissions.memory_only";

// Valid options for the browsing mode pref to be set to
export const SelectiveSavingModes = Object.freeze({
  unconfigured: 0,
  total_clearing: 1,
  selective_saving: 2,
  normal_browsing: 3,
  custom: 4,
});

// A table of all prefs used to move between default browsing modes.
const kSelectiveSavingModeSettings = {
  total_clearing: {
    [kSanitizeOnShutdown]: true,
    [kPrivateBrowsingAutostart]: true,
    [kKeepPermissionInMemory]: true,
  },
  selective_saving: {
    [kSanitizeOnShutdown]: true,
    [kPrivateBrowsingAutostart]: false,
    [kKeepPermissionInMemory]: false,
  },
  normal_browsing: {
    [kSanitizeOnShutdown]: false,
    [kPrivateBrowsingAutostart]: false,
    [kKeepPermissionInMemory]: false,
  },
};

/**
 * Selective Saving Mode Pref Controller
 *
 * Listens for and handles changes in prefs relevant to Selective Saving Mode in
 * order to keep the browsing mode pref and the corresponding functionality
 * prefs in sync with each other each time any of the aforementioned prefs are
 * changed
 */
export class SelectiveSavingPrefController {
  QueryInterface = ChromeUtils.generateQI(["nsIObserver"]);

  /**
   * Initialize pref controller
   */
  init() {
    if (!Services.prefs.getBoolPref("browser.selectiveSavingMode.enabled")) {
      return;
    }

    if (
      Services.prefs.getIntPref(kSelectiveSavingModePref) ===
      SelectiveSavingModes.unconfigured
    ) {
      this.#setBrowsingModeFromPrefs();
    } else {
      this.#setPrefsFromBrowsingMode();
    }

    this.#createPreferenceObservers();
  }

  /**
   * Shutdown pref controller
   */
  shutdown() {
    this.#removePreferenceObservers();
  }

  /**
   * Component hook for observing relevant event messages
   *
   * @param {string} aSubject
   * @param {string} aTopic
   */
  observe(aSubject, aTopic) {
    if (aTopic === "profile-after-change") {
      this.init();
    }
  }

  /**
   * Sets current Selective Saving browsing mode to closely match how
   * functionality prefs are configured in kSelectiveSavingModeSettings
   */
  #setBrowsingModeFromPrefs() {
    const currentSanitizePref = Services.prefs.getBoolPref(kSanitizeOnShutdown);
    const currentAutostartPref = Services.prefs.getBoolPref(
      kPrivateBrowsingAutostart
    );
    const currentPermissionPref = Services.prefs.getBoolPref(
      kKeepPermissionInMemory
    );

    for (let [mode, settings] of Object.entries(kSelectiveSavingModeSettings)) {
      if (
        currentSanitizePref === settings[kSanitizeOnShutdown] &&
        currentAutostartPref === settings[kPrivateBrowsingAutostart] &&
        currentPermissionPref === settings[kKeepPermissionInMemory]
      ) {
        Services.prefs.setIntPref(
          kSelectiveSavingModePref,
          SelectiveSavingModes[mode]
        );
        return;
      }
    }

    Services.prefs.setIntPref(
      kSelectiveSavingModePref,
      SelectiveSavingModes.custom
    );
  }

  /**
   * A wrapper for setBrowsingModeFromPrefs to reset pref observers
   */
  #setModeAndResetObservers = () => {
    this.#removePreferenceObservers();
    this.#setBrowsingModeFromPrefs();
    this.#createPreferenceObservers();
  };

  /**
   * Sets current Selective Saving functionality prefs to closely match the
   * currently assigned browsing mode. Corrects for anomalous settings if present
   * as well
   */
  #setPrefsFromBrowsingMode() {
    let currentBrowsingMode = Services.prefs.getIntPref(
      kSelectiveSavingModePref
    );

    const mode = Object.entries(SelectiveSavingModes).find(
      ([, value]) => value === currentBrowsingMode
    )?.[0];

    if (
      mode === undefined ||
      currentBrowsingMode === SelectiveSavingModes.unconfigured
    ) {
      this.#setBrowsingModeFromPrefs();
      return;
    }

    if (kSelectiveSavingModeSettings[mode]) {
      Services.prefs.setBoolPref(
        kSanitizeOnShutdown,
        kSelectiveSavingModeSettings[mode][kSanitizeOnShutdown]
      );
      Services.prefs.setBoolPref(
        kPrivateBrowsingAutostart,
        kSelectiveSavingModeSettings[mode][kPrivateBrowsingAutostart]
      );
      Services.prefs.setBoolPref(
        kKeepPermissionInMemory,
        kSelectiveSavingModeSettings[mode][kKeepPermissionInMemory]
      );
    }
  }

  /**
   * A wrapper for setPrefsFromBrowsingMode to reset pref observers
   */
  #setPrefsAndResetObservers = () => {
    this.#removePreferenceObservers();
    this.#setPrefsFromBrowsingMode();
    this.#createPreferenceObservers();
  };

  /**
   * A helper function for standing up pref observers with the correct callback
   */
  #createPreferenceObservers() {
    Services.prefs.addObserver(
      kSelectiveSavingModePref,
      this.#setPrefsAndResetObservers
    );

    Services.prefs.addObserver(
      kSanitizeOnShutdown,
      this.#setModeAndResetObservers
    );
    Services.prefs.addObserver(
      kPrivateBrowsingAutostart,
      this.#setModeAndResetObservers
    );
    Services.prefs.addObserver(
      kKeepPermissionInMemory,
      this.#setModeAndResetObservers
    );
  }

  /**
   * A helper function for disabling pref observers keyed to their respective
   * callbacks
   */
  #removePreferenceObservers() {
    Services.prefs.removeObserver(
      kSelectiveSavingModePref,
      this.#setPrefsAndResetObservers
    );

    Services.prefs.removeObserver(
      kSanitizeOnShutdown,
      this.#setModeAndResetObservers
    );
    Services.prefs.removeObserver(
      kPrivateBrowsingAutostart,
      this.#setModeAndResetObservers
    );
    Services.prefs.removeObserver(
      kKeepPermissionInMemory,
      this.#setModeAndResetObservers
    );
  }
} /* Selective Saving Mode Pref Controller */
