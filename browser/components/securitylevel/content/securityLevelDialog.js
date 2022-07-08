"use strict";

const { SecurityLevelPrefs } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/securitylevel/SecurityLevel.sys.mjs"
);

const gSecurityLevelDialog = {
  /**
   * The security level when this dialog was opened.
   *
   * @type {string}
   */
  _prevLevel: SecurityLevelPrefs.securityLevelSummary,
  /**
   * The security level currently selected.
   *
   * @type {string}
   */
  _selectedLevel: "",
  /**
   * The radiogroup for this preference.
   *
   * @type {?Element}
   */
  _radiogroup: null,
  /**
   * A list of radio options and their descriptions.
   *
   * @type {?Array<{ description: Element, radio: Element }>}
   */
  _radioOptions: null,

  /**
   * Initialise the dialog.
   */
  async init() {
    const dialog = document.getElementById("security-level-dialog");
    dialog.addEventListener("dialogaccept", event => {
      event.preventDefault();
      if (this._acceptButton.disabled) {
        return;
      }
      this._commitChange();
    });

    this._acceptButton = dialog.getButton("accept");

    document.l10n.setAttributes(
      this._acceptButton,
      "security-level-dialog-save-restart"
    );

    this._radiogroup = document.getElementById("security-level-radiogroup");

    this._radioOptions = Array.from(
      this._radiogroup.querySelectorAll("moz-radio"),
      radio => {
        const description = radio.querySelector("security-level-description");
        // Hide bullets by default.
        description.hideBullets = true;
        return { radio, description };
      }
    );

    for (const { radio } of this._radioOptions) {
      radio.querySelector(".moz-badge").hidden =
        radio.value !== this._prevLevel;
    }

    // We want to reserve the maximum height of the moz-radio-group so that the
    // dialog has enough height when the user switches options. So we cycle
    // through the options and measure the height when they are selected to set
    // a minimum height that fits all of them.
    let maxHeight = 0;
    for (const { description } of this._radioOptions) {
      description.hideBullets = false;
      await this._settled();
      maxHeight = Math.max(
        maxHeight,
        this._radiogroup.getBoundingClientRect().height
      );
      description.hideBullets = true;
    }
    this._radiogroup.style.minHeight = `${maxHeight}px`;

    if (this._prevLevel !== "custom") {
      this._selectedLevel = this._prevLevel;
      this._radiogroup.value = this._prevLevel;
    }

    this._radiogroup.addEventListener("change", () => {
      this._selectedLevel = this._radiogroup.value;
      this._updateSelected();
    });

    this._updateSelected();
  },

  /**
   * Wait for the DOM to be settled after some change.
   */
  async _settled() {
    // Wait for the widgets to react to some change.
    await Promise.all([
      this._radiogroup.updateComplete,
      ...this._radioOptions.map(({ radio }) => radio.updateComplete),
    ]);
    // Also wait for any string population.
    if (document.hasPendingL10nMutations) {
      await new Promise(r =>
        document.addEventListener("L10nMutationsFinished", r, { once: true })
      );
    }
  },

  /**
   * Update the UI in response to a change in selection.
   */
  _updateSelected() {
    this._acceptButton.disabled =
      !this._selectedLevel || this._selectedLevel === this._prevLevel;
    for (const { description, radio } of this._radioOptions) {
      description.hideBullets = !radio.checked;
    }
  },

  /**
   * Commit the change in security level and restart the browser.
   */
  async _commitChange() {
    const doNotWarnPref = "browser.security_level.disable_warn_before_restart";
    if (!Services.prefs.getBoolPref(doNotWarnPref, false)) {
      const [titleString, bodyString, checkboxString, restartString] =
        await document.l10n.formatValues([
          { id: "security-level-restart-warning-dialog-title" },
          { id: "security-level-restart-warning-dialog-body" },
          { id: "restart-warning-dialog-do-not-warn-checkbox" },
          { id: "restart-warning-dialog-restart-button" },
        ]);
      const flags =
        Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
        Services.prompt.BUTTON_POS_0_DEFAULT +
        Services.prompt.BUTTON_DEFAULT_IS_DESTRUCTIVE +
        Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_CANCEL;
      const propBag = await Services.prompt.asyncConfirmEx(
        window.browsingContext.top,
        Services.prompt.MODAL_TYPE_CONTENT,
        titleString,
        bodyString,
        flags,
        restartString,
        null,
        null,
        checkboxString,
        false,
        { useTitle: true, noIcon: true }
      );
      if (propBag.get("buttonNumClicked") !== 0) {
        return;
      }
      if (propBag.get("checked")) {
        Services.prefs.setBoolPref(doNotWarnPref, true);
      }
    }
    SecurityLevelPrefs.setSecurityLevelBeforeRestart(this._selectedLevel);
    Services.startup.quit(
      Services.startup.eAttemptQuit | Services.startup.eRestart
    );
  },
};

// Initial focus is not visible, even if opened with a keyboard. We avoid the
// default handler and manage the focus ourselves, which will paint the focus
// ring by default.
// NOTE: A side effect is that the focus ring will show even if the user opened
// with a mouse event.
// TODO: Remove this once bugzilla bug 1708261 is resolved.
document.subDialogSetDefaultFocus = () => {
  document.getElementById("security-level-radiogroup").focus();
};

// Delay showing and sizing the subdialog until it is fully initialised.
document.mozSubdialogReady = new Promise(resolve => {
  window.addEventListener(
    "DOMContentLoaded",
    () => {
      gSecurityLevelDialog.init().finally(resolve);
    },
    { once: true }
  );
});
