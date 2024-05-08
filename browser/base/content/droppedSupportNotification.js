"use strict";

// Show a prompt that a user's system will no longer be supported.
window.addEventListener("load", () => {
  let labelId;
  // Expire date is 2024-10-01 (1st October 2024).
  const isExpired = Date.now() > Date.UTC(2024, 9, 1);

  if (
    AppConstants.platform === "macosx" &&
    Services.vc.compare(
      Services.sysinfo.getProperty("version"),
      "19.0" // MacOS 10.15 begins with Darwin 19.0
    ) < 0
  ) {
    labelId = isExpired
      ? "dropped-support-notification-macos-version-less-than-10-15-expired"
      : "dropped-support-notification-macos-version-less-than-10-15";
  } else if (
    AppConstants.platform === "win" &&
    Services.vc.compare(Services.sysinfo.getProperty("version"), "10.0") < 0
  ) {
    labelId = isExpired
      ? "dropped-support-notification-win-os-version-less-than-10-expired"
      : "dropped-support-notification-win-os-version-less-than-10";
  }

  const dismissedPref =
    "browser.dropped_support_notification_v14.dismiss_version";

  if (!labelId) {
    // Avoid setting any preferences for supported versions, and clean up any
    // old values if the user ported their profile.
    Services.prefs.clearUserPref(dismissedPref);
    return;
  }

  if (
    !isExpired &&
    Services.prefs.getStringPref(dismissedPref, "") ===
      AppConstants.BASE_BROWSER_VERSION
  ) {
    // Already dismissed since the last update.
    return;
  }

  const buttons = isExpired
    ? undefined
    : [
        {
          "l10n-id": "dropped-support-notification-dismiss-button",
          callback: () => {
            Services.prefs.setStringPref(
              dismissedPref,
              AppConstants.BASE_BROWSER_VERSION
            );
          },
        },
      ];

  gNotificationBox.appendNotification(
    "dropped-support-notification",
    {
      label: { "l10n-id": labelId },
      priority: gNotificationBox.PRIORITY_WARNING_HIGH,
    },
    buttons
  );
});
