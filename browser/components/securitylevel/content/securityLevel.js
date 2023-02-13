"use strict";

/* global AppConstants, Services, openPreferences, XPCOMUtils */

ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetters(this, {
  CustomizableUI: "resource:///modules/CustomizableUI.jsm",
  PanelMultiView: "resource:///modules/PanelMultiView.jsm",
});

const SecurityLevels = Object.freeze(["", "safest", "safer", "", "standard"]);

XPCOMUtils.defineLazyGetter(this, "SecurityLevelStrings", () => {
  let strings = {
    // Generic terms
    security_level: "Security Level",
    security_level_standard: "Standard",
    security_level_safer: "Safer",
    security_level_safest: "Safest",
    security_level_tooltip_standard: "Security Level: Standard",
    security_level_tooltip_safer: "Security Level: Safer",
    security_level_tooltip_safest: "Security Level: Safest",
    // Shown only for custom level
    security_level_custom: "Custom",
    security_level_restore: "Restore Defaults",
    security_level_learn_more: "Learn more",
    // Panel
    security_level_change: "Change…",
    security_level_standard_summary:
      "All browser and website features are enabled.",
    security_level_safer_summary:
      "Disables website features that are often dangerous, causing some sites to lose functionality.",
    security_level_safest_summary:
      "Only allows website features required for static sites and basic services. These changes affect images, media, and scripts.",
    security_level_custom_summary:
      "Your custom browser preferences have resulted in unusual security settings. For security and privacy reasons, we recommend you choose one of the default security levels.",
    // Security level section in about:preferences#privacy
    security_level_overview:
      "Disable certain web features that can be used to attack your security and anonymity.",
    security_level_list_safer: "At the safer setting:",
    security_level_list_safest: "At the safest setting:",
    // Strings for descriptions
    security_level_js_https_only: "JavaScript is disabled on non-HTTPS sites.",
    security_level_js_disabled:
      "JavaScript is disabled by default on all sites.",
    security_level_limit_typography:
      "Some fonts and math symbols are disabled.",
    security_level_limit_typography_svg:
      "Some fonts, icons, math symbols, and images are disabled.",
    security_level_limit_media:
      "Audio and video (HTML5 media), and WebGL are click-to-play.",
  };
  let bundle = null;
  try {
    bundle = Services.strings.createBundle(
      "chrome://browser/locale/securityLevel.properties"
    );
  } catch (e) {
    console.warn("Could not load the Security Level strings");
  }
  if (bundle) {
    for (const key of Object.keys(strings)) {
      try {
        strings[key] = bundle.GetStringFromName(key);
      } catch (e) {}
    }
  }
  return strings;
});

/*
  Security Level Prefs

  Getters and Setters for relevant torbutton prefs
*/
const SecurityLevelPrefs = {
  security_slider_pref: "browser.security_level.security_slider",
  security_custom_pref: "browser.security_level.security_custom",

  get securitySlider() {
    try {
      return Services.prefs.getIntPref(this.security_slider_pref);
    } catch (e) {
      // init pref to 4 (standard)
      const val = 4;
      Services.prefs.setIntPref(this.security_slider_pref, val);
      return val;
    }
  },

  set securitySlider(val) {
    Services.prefs.setIntPref(this.security_slider_pref, val);
  },

  get securitySliderLevel() {
    const slider = this.securitySlider;
    if (slider >= 1 && slider <= 4 && SecurityLevels[slider]) {
      return SecurityLevels[slider];
    }
    return null;
  },

  get securityCustom() {
    try {
      return Services.prefs.getBoolPref(this.security_custom_pref);
    } catch (e) {
      // init custom to false
      const val = false;
      Services.prefs.setBoolPref(this.security_custom_pref, val);
      return val;
    }
  },

  set securityCustom(val) {
    Services.prefs.setBoolPref(this.security_custom_pref, val);
  },
}; /* Security Level Prefs */

/*
  Security Level Button Code

  Controls init and update of the security level toolbar button
*/

