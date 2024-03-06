/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

ChromeUtils.importESModule(
  "chrome://browser/content/preferences/config/letterboxing.mjs",
  { global: "current" }
);

const FORCED_COLORS_QUERY = matchMedia("(forced-colors)");

Preferences.addAll([
  { id: "layout.css.prefers-color-scheme.content-override", type: "int" },
]);

Preferences.addSetting({
  id: "web-appearance-override-warning",
  setup: emitChange => {
    FORCED_COLORS_QUERY.addEventListener("change", emitChange);
    return () => FORCED_COLORS_QUERY.removeEventListener("change", emitChange);
  },
  visible: () => {
    return FORCED_COLORS_QUERY.matches;
  },
});

Preferences.addSetting(
  /** @type {{ themeNames: string[] } & SettingConfig}} */ ({
    id: "web-appearance-chooser",
    themeNames: ["dark", "light", "auto"],
    pref: "layout.css.prefers-color-scheme.content-override",
    setup(emitChange) {
      Services.obs.addObserver(emitChange, "look-and-feel-changed");
      return () =>
        Services.obs.removeObserver(emitChange, "look-and-feel-changed");
    },
    get(val, _, setting) {
      return (
        this.themeNames[val] ||
        this.themeNames[/** @type {number} */ (setting.pref.defaultValue)]
      );
    },
    /** @param {string} val */
    set(val) {
      return this.themeNames.indexOf(val);
    },
    getControlConfig(config) {
      // Set the auto theme image to the light/dark that matches.
      let systemThemeIndex = Services.appinfo
        .contentThemeDerivedColorSchemeIsDark
        ? 2
        : 1;
      config.options[0].controlAttrs = {
        ...config.options[0].controlAttrs,
        imagesrc: config.options[systemThemeIndex].controlAttrs.imagesrc,
      };
      return config;
    },
  })
);

Preferences.addSetting({
  id: "web-appearance-manage-themes-link",
  onUserClick: e => {
    e.preventDefault();
    // @ts-ignore topChromeWindow global
    window.browsingContext.topChromeWindow.BrowserAddonUI.openAddonsMgr(
      "addons://list/theme"
    );
  },
});

Preferences.addSetting({
  id: "related-settings-accessibility-link",
  onUserClick: e => {
    e.preventDefault();
    window.gotoPref("paneAccessibility");
  },
});

Preferences.addSetting({
  id: "related-settings-home-link",
  onUserClick: e => {
    e.preventDefault();
    window.gotoPref("paneHome");
  },
});

Preferences.addSetting({
  id: "related-settings-tabs-browsing-link",
  onUserClick: e => {
    e.preventDefault();
    window.gotoPref("paneTabsBrowsing-layout");
  },
});

Preferences.addSetting({ id: "relatedSettingsBoxGroup" });

SettingGroupManager.registerGroups({
  appearance: {
    l10nId: "appearance-group2",
    iconSrc: "chrome://global/skin/icons/defaultFavicon.svg",
    headingLevel: 2,
    items: [
      {
        id: "web-appearance-override-warning",
        l10nId: "preferences-web-appearance-override-warning3",
        control: "moz-message-bar",
        controlAttrs: {
          role: "status",
        },
      },
      {
        id: "web-appearance-chooser",
        control: "moz-visual-picker",
        options: [
          {
            value: "auto",
            l10nId: "preferences-web-appearance-choice-auto3",
            controlAttrs: {
              id: "preferences-web-appearance-choice-auto",
              class: "setting-chooser-item",
              imagesrc:
                "chrome://browser/content/preferences/web-appearance-light.svg",
            },
          },
          {
            value: "light",
            l10nId: "preferences-web-appearance-choice-light2",
            controlAttrs: {
              id: "preferences-web-appearance-choice-light",
              class: "setting-chooser-item",
              imagesrc:
                "chrome://browser/content/preferences/web-appearance-light.svg",
            },
          },
          {
            value: "dark",
            l10nId: "preferences-web-appearance-choice-dark2",
            controlAttrs: {
              id: "preferences-web-appearance-choice-dark",
              class: "setting-chooser-item",
              imagesrc:
                "chrome://browser/content/preferences/web-appearance-dark.svg",
            },
          },
        ],
      },
    ],
  },
  browserTheme: {
    l10nId: "browser-theme-group",
    iconSrc: "chrome://browser/skin/customize.svg",
    headingLevel: 2,
    items: [
      {
        id: "web-appearance-manage-themes-link",
        l10nId: "browser-theme-manage-link",
        control: "moz-box-link",
        controlAttrs: {
          href: "about:addons",
        },
      },
    ],
  },
  relatedSettings: {
    l10nId: "related-settings-group",
    headingLevel: 2,
    items: [
      {
        id: "relatedSettingsBoxGroup",
        control: "moz-box-group",
        items: [
          {
            id: "related-settings-accessibility-link",
            l10nId: "related-settings-accessibility-link",
            control: "moz-box-link",
            controlAttrs: {
              href: "about:preferences#accessibility",
            },
          },
          {
            id: "related-settings-home-link",
            l10nId: "related-settings-home-link",
            control: "moz-box-link",
            controlAttrs: {
              href: "about:preferences#home",
            },
          },
          {
            id: "related-settings-tabs-browsing-link",
            l10nId: "related-settings-tabs-browsing-link",
            control: "moz-box-link",
            controlAttrs: {
              href: "about:preferences#tabsBrowsing",
            },
          },
        ],
      },
    ],
  },
});
