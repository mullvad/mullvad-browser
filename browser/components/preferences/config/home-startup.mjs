/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";

const { AboutPreferences } = ChromeUtils.importESModule(
  "moz-src:///browser/extensions/newtab/lib/AboutPreferences.sys.mjs"
);

/*
 * Preferences:
 *
 * browser.startup.homepage
 * - the user's home page, as a string; if the home page is a set of tabs,
 *   this will be those URLs separated by the pipe character "|"
 * browser.newtabpage.enabled
 * - determines that is shown on the user's new tab page.
 *   true = Activity Stream is shown,
 *   false = about:blank is shown
 */

export const BLANK_HOMEPAGE_URL = "chrome://browser/content/blanktab.html";

Preferences.addAll([
  { id: "browser.startup.homepage", type: "string" },
  { id: "pref.browser.homepage.disable_button.current_page", type: "bool" },
  { id: "pref.browser.homepage.disable_button.bookmark_page", type: "bool" },
  { id: "pref.browser.homepage.disable_button.restore_default", type: "bool" },
  { id: "browser.newtabpage.enabled", type: "bool" },
]);

if (Services.prefs.getBoolPref("browser.settings-redesign.enabled")) {
  SettingGroupManager.registerGroups({
    defaultBrowserHome: window.createDefaultBrowserConfig(),
    startupHome: window.createStartupConfig(),
  });
  // Register the rest of the home settings using the "newtab" extension's file.
  // tor-browser#44830.
  new AboutPreferences().baseBrowserRegisterGroups(window);
}
