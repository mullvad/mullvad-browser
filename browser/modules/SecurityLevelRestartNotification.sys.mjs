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
export const SecurityLevelRestartNotification = {
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
    lazy.SecurityLevelPrefs.setRestartNotificationHandler(this);
  },

  /**
   * Show the restart notification, and perform the restart if the user agrees.
   */
  async tryRestartBrowser() {
    const [titleText, bodyText, primaryButtonText, secondaryButtonText] =
      await lazy.NotificationStrings.formatValues([
        { id: "security-level-restart-prompt-title" },
        { id: "security-level-restart-prompt-body" },
        { id: "security-level-restart-prompt-button-restart" },
        { id: "security-level-restart-prompt-button-ignore" },
      ]);
    const buttonFlags =
      Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0 +
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
    }
  },
};
