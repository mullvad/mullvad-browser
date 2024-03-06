import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

Preferences.addAll([
  {
    id: "privacy.resistFingerprinting.letterboxing",
    type: "bool",
  },
  {
    id: "privacy.resistFingerprinting.letterboxing.rememberSize",
    type: "bool",
  },
  {
    id: "privacy.resistFingerprinting.letterboxing.vcenter",
    type: "bool",
  },
]);

Preferences.addSetting({
  id: "letterboxingEnabled",
  pref: "privacy.resistFingerprinting.letterboxing",
});

Preferences.addSetting({
  id: "letterboxingWindowSize",
  deps: ["letterboxingEnabled", "resistFingerprinting"],
  visible: ({ letterboxingEnabled, resistFingerprinting }) => {
    return letterboxingEnabled.value && resistFingerprinting.value;
  },
});

Preferences.addSetting({
  id: "letterboxingRememberSize",
  pref: "privacy.resistFingerprinting.letterboxing.rememberSize",
});

Preferences.addSetting({
  id: "letterboxingContentAlignment",
  deps: ["letterboxingEnabled", "resistFingerprinting"],
  visible: ({ letterboxingEnabled, resistFingerprinting }) => {
    return letterboxingEnabled.value && resistFingerprinting.value;
  },
});

Preferences.addSetting({
  id: "letterboxingContentAlignmentOptions",
  pref: "privacy.resistFingerprinting.letterboxing.vcenter",
  get: val => {
    return val ? "middle" : "top";
  },
  set: val => {
    return val == "middle";
  },
});

Preferences.addSetting({
  id: "letterboxingShouldEnable",
  deps: ["letterboxingEnabled", "resistFingerprinting"],
  visible: ({ letterboxingEnabled, resistFingerprinting }) => {
    return !letterboxingEnabled.value && resistFingerprinting.value;
  },
  onUserClick: (e, { letterboxingEnabled }) => {
    const buttonEl = document.getElementById("enableLetterboxingButton");
    if (!buttonEl?.contains(e.target)) {
      return;
    }
    letterboxingEnabled.value = true;
    // Button should have focus when activated but will be hidden now,
    // so re-assign focus after the new section is revealed.
    document
      .getElementById("letterboxingWindowSize")
      .updateComplete.then(() => {
        document.getElementById("letterboxingRememberSize").focus();
      });
  },
});

SettingGroupManager.registerGroups({
  letterboxing: {
    l10nId: "letterboxing-settings-group",
    supportPage:
      "tor-manual:features__fingerprinting-protections___letterboxing",
    headingLevel: 2,
    items: [
      {
        id: "letterboxingShouldEnable",
        l10nId: "letterboxing-disabled-message",
        control: "moz-promo",
        options: [
          {
            control: "moz-button",
            l10nId: "letterboxing-enable-button",
            id: "enableLetterboxingButton",
            slot: "actions",
          },
        ],
      },
      {
        id: "letterboxingWindowSize",
        l10nId: "letterboxing-window-size-group",
        control: "moz-fieldset",
        controlAttrs: {
          headinglevel: 3,
        },
        items: [
          {
            id: "letterboxingRememberSize",
            l10nId: "letterboxing-remember-size",
            control: "moz-checkbox",
          },
        ],
      },
      {
        id: "letterboxingContentAlignment",
        l10nId: "letterboxing-alignment-group",
        control: "moz-fieldset",
        controlAttrs: {
          headinglevel: 3,
        },
        items: [
          {
            id: "letterboxingContentAlignmentOptions",
            control: "moz-visual-picker",
            options: [
              {
                value: "top",
                l10nId: "letterboxing-alignment-top-option",
                controlAttrs: {
                  class: "setting-chooser-item letterboxing-chooser-item",
                  imagesrc:
                    "chrome://browser/content/preferences/letterboxing-top.svg",
                },
              },
              {
                value: "middle",
                l10nId: "letterboxing-alignment-middle-option",
                controlAttrs: {
                  class: "setting-chooser-item letterboxing-chooser-item",
                  imagesrc:
                    "chrome://browser/content/preferences/letterboxing-middle.svg",
                },
              },
            ],
          },
        ],
      },
    ],
  },
});
