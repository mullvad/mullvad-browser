"use strict";

const { SecurityLevelPrefs } = ChromeUtils.importESModule(
  "resource://gre/modules/SecurityLevel.sys.mjs"
);
const { SecurityLevelUIUtils } = ChromeUtils.importESModule(
  "resource:///modules/SecurityLevelUIUtils.sys.mjs"
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
   * A list of radio options and their containers.
   *
   * @type {?Array<{ container: Element, radio: Element }>}
   */
  _radioOptions: null,

  /**
   * Initialise the dialog.
   */
  async init() {
    const dialog = document.getElementById("security-level-dialog");
    dialog.addEventListener("dialogaccept", event => {
      if (this._acceptButton.disabled) {
        event.preventDefault();
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
      this._radiogroup.querySelectorAll(".security-level-radio-container"),
      container => {
        return {
          container,
          radio: container.querySelector(".security-level-radio"),
        };
      }
    );

    for (const { container, radio } of this._radioOptions) {
      const level = radio.value;
      radio.id = `security-level-radio-${level}`;
      const currentEl = container.querySelector(
        ".security-level-current-badge"
      );
      currentEl.id = `security-level-current-badge-${level}`;
      const descriptionEl = SecurityLevelUIUtils.createDescriptionElement(
        level,
        document
      );
      descriptionEl.classList.add("indent");
      descriptionEl.id = `security-level-description-${level}`;

      // Wait for the full translation of the element before adding it to the
      // DOM. In particular, we want to make sure the elements have text before
      // we measure the maxHeight below.
      await document.l10n.translateFragment(descriptionEl);
      document.l10n.pauseObserving();
      container.append(descriptionEl);
      document.l10n.resumeObserving();

      if (level === this._prevLevel) {
        currentEl.hidden = false;
        // When the currentEl is visible, include it in the accessible name for
        // the radio option.
        // NOTE: The currentEl has an accessible name which includes punctuation
        // to help separate it's content from the security level name.
        // E.g. "Standard (Current level)".
        radio.setAttribute("aria-labelledby", `${radio.id} ${currentEl.id}`);
      } else {
        currentEl.hidden = true;
      }
      // We point the accessible description to the wrapping
      // .security-level-description element, rather than its children
      // that define the actual text content. This means that when the
      // privacy-extra-information is shown or hidden, its text content is
      // included or excluded from the accessible description, respectively.
      radio.setAttribute("aria-describedby", descriptionEl.id);
    }

    // We want to reserve the maximum height of the radiogroup so that the
    // dialog has enough height when the user switches options. So we cycle
    // through the options and measure the height when they are selected to set
    // a minimum height that fits all of them.
    // NOTE: At the time of implementation, at this point the dialog may not
    // yet have the "subdialog" attribute, which means it is missing the
    // common.css stylesheet from its shadow root, which effects the size of the
    // .radio-check element and the font. Therefore, we have duplicated the
    // import of common.css in SecurityLevelDialog.xhtml to ensure it is applied
    // at this earlier stage.
    let maxHeight = 0;
    for (const { container } of this._radioOptions) {
      container.classList.add("selected");
      maxHeight = Math.max(
        maxHeight,
        this._radiogroup.getBoundingClientRect().height
      );
      container.classList.remove("selected");
    }
    this._radiogroup.style.minHeight = `${maxHeight}px`;

    if (this._prevLevel !== "custom") {
      this._selectedLevel = this._prevLevel;
      this._radiogroup.value = this._prevLevel;
    } else {
      this._radiogroup.selectedItem = null;
    }

    this._radiogroup.addEventListener("select", () => {
      this._selectedLevel = this._radiogroup.value;
      this._updateSelected();
    });

    this._updateSelected();
  },

  /**
   * Update the UI in response to a change in selection.
   */
  _updateSelected() {
    this._acceptButton.disabled =
      !this._selectedLevel || this._selectedLevel === this._prevLevel;
    // Have the container's `selected` CSS class match the selection state of
    // the radio elements.
    for (const { container, radio } of this._radioOptions) {
      container.classList.toggle("selected", radio.selected);
    }
  },

  /**
   * Commit the change in security level and restart the browser.
   */
  _commitChange() {
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
