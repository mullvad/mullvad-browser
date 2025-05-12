"use strict";

/* global AppConstants, Services, openPreferences, XPCOMUtils, gSubDialog */

ChromeUtils.defineESModuleGetters(this, {
  SecurityLevelPrefs: "resource://gre/modules/SecurityLevel.sys.mjs",
  SecurityLevelUIUtils: "resource:///modules/SecurityLevelUIUtils.sys.mjs",
});

/*
  Security Level Button Code

  Controls init and update of the security level toolbar button
*/

var SecurityLevelButton = {
  _securityPrefsBranch: null,
  /**
   * Whether we have added popup listeners to the panel.
   *
   * @type {boolean}
   */
  _panelPopupListenersSetup: false,
  /**
   * The toolbar button element.
   *
   * @type {Element}
   */
  _button: null,
  /**
   * The button that the panel should point to. Either the toolbar button or the
   * overflow button.
   *
   * @type {Element}
   */
  _anchorButton: null,

  _configUIFromPrefs() {
    const level = SecurityLevelPrefs.securityLevelSummary;
    this._button.setAttribute("level", level);

    let l10nIdLevel;
    switch (level) {
      case "standard":
        l10nIdLevel = "security-level-toolbar-button-standard";
        break;
      case "safer":
        l10nIdLevel = "security-level-toolbar-button-safer";
        break;
      case "safest":
        l10nIdLevel = "security-level-toolbar-button-safest";
        break;
      case "custom":
        l10nIdLevel = "security-level-toolbar-button-custom";
        break;
      default:
        throw Error(`Unhandled level: ${level}`);
    }
    document.l10n.setAttributes(this._button, l10nIdLevel);
  },

  /**
   * Open the panel popup for the button.
   */
  openPopup() {
    const overflowPanel = document.getElementById("widget-overflow");
    if (overflowPanel.contains(this._button)) {
      // We are in the overflow panel.
      // We first close the overflow panel, otherwise focus will not return to
      // the nav-bar-overflow-button if the security level panel is closed with
      // "Escape" (the navigation toolbar does not track focus when a panel is
      // opened whilst another is already open).
      // NOTE: In principle, using PanelMultiView would allow us to open panels
      // from within another panel. However, when using panelmultiview for the
      // security level panel, tab navigation was broken within the security
      // level panel. PanelMultiView may be set up to work with a menu-like
      // panel rather than our dialog-like panel.
      overflowPanel.hidePopup();
      this._anchorButton = document.getElementById("nav-bar-overflow-button");
    } else {
      this._anchorButton = this._button;
    }

    const panel = SecurityLevelPanel.panel;
    if (!this._panelPopupListenersSetup) {
      this._panelPopupListenersSetup = true;
      // NOTE: We expect the _anchorButton to not change whilst the popup is
      // open.
      panel.addEventListener("popupshown", () => {
        this._anchorButton.setAttribute("open", "true");
      });
      panel.addEventListener("popuphidden", () => {
        this._anchorButton.removeAttribute("open");
      });
    }

    panel.openPopup(
      this._anchorButton.icon,
      "bottomright topright",
      0,
      0,
      false
    );
  },

  init() {
    // We first search in the DOM for the security level button. If it does not
    // exist it may be in the toolbox palette. We still want to return the
    // button in the latter case to allow it to be initialized or adjusted in
    // case it is added back through customization.
    this._button =
      document.getElementById("security-level-button") ||
      window.gNavToolbox.palette.querySelector("#security-level-button");
    // Set a label to be be used as the accessible name, and to be shown in the
    // overflow menu and during customization.
    this._button.addEventListener("command", () => this.openPopup());
    // set the initial class based off of the current pref
    this._configUIFromPrefs();

    this._securityPrefsBranch = Services.prefs.getBranch(
      "browser.security_level."
    );
    this._securityPrefsBranch.addObserver("", this);

    SecurityLevelPanel.init();
  },

  uninit() {
    this._securityPrefsBranch.removeObserver("", this);
    this._securityPrefsBranch = null;

    SecurityLevelPanel.uninit();
  },

  observe(subject, topic, data) {
    switch (topic) {
      case "nsPref:changed":
        if (data === "security_slider" || data === "security_custom") {
          this._configUIFromPrefs();
        }
        break;
    }
  },
}; /* SecurityLevelButton */

/*
  Security Level Panel Code

  Controls init and update of the panel in the security level hanger
*/

