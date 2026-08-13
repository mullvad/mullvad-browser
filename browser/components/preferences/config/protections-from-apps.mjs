/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";

Preferences.addAll([
  { id: "privacy.exposeContentTitleInWindow", type: "bool" },
  { id: "privacy.exposeContentTitleInWindow.pbm", type: "bool" },
]);

Preferences.addSetting({
  id: "exposeContentWindowTitle",
  pref: "privacy.exposeContentTitleInWindow",
});

Preferences.addSetting({
  id: "exposePrivateContentWindowTitle",
  pref: "privacy.exposeContentTitleInWindow.pbm",
});

Preferences.addSetting({
  id: "genericWindowTitles",
  deps: ["exposeContentWindowTitle", "exposePrivateContentWindowTitle"],
  get: (_pref, { exposeContentWindowTitle }) => {
    // NOTE: The behaviour of `privacy.exposeContentTitleInWindow` (all) and
    // `privacy.exposeContentTitleInWindow.pbm` (pbm) is:
    //
    //            || all=true               | all=false       |
    //  ==========++========================+=================|
    //  pbm=true  || All windows include    | All windows use |
    //            || content.               | generic.        |
    //  ----------++------------------------+-----------------|
    //  pbm=false || Private windows use    | All windows use |
    //            || generic. Other windows | generic.        |
    //            || include content.       |                 |
    //  ------------------------------------------------------+
    //
    // For the settings UI, we treat the "all=true, pbm=false" case as
    // "genericWindowTitles" being *unset*.
    return !exposeContentWindowTitle.value;
  },
  set: (
    value,
    { exposeContentWindowTitle, exposePrivateContentWindowTitle }
  ) => {
    exposeContentWindowTitle.value = !value;
    exposePrivateContentWindowTitle.value = !value;
  },
});

SettingGroupManager.registerGroups({
  protectionsFromThirdParty: {
    l10nId: "protections-from-applications-group",
    heaidngLevel: 2,
    // TODO: supportPage: "tor-manual:",
    items: [
      {
        id: "genericWindowTitles",
        l10nId: "generic-window-titles-checkbox",
      },
    ],
  },
});
