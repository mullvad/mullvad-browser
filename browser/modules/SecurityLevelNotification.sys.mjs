const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  SecurityLevelPrefs: "resource://gre/modules/SecurityLevel.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "NotificationStrings", function () {
  return new Localization([
    "branding/brand.ftl",
    "toolkit/global/base-browser.ftl",
  ]);
});

/**
 * Interface for showing the security level restart notification on desktop.
 */
export const SecurityLevelNotification = {
  /**
   * Whether we have already been initialised.
   *
   * @type {boolean}
   */
  _initialized: false,

  /**
   * Called when the UI is ready to show a notification.
   */
  ready() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    lazy.SecurityLevelPrefs.setNotificationHandler(this);
  },

  /**
   * Show the restart notification, and perform the restart if the user agrees.
   *
   * @returns {boolean} - Whether we are restarting the browser.
   */
  async tryRestartBrowser() {
    const [titleText, bodyText, primaryButtonText, secondaryButtonText] =
      await lazy.NotificationStrings.formatValues([
        { id: "security-level-restart-prompt-title" },
        { id: "security-level-restart-prompt-body" },
        { id: "restart-warning-dialog-restart-button" },
        { id: "security-level-restart-prompt-button-ignore" },
      ]);
    const buttonFlags =
      Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
      Services.prompt.BUTTON_POS_0_DEFAULT +
      Services.prompt.BUTTON_DEFAULT_IS_DESTRUCTIVE +
      Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_1;

    const propBag = await Services.prompt.asyncConfirmEx(
      lazy.BrowserWindowTracker.getTopWindow()?.browsingContext ?? null,
      Services.prompt.MODAL_TYPE_INTERNAL_WINDOW,
      titleText,
      bodyText,
      buttonFlags,
      primaryButtonText,
      secondaryButtonText,
      null,
      null,
      null,
      {}
    );

    if (propBag.get("buttonNumClicked") === 0) {
      Services.startup.quit(
        Services.startup.eAttemptQuit | Services.startup.eRestart
      );
      return true;
    }
    return false;
  },

  /**
   * Show or re-show the custom security notification.
   *
   * @param {Function} userDismissedCallback - The callback for when the user
   *   dismisses the notification.
   */
  async showCustomWarning(userDismissedCallback) {
    const win = lazy.BrowserWindowTracker.getTopWindow();
    if (!win) {
      return;
    }
    const typeName = "security-level-custom";
    const existing = win.gNotificationBox.getNotificationWithValue(typeName);
    if (existing) {
      win.gNotificationBox.removeNotification(existing);
    }

    const buttons = [
      {
        "l10n-id": "security-level-panel-open-settings-button",
        callback() {
          win.openPreferences("privacy-securitylevel");
        },
      },
    ];

    win.gNotificationBox.appendNotification(
      typeName,
      {
        label: { "l10n-id": "security-level-summary-custom" },
        priority: win.gNotificationBox.PRIORITY_WARNING_HIGH,
        eventCallback: event => {
          if (event === "dismissed") {
            userDismissedCallback();
          }
        },
      },
      buttons
    );
  },
};