var SecurityLevelPanel = {
  _securityPrefsBranch: null,
  _populated: false,

  _populateXUL() {
    this._elements = {
      panel: document.getElementById("securityLevel-panel"),
      background: document.getElementById("securityLevel-background"),
      levelName: document.getElementById("securityLevel-level"),
      summary: document.getElementById("securityLevel-summary"),
    };

    const learnMoreEl = document.getElementById("securityLevel-learnMore");
    learnMoreEl.addEventListener("click", () => {
      this.hide();
    });

    document
      .getElementById("securityLevel-settings")
      .addEventListener("command", () => {
        this.openSecuritySettings();
      });

    this._elements.panel.addEventListener("popupshown", () => {
      // Bring focus into the panel by focusing the default button.
      this._elements.panel.querySelector('button[default="true"]').focus();
    });

    this._populated = true;
    this._configUIFromPrefs();
  },

  _configUIFromPrefs() {
    if (!this._populated) {
      return;
    }

    // get security prefs
    const level = SecurityLevelPrefs.securityLevelSummary;

    // Descriptions change based on security level
    this._elements.background.setAttribute("level", level);
    let l10nIdLevel;
    let l10nIdSummary;
    switch (level) {
      case "standard":
        l10nIdLevel = "security-level-panel-level-standard";
        l10nIdSummary = "security-level-summary-standard";
        break;
      case "safer":
        l10nIdLevel = "security-level-panel-level-safer";
        l10nIdSummary = "security-level-summary-safer";
        break;
      case "safest":
        l10nIdLevel = "security-level-panel-level-safest";
        l10nIdSummary = "security-level-summary-safest";
        break;
      case "custom":
        l10nIdLevel = "security-level-panel-level-custom";
        l10nIdSummary = "security-level-summary-custom";
        break;
      default:
        throw Error(`Unhandled level: ${level}`);
    }

    document.l10n.setAttributes(this._elements.levelName, l10nIdLevel);
    document.l10n.setAttributes(this._elements.summary, l10nIdSummary);
  },

  /**
   * The popup element.
   *
   * @type {MozPanel}
   */
  get panel() {
    if (!this._populated) {
      this._populateXUL();
    }
    return this._elements.panel;
  },

  init() {
    this._securityPrefsBranch = Services.prefs.getBranch(
      "browser.security_level."
    );
    this._securityPrefsBranch.addObserver("", this);
  },

  uninit() {
    this._securityPrefsBranch.removeObserver("", this);
    this._securityPrefsBranch = null;
  },

  hide() {
    this._elements.panel.hidePopup();
  },

  openSecuritySettings() {
    openPreferences("privacy-securitylevel");
    this.hide();
  },

  // callback when prefs change
  observe(subject, topic, data) {
    switch (topic) {
      case "nsPref:changed":
        if (data == "security_slider" || data == "security_custom") {
          this._configUIFromPrefs();
        }
        break;
    }
  },
}; /* SecurityLevelPanel */

/*
  Security Level Preferences Code

  Code to handle init and update of security level section in about:preferences#privacy
*/

var SecurityLevelPreferences = {
  _securityPrefsBranch: null,

  /**
   * The element that shows the current security level.
   *
   * @type {?Element}
   */
  _currentEl: null,

  _populateXUL() {
    this._currentEl = document.getElementById("security-level-current");
    const changeButton = document.getElementById("security-level-change");
    const badgeEl = this._currentEl.querySelector(
      ".security-level-current-badge"
    );

    for (const { level, nameId } of [
      { level: "standard", nameId: "security-level-panel-level-standard" },
      { level: "safer", nameId: "security-level-panel-level-safer" },
      { level: "safest", nameId: "security-level-panel-level-safest" },
      { level: "custom", nameId: "security-level-panel-level-custom" },
    ]) {
      // Classes that control visibility:
      // security-level-current-standard
      // security-level-current-safer
      // security-level-current-safest
      // security-level-current-custom
      const visibilityClass = `security-level-current-${level}`;
      const nameEl = document.createElement("div");
      nameEl.classList.add("security-level-name", visibilityClass);
      document.l10n.setAttributes(nameEl, nameId);

      const descriptionEl = SecurityLevelUIUtils.createDescriptionElement(
        level,
        document
      );
      descriptionEl.classList.add(visibilityClass);

      this._currentEl.insertBefore(nameEl, badgeEl);
      this._currentEl.insertBefore(descriptionEl, changeButton);
    }

    changeButton.addEventListener("click", () => {
      this._openDialog();
    });
  },

  _openDialog() {
    gSubDialog.open(
      "chrome://browser/content/securitylevel/securityLevelDialog.xhtml",
      { features: "resizable=yes" }
    );
  },

  _configUIFromPrefs() {
    // Set a data-current-level attribute for showing the current security
    // level, and hiding the rest.
    this._currentEl.dataset.currentLevel =
      SecurityLevelPrefs.securityLevelSummary;
  },

  init() {
    // populate XUL with localized strings
    this._populateXUL();

    // read prefs and populate UI
    this._configUIFromPrefs();

    // register for pref chagnes
    this._securityPrefsBranch = Services.prefs.getBranch(
      "browser.security_level."
    );
    this._securityPrefsBranch.addObserver("", this);
  },

  uninit() {
    // unregister for pref change events
    this._securityPrefsBranch.removeObserver("", this);
    this._securityPrefsBranch = null;
  },

  // callback for when prefs change
  observe(subject, topic, data) {
    switch (topic) {
      case "nsPref:changed":
        if (data == "security_slider" || data == "security_custom") {
          this._configUIFromPrefs();
        }
        break;
    }
  },
}; /* SecurityLevelPreferences */