const SecurityLevelButton = {
  _securityPrefsBranch: null,

  _configUIFromPrefs() {
    const securityLevelButton = this.button;
    if (securityLevelButton != null) {
      const level = SecurityLevelPrefs.securitySliderLevel;
      if (!level) {
        return;
      }
      const customStr = SecurityLevelPrefs.securityCustom ? "_custom" : "";
      securityLevelButton.setAttribute("level", `${level}${customStr}`);
      securityLevelButton.setAttribute(
        "tooltiptext",
        SecurityLevelStrings[`security_level_tooltip_${level}`]
      );
    }
  },

  /**
   * The node for this button.
   *
   * Note, the returned element may be part of the DOM or may live in the
   * toolbox palette, where it may be added later to the DOM through
   * customization.
   *
   * @type {MozToolbarbutton}
   */
  get button() {
    // We first search in the DOM for the security level button. If it does not
    // exist it may be in the toolbox palette. We still want to return the
    // button in the latter case to allow it to be initialized or adjusted in
    // case it is added back through customization.
    return (
      document.getElementById("security-level-button") ||
      window.gNavToolbox.palette.querySelector("#security-level-button")
    );
  },

  get anchor() {
    let button = this.button;
    let anchor = button?.icon;
    if (!anchor) {
      return null;
    }

    anchor.setAttribute("consumeanchor", button.id);
    return anchor;
  },

  init() {
    // Set a label to be be used as the accessible name, and to be shown in the
    // overflow menu and during customization.
    this.button?.setAttribute("label", SecurityLevelStrings.security_level);
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

  // for when the toolbar button needs to be activated and displays the Security Level panel
  //
  // In the toolbarbutton xul you'll notice we register this callback for both onkeypress and
  // onmousedown. We do this to match the behavior of other panel spawning buttons such as Downloads,
  // Library, and the Hamburger menus. Using oncommand alone would result in only getting fired
  // after onclick, which is mousedown followed by mouseup.
  onCommand(aEvent) {
    // snippet borrowed from /browser/components/downloads/content/indicator.js DownloadsIndicatorView.onCommand(evt)
    if (
      // On Mac, ctrl-click will send a context menu event from the widget, so
      // we don't want to bring up the panel when ctrl key is pressed.
      (aEvent.type == "mousedown" &&
        (aEvent.button != 0 ||
          (AppConstants.platform == "macosx" && aEvent.ctrlKey))) ||
      (aEvent.type == "keypress" && aEvent.key != " " && aEvent.key != "Enter")
    ) {
      return;
    }

    // we need to set this attribute for the button to be shaded correctly to look like it is pressed
    // while the security level panel is open
    this.button.setAttribute("open", "true");
    SecurityLevelPanel.show();
    aEvent.stopPropagation();
  },
}; /* Security Level Button */

/*
  Security Level Panel Code

  Controls init and update of the panel in the security level hanger
*/

const SecurityLevelPanel = {
  _securityPrefsBranch: null,
  _panel: null,
  _anchor: null,
  _populated: false,

  _selectors: Object.freeze({
    panel: "panel#securityLevel-panel",
    icon: "vbox#securityLevel-vbox>vbox",
    labelLevel: "label#securityLevel-level",
    labelCustom: "label#securityLevel-custom",
    summary: "description#securityLevel-summary",
    restoreDefaults: "button#securityLevel-restoreDefaults",
    advancedSecuritySettings: "button#securityLevel-advancedSecuritySettings",
    // Selectors used only for l10n - remove them when switching to Fluent
    header: "#securityLevel-header",
    learnMore: "#securityLevel-panel .learnMore",
  }),

  _populateXUL() {
    let selectors = this._selectors;

    this._elements = {
      panel: document.querySelector(selectors.panel),
      icon: document.querySelector(selectors.icon),
      labelLevel: document.querySelector(selectors.labelLevel),
      labelCustom: document.querySelector(selectors.labelCustom),
      summaryDescription: document.querySelector(selectors.summary),
      restoreDefaultsButton: document.querySelector(selectors.restoreDefaults),
      advancedSecuritySettings: document.querySelector(
        selectors.advancedSecuritySettings
      ),
      header: document.querySelector(selectors.header),
      learnMore: document.querySelector(selectors.learnMore),
    };

    this._elements.header.textContent = SecurityLevelStrings.security_level;
    this._elements.labelCustom.setAttribute(
      "value",
      SecurityLevelStrings.security_level_custom
    );
    this._elements.learnMore.setAttribute(
      "value",
      SecurityLevelStrings.security_level_learn_more
    );
    this._elements.restoreDefaultsButton.textContent =
      SecurityLevelStrings.security_level_restore;
    this._elements.advancedSecuritySettings.textContent =
      SecurityLevelStrings.security_level_change;

    this._elements.panel.addEventListener("onpopupshown", e => {
      this.onPopupShown(e);
    });
    this._elements.panel.addEventListener("onpopuphidden", e => {
      this.onPopupHidden(e);
    });
    this._elements.restoreDefaultsButton.addEventListener("command", () => {
      this.restoreDefaults();
    });
    this._elements.advancedSecuritySettings.addEventListener("command", () => {
      this.openAdvancedSecuritySettings();
    });
    this._populated = true;
    this._configUIFromPrefs();
  },

  _configUIFromPrefs() {
    if (!this._populated) {
      console.warn("_configUIFromPrefs before XUL was populated.");
      return;
    }

    // get security prefs
    const level = SecurityLevelPrefs.securitySliderLevel;
    const custom = SecurityLevelPrefs.securityCustom;

    // only visible when user is using custom settings
    let labelCustomWarning = this._elements.labelCustom;
    labelCustomWarning.hidden = !custom;
    let buttonRestoreDefaults = this._elements.restoreDefaultsButton;
    buttonRestoreDefaults.hidden = !custom;

    const summary = this._elements.summaryDescription;
    // Descriptions change based on security level
    if (level) {
      this._elements.icon.setAttribute("level", level);
      this._elements.labelLevel.setAttribute(
        "value",
        SecurityLevelStrings[`security_level_${level}`]
      );
      summary.textContent =
        SecurityLevelStrings[`security_level_${level}_summary`];
    }
    // override the summary text with custom warning
    if (custom) {
      summary.textContent = SecurityLevelStrings.security_level_custom_summary;
    }
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

  show() {
    // we have to defer this until after the browser has finished init'ing
    // before we can populate the panel
    if (!this._populated) {
      this._populateXUL();
    }

    this._elements.panel.hidden = false;
    PanelMultiView.openPopup(
      this._elements.panel,
      SecurityLevelButton.anchor,
      "bottomcenter topright",
      0,
      0,
      false,
      null
    ).catch(Cu.reportError);
  },

  hide() {
    PanelMultiView.hidePopup(this._elements.panel);
  },

  restoreDefaults() {
    SecurityLevelPrefs.securityCustom = false;
    // hide and reshow so that layout re-renders properly
    this.hide();
    this.show(this._anchor);
  },

  openAdvancedSecuritySettings() {
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

  // callback when the panel is displayed
  onPopupShown(event) {
    SecurityLevelButton.button.setAttribute("open", "true");
  },

  // callback when the panel is hidden
  onPopupHidden(event) {
    SecurityLevelButton.button.removeAttribute("open");
  },
}; /* Security Level Panel */

/*
  Security Level Preferences Code

  Code to handle init and update of security level section in about:preferences#privacy
*/

const SecurityLevelPreferences = {
  _securityPrefsBranch: null,

  _populateXUL() {
    const groupbox = document.querySelector("#securityLevel-groupbox");
    const radiogroup = groupbox.querySelector("#securityLevel-radiogroup");
    radiogroup.addEventListener(
      "command",
      SecurityLevelPreferences.selectSecurityLevel
    );

    groupbox.querySelector("h2").textContent =
      SecurityLevelStrings.security_level;
    groupbox.querySelector("#securityLevel-overview").textContent =
      SecurityLevelStrings.security_level_overview;
    groupbox
      .querySelector("#securityLevel-learnMore")
      .setAttribute("value", SecurityLevelStrings.security_level_learn_more);

    const populateRadioElements = (level, descr) => {
      const vbox = groupbox.querySelector(`#securityLevel-vbox-${level}`);
      vbox
        .querySelector("radio")
        .setAttribute("label", SecurityLevelStrings[`security_level_${level}`]);
      vbox
        .querySelector(".securityLevel-customWarning")
        .setAttribute("value", SecurityLevelStrings.security_level_custom);
      vbox.querySelector(".summary").textContent =
        SecurityLevelStrings[`security_level_${level}_summary`];
      const labelRestoreDefaults = vbox.querySelector(
        ".securityLevel-restoreDefaults"
      );
      labelRestoreDefaults.setAttribute(
        "value",
        SecurityLevelStrings.security_level_restore
      );
      labelRestoreDefaults.addEventListener(
        "click",
        SecurityLevelStrings.restoreDefaults
      );
      if (descr) {
        const descrList = vbox.querySelector(".securityLevel-descriptionList");
        // TODO: Add the elements in securityLevelPreferences.inc.xhtml again
        // when we switch to Fluent
        for (const text of descr) {
          let elem = document.createXULElement("description");
          elem.textContent = text;
          elem.className = "indent";
          descrList.append(elem);
        }
      }
    };
    populateRadioElements("standard");
    populateRadioElements("safer", [
      SecurityLevelStrings.security_level_js_https_only,
      SecurityLevelStrings.security_level_limit_typography,
      SecurityLevelStrings.security_level_limit_media,
    ]);
    populateRadioElements("safest", [
      SecurityLevelStrings.security_level_js_disabled,
      SecurityLevelStrings.security_level_limit_typography_svg,
      SecurityLevelStrings.security_level_limit_media,
    ]);
  },

  _configUIFromPrefs() {
    // read our prefs
    const securitySlider = SecurityLevelPrefs.securitySlider;
    const securityCustom = SecurityLevelPrefs.securityCustom;

    // get our elements
    const groupbox = document.querySelector("#securityLevel-groupbox");
    let radiogroup = groupbox.querySelector("#securityLevel-radiogroup");
    let labelStandardCustom = groupbox.querySelector(
      "#securityLevel-vbox-standard label.securityLevel-customWarning"
    );
    let labelSaferCustom = groupbox.querySelector(
      "#securityLevel-vbox-safer label.securityLevel-customWarning"
    );
    let labelSafestCustom = groupbox.querySelector(
      "#securityLevel-vbox-safest label.securityLevel-customWarning"
    );
    let labelStandardRestoreDefaults = groupbox.querySelector(
      "#securityLevel-vbox-standard label.securityLevel-restoreDefaults"
    );
    let labelSaferRestoreDefaults = groupbox.querySelector(
      "#securityLevel-vbox-safer label.securityLevel-restoreDefaults"
    );
    let labelSafestRestoreDefaults = groupbox.querySelector(
      "#securityLevel-vbox-safest label.securityLevel-restoreDefaults"
    );

    // hide custom label by default until we know which level we're at
    labelStandardCustom.hidden = true;
    labelSaferCustom.hidden = true;
    labelSafestCustom.hidden = true;

    labelStandardRestoreDefaults.hidden = true;
    labelSaferRestoreDefaults.hidden = true;
    labelSafestRestoreDefaults.hidden = true;

    switch (securitySlider) {
      // standard
      case 4:
        radiogroup.value = "standard";
        labelStandardCustom.hidden = !securityCustom;
        labelStandardRestoreDefaults.hidden = !securityCustom;
        break;
      // safer
      case 2:
        radiogroup.value = "safer";
        labelSaferCustom.hidden = !securityCustom;
        labelSaferRestoreDefaults.hidden = !securityCustom;
        break;
      // safest
      case 1:
        radiogroup.value = "safest";
        labelSafestCustom.hidden = !securityCustom;
        labelSafestRestoreDefaults.hidden = !securityCustom;
        break;
    }
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

  selectSecurityLevel() {
    // radio group elements
    let radiogroup = document.getElementById("securityLevel-radiogroup");

    // update pref based on selected radio option
    switch (radiogroup.value) {
      case "standard":
        SecurityLevelPrefs.securitySlider = 4;
        break;
      case "safer":
        SecurityLevelPrefs.securitySlider = 2;
        break;
      case "safest":
        SecurityLevelPrefs.securitySlider = 1;
        break;
    }

    SecurityLevelPreferences.restoreDefaults();
  },

  restoreDefaults() {
    SecurityLevelPrefs.securityCustom = false;
  },
}; /* Security Level Prefereces */

Object.defineProperty(this, "SecurityLevelButton", {
  value: SecurityLevelButton,
  enumerable: true,
  writable: false,
});

Object.defineProperty(this, "SecurityLevelPanel", {
  value: SecurityLevelPanel,
  enumerable: true,
  writable: false,
});

Object.defineProperty(this, "SecurityLevelPreferences", {
  value: SecurityLevelPreferences,
  enumerable: true,
  writable: false,
});
