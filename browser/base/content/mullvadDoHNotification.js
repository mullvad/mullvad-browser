"use strict";

window.addEventListener("load", () => {
  // A notification to let users known that their DNS over HTTPS settings have
  // changed because the mullvad DoH services has been discontinued and
  // replaced. tor-browser#538.
  const notification = {
    // ProfileDataUpgrader.upgradeMB migration will set the `showPref`
    // preference conditionally on whether the user is effected. We wait for
    // this preference for confirmation.
    showPref: "mullvadbrowser.migration.show_doh_notification",
    shown: false,

    init() {
      Services.prefs.addObserver(this.showPref, this);
      this.maybeShow();
    },

    observe() {
      this.maybeShow();
    },

    async maybeShow() {
      if (this.shown || !Services.prefs.getBoolPref(this.showPref, false)) {
        return;
      }
      this.shown = true;
      Services.prefs.removeObserver(this.showPref, this);

      gNotificationBox.appendNotification(
        "mullvad-doh-notification",
        {
          label: { "l10n-id": "mullvad-doh-notification-body" },
          priority: gNotificationBox.PRIORITY_INFO_HIGH,
          eventCallback: name => {
            if (name === "dismissed") {
              Services.prefs.clearUserPref(this.showPref);
            }
          },
        },
        [
          {
            "l10n-id": "moz-support-link-text",
            link: "https://mullvad.net/en/blog/shutting-down-our-public-encrypted-dns-servers-and-sponsoring-quad9-instead",
          },
          {
            "l10n-id": "mullvad-doh-notification-settings-button",
            primary: true,
            callback: () => {
              window.openPreferences("dnsOverHttps");
              Services.prefs.clearUserPref(this.showPref);
              // Keep the notification open in case the user wants to click
              // "Learn more".
              return true;
            },
          },
        ]
      );
    },
  };
  notification.init();
});
