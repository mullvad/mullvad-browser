"use strict";

// Show a prompt to suggest to the user that they can change the UI language.
// Show it only the first time, and then do not show it anymore
window.addEventListener("load", () => {
  const PREF_NAME = "intl.language_notification.shown";

  if (Services.prefs.getBoolPref(PREF_NAME, false)) {
    return;
  }

  // Already customized, we do not suggest to change it again...
  if (Services.prefs.getCharPref("intl.locale.requested", "") !== "") {
    // ... and we never show the notification, either
    Services.prefs.setBoolPref(PREF_NAME, true);
    return;
  }

  // In sync with our changes on browser/components/preferences/main.js for
  // tor-browser#41369 and tor-browser#41372.
  const code =
    Services.locale.appLocaleAsBCP47 === "ja-JP-macos"
      ? "ja"
      : Services.locale.appLocaleAsBCP47;
  const language = Services.intl
    .getLocaleDisplayNames(undefined, [code], { preferNative: true })[0]
    .replace(/\s*\(.+\)$/g, "");

  // We want to determine whether the current locale was chosen based on the
  // system locales, in which case langauge negotiation returns a match, or
  // whether it simply defaulted to en-US.
  const matchingSystem = !!Services.locale.negotiateLanguages(
    // Since intl.locale.requested is empty, we expect requestedLocales to match
    // the user's system locales.
    Services.locale.requestedLocales,
    Services.locale.availableLocales
  ).length;
  const label = {
    "l10n-id": matchingSystem
      ? "language-notification-label-system"
      : "language-notification-label",
    "l10n-args": { language },
  };

  const buttons = [
    {
      "l10n-id": "language-notification-button",
      callback() {
        openPreferences("general-language");
      },
    },
  ];

  gNotificationBox.appendNotification(
    "language-notification",
    {
      label,
      priority: gNotificationBox.PRIORITY_INFO_HIGH,
    },
    buttons
  );

  // We do not wait for the user to either click on the button or dismiss the
  // notification: after we have shown it once, we take for granted that the
  // user has seen it and we never show it again.
  Services.prefs.setBoolPref(PREF_NAME, true);
});
