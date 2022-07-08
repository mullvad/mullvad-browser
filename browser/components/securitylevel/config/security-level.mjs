/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  SecurityLevelPrefs:
    "moz-src:///toolkit/components/securitylevel/SecurityLevel.sys.mjs",
});

SettingGroupManager.registerGroups({
  securityLevelGroup: {
    subcategory: "securitylevel",
    l10nId: "security-level-settings-group",
    headingLevel: 2,
    supportPage: "tor-manual:features__security-levels",
    items: [
      {
        id: "securityLevelBoxGroup",
        control: "moz-box-group",
        items: [
          {
            id: "securityLevelCurrent",
            control: "security-level-display",
          },
          {
            id: "securityLevelChangeButton",
            l10nId: "security-level-settings-change-button",
            control: "moz-box-button",
          },
        ],
      },
    ],
  },
});

Preferences.addSetting({
  id: "securityLevelCurrent",
  setup(emitChange) {
    Services.prefs.addObserver(
      "browser.security_level.security_slider",
      emitChange
    );
    Services.prefs.addObserver(
      "browser.security_level.security_custom",
      emitChange
    );

    return () => {
      Services.prefs.removeObserver(
        "browser.security_level.security_slider",
        emitChange
      );
      Services.prefs.removeObserver(
        "browser.security_level.security_custom",
        emitChange
      );
    };
  },
  get: () => {
    return lazy.SecurityLevelPrefs.securityLevelSummary;
  },
});

Preferences.addSetting({
  id: "securityLevelBoxGroup",
});

Preferences.addSetting({
  id: "securityLevelChangeButton",
  onUserClick() {
    window.gSubDialog.open(
      "chrome://browser/content/securitylevel/securityLevelDialog.xhtml",
      { features: "resizable=yes" }
    );
  },
});
