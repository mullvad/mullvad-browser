/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import * as RFPTargetConstants from "resource://gre/modules/RFPTargetConstants.sys.mjs";

const kPrefResistFingerprinting = "privacy.resistFingerprinting";
const kPrefSpoofEnglish = "privacy.spoof_english";
const kTopicHttpOnModifyRequest = "http-on-modify-request";

const kPrefLetterboxing = "privacy.resistFingerprinting.letterboxing";
const kPrefLetterboxingDimensions =
  "privacy.resistFingerprinting.letterboxing.dimensions";
const kPrefLetterboxingTesting =
  "privacy.resistFingerprinting.letterboxing.testing";
const kPrefLetterboxingVcenter =
  "privacy.resistFingerprinting.letterboxing.vcenter";

const kTopicDOMWindowOpened = "domwindowopened";
const kTopicDOMWindowClosed = "domwindowclosed";

const kPrefVerticalTabs = "sidebar.verticalTabs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  Color: "resource://gre/modules/Color.sys.mjs",
});
ChromeUtils.defineLazyGetter(lazy, "logConsole", () =>
  console.createInstance({
    prefix: "RFPHelper",
    maxLogLevelPref: "privacy.resistFingerprinting.jsmloglevel",
  })
);

function log(...args) {
  lazy.logConsole.log(...args);
}

class _RFPHelper {
  _resizeObservers = new WeakMap();

  // Track the observer status. It looks like pref changes can be notified
  // also if the pref is actually unchanged. This might be a tests-only issue
  // where we repeatedly push the prefs. See bug 1992137.
  _letterboxingPrefObserversAdded = false;

  // ============================================================================
  // Shared Setup
  // ============================================================================
  constructor() {
    this._initialized = false;
  }

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    // Add unconditional observers
    Services.prefs.addObserver(kPrefResistFingerprinting, this);
    Services.prefs.addObserver(kPrefLetterboxing, this);
    Services.prefs.addObserver(kPrefLetterboxingVcenter, this);
    Services.prefs.addObserver(kPrefVerticalTabs, this);

    XPCOMUtils.defineLazyPreferenceGetter(
      this,
      "_letterboxingDimensions",
      kPrefLetterboxingDimensions,
      "",
      null,
      this._parseLetterboxingDimensions
    );
    XPCOMUtils.defineLazyPreferenceGetter(
      this,
      "_isLetterboxingTesting",
      kPrefLetterboxingTesting,
      false
    );

    // Add RFP and Letterboxing observers if prefs are enabled
    this._handleResistFingerprintingChanged();
    this._handleLetterboxingPrefChanged();

    // Synchronize language preferences if accidentally messed up (tor-browser#42084)
    this._handleSpoofEnglishChanged();
  }

  uninit() {
    if (!this._initialized) {
      return;
    }
    this._initialized = false;

    // Remove unconditional observers
    Services.prefs.removeObserver(kPrefResistFingerprinting, this);
    Services.prefs.removeObserver(kPrefLetterboxingVcenter, this);
    Services.prefs.removeObserver(kPrefLetterboxing, this);
    Services.prefs.removeObserver(kPrefVerticalTabs, this);
    // Remove the RFP observers, swallowing exceptions if they weren't present
    this._removeLanguagePrefObservers();
    // Added in _handleSpoofEnglishChanged.
    Services.prefs.removeObserver("intl.accept_languages", this);
  }

  observe(subject, topic, data) {
    switch (topic) {
      case "nsPref:changed":
        this._handlePrefChanged(data);
        break;
      case kTopicHttpOnModifyRequest:
        this._handleHttpOnModifyRequest(subject, data);
        break;
      case kTopicDOMWindowOpened:
        // We attach to the newly created window by adding tabsProgressListener
        // and event listener on it. We listen for new tabs being added or
        // the change of the content principal and round browser sizes accordingly.
        this._handleDOMWindowOpened(subject);
        break;
      case kTopicDOMWindowClosed:
        this._handleDOMWindowClosed(subject);
        break;
      default:
        break;
    }
  }

  handleEvent(aMessage) {
    switch (aMessage.type) {
      case "TabOpen": {
        let browser = aMessage.target.linkedBrowser;
        this._roundOrResetContentSize(browser, /* isNewTab = */ true);
        let resizeObserver = this._resizeObservers.get(browser.documentGlobal);
        resizeObserver.observe(browser.parentElement);
        break;
      }
      case "nativethemechange":
        // NOTE: "nativethemechange" seems to always be sent after
        // "windowlwthemeupdate". So all the lwtheme CSS properties should be
        // set to the new theme's values already, so we don't need to wait for
        // windowlwthemeupdate.
        this._updateLetterboxingColors(aMessage.currentTarget, true);
        break;
      default:
        break;
    }
  }

  _handlePrefChanged(data) {
    switch (data) {
      case kPrefResistFingerprinting:
        this._handleResistFingerprintingChanged();
        break;
      case kPrefSpoofEnglish:
      case "intl.accept_languages":
        this._handleSpoofEnglishChanged();
        break;
      case kPrefLetterboxing:
      case kPrefLetterboxingVcenter:
        this._handleLetterboxingPrefChanged();
        break;
      case kPrefVerticalTabs:
        if (this.letterboxingEnabled) {
          forEachWindow(win => this._updateLetterboxingColors(win));
        }
        break;
      default:
        break;
    }
  }

  // ============================================================================
  // Language Prompt
  // ============================================================================
  _addLanguagePrefObservers() {
    Services.prefs.addObserver(kPrefSpoofEnglish, this);
    if (this._shouldPromptForLanguagePref()) {
      Services.obs.addObserver(this, kTopicHttpOnModifyRequest);
    }
  }

  _removeLanguagePrefObservers() {
    try {
      Services.prefs.removeObserver(kPrefSpoofEnglish, this);
    } catch (e) {
      // do nothing
    }
    try {
      Services.obs.removeObserver(this, kTopicHttpOnModifyRequest);
    } catch (e) {
      // do nothing
    }
  }

  _handleResistFingerprintingChanged() {
    this.rfpEnabled = Services.prefs.getBoolPref(kPrefResistFingerprinting);
    if (ChromeUtils.shouldResistFingerprinting("JSLocalePrompt", null)) {
      this._addLanguagePrefObservers();
    } else {
      this._removeLanguagePrefObservers();
    }
  }

  _handleSpoofEnglishChanged() {
    Services.prefs.removeObserver("intl.accept_languages", this);
    switch (Services.prefs.getIntPref(kPrefSpoofEnglish)) {
      case 0: // will prompt
      // This should only happen when turning privacy.resistFingerprinting off.
      // Works like disabling accept-language spoofing.
      // fall through
      case 1: // don't spoof
        if (this.rfpEnabled) {
          // When RFP is enabled, we force intl.accept_languages to be the
          // default, or en-US, en when spoof English is enabled.
          // See tor-browser#41930.
          Services.prefs.clearUserPref("intl.accept_languages");
          Services.prefs.addObserver("intl.accept_languages", this);
        }
        break;
      case 2: // spoof
        Services.prefs.setCharPref("intl.accept_languages", "en-US, en");
        // Ensure spoofing works if preferences are set out of order
        Services.prefs.addObserver("intl.accept_languages", this);
        break;
      default:
        break;
    }
  }

  _shouldPromptForLanguagePref() {
    return (
      Services.locale.appLocaleAsBCP47.substr(0, 2) !== "en" &&
      Services.prefs.getIntPref(kPrefSpoofEnglish) === 0
    );
  }

  _handleHttpOnModifyRequest(subject) {
    // If we are loading an HTTP page from content, show the
    // "request English language web pages?" prompt.
    let httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);

    let notificationCallbacks = httpChannel.notificationCallbacks;
    if (!notificationCallbacks) {
      return;
    }

    let loadContext = notificationCallbacks.getInterface(Ci.nsILoadContext);
    if (!loadContext || !loadContext.isContent) {
      return;
    }

    if (!subject.URI.schemeIs("http") && !subject.URI.schemeIs("https")) {
      return;
    }
    // The above QI did not throw, the scheme is http[s], and we know the
    // load context is content, so we must have a true HTTP request from content.
    // Stop the observer and display the prompt if another window has
    // not already done so.
    Services.obs.removeObserver(this, kTopicHttpOnModifyRequest);

    if (!this._shouldPromptForLanguagePref()) {
      return;
    }

    this._promptForLanguagePreference();

    // The Accept-Language header for this request was set when the
    // channel was created. Reset it to match the value that will be
    // used for future requests.
    let val = this._getCurrentAcceptLanguageValue(subject.URI);
    if (val) {
      httpChannel.setRequestHeader("Accept-Language", val, false);
    }
  }

  _promptForLanguagePreference() {
    // Display two buttons, both with string titles.
    const l10n = new Localization(
      ["toolkit/global/resistFingerPrinting.ftl"],
      true
    );
    const message = l10n.formatValueSync("privacy-spoof-english");
    const flags = Services.prompt.STD_YES_NO_BUTTONS;
    const response = Services.prompt.confirmEx(
      null,
      "",
      message,
      flags,
      null,
      null,
      null,
      null,
      { value: false }
    );

    // Update preferences to reflect their response and to prevent the prompt
    // from being displayed again.
    Services.prefs.setIntPref(kPrefSpoofEnglish, response == 0 ? 2 : 1);
  }

  _getCurrentAcceptLanguageValue(uri) {
    let channel = Services.io.newChannelFromURI(
      uri,
      null, // aLoadingNode
      Services.scriptSecurityManager.getSystemPrincipal(),
      null, // aTriggeringPrincipal
      Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      Ci.nsIContentPolicy.TYPE_OTHER
    );
    let httpChannel;
    try {
      httpChannel = channel.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) {
      return null;
    }
    return httpChannel.getRequestHeader("Accept-Language");
  }

  // ==============================================================================
  // Letterboxing
  // ============================================================================
  /**
   * We use the TabsProgressListener to catch the change of the content
   * principal. We would reset browser size if it is the system principal.
   */
  onLocationChange(aBrowser) {
    this._roundOrResetContentSize(aBrowser);
  }

  _handleLetterboxingPrefChanged() {
    if (Services.prefs.getBoolPref(kPrefLetterboxing, false)) {
      if (!this._letterboxingPrefObserversAdded) {
        Services.ww.registerNotification(this);
        this._letterboxingPrefObserversAdded = true;
      }
      this._attachAllWindows();
    } else {
      this._detachAllWindows();
      if (this._letterboxingPrefObserversAdded) {
        Services.ww.unregisterNotification(this);
        this._letterboxingPrefObserversAdded = false;
      }
    }
  }

  // The function to parse the dimension set from the pref value. The pref value
  // should be formated as 'width1xheight1, width2xheight2, ...'. For
  // example, '100x100, 200x200, 400x200 ...'.
  _parseLetterboxingDimensions(aPrefValue) {
    if (!aPrefValue || !aPrefValue.match(/^(?:\d+x\d+,\s*)*(?:\d+x\d+)$/)) {
      if (aPrefValue) {
        console.error(
          `Invalid pref value for ${kPrefLetterboxingDimensions}: ${aPrefValue}`
        );
      }
      return [];
    }

    return aPrefValue.split(",").map(item => {
      let sizes = item.split("x").map(size => parseInt(size, 10));

      return {
        width: sizes[0],
        height: sizes[1],
      };
    });
  }

  getLetterboxingDefaultRule(document) {
    // If not already cached on the document object, traverse the CSSOM and
    // find the rule applying the default letterboxing styles to browsers
    // preemptively in order to beat race conditions on tab/window creation
    return (document._letterboxingDefaultRule ||= (() => {
      const LETTERBOX_CSS_SELECTOR = ".letterboxing";
      const LETTERBOX_CSS_URL =
        "chrome://global/content/resistfingerprinting/letterboxing.css";
      for (let ss of document.styleSheets) {
        if (ss.href != LETTERBOX_CSS_URL) {
          continue;
        }
        for (let rule of ss.rules) {
          if (rule.selectorText == LETTERBOX_CSS_SELECTOR) {
            return rule;
          }
        }
      }
      lazy.logConsole.error("Letterboxing rule not found!");
      return null; // shouldn't happen
    })());
  }

  _noLetterBoxingFor({ contentPrincipal, currentURI }) {
    // we don't want letterboxing on...
    return (
      // ... privileged pages
      contentPrincipal.isSystemPrincipal ||
      // pdf.js
      contentPrincipal.origin.startsWith("resource://pdf.js") ||
      // ... about: URIs EXCEPT about:blank and about:srcdoc
      // (see IsContentAccessibleAboutURI)
      (currentURI.schemeIs("about") &&
        currentURI.filePath != "blank" &&
        currentURI.filePath != "srcdoc") ||
      // ... source code
      currentURI.schemeIs("view-source") ||
      // ... browser extensions
      contentPrincipal.addonPolicy
    );
  }

  _roundOrResetContentSize(aBrowser, isNewTab = false) {
    // We won't do anything for lazy browsers.
    if (!aBrowser?.isConnected) {
      return;
    }
    if (this._noLetterBoxingFor(aBrowser)) {
      // this tab doesn't need letterboxing
      this._resetContentSize(aBrowser);
    } else {
      this._roundContentSize(aBrowser, isNewTab);
    }
  }

  /**
   * Given a width or height, rounds it with the proper stepping.
   */
  steppedSize(aDimension, aIsWidth = false) {
    let stepping;
    if (aDimension <= 50) {
      return aDimension;
    } else if (aDimension <= 500) {
      stepping = 50;
    } else if (aDimension <= 1600) {
      stepping = aIsWidth ? 200 : 100;
    } else {
      stepping = 200;
    }

    return aDimension - (aDimension % stepping);
  }

  /**
   * The function will round the given browser size
   */
  async _roundContentSize(aBrowser, isNewTab = false) {
    let logPrefix = `_roundContentSize[${Math.random()}]`;
    log(logPrefix);
    let win = aBrowser.documentGlobal;
    let browserContainer = aBrowser
      .getTabBrowser()
      .getBrowserContainer(aBrowser);
    let browserParent = aBrowser.parentElement;
    browserParent.classList.remove("exclude-letterboxing");
    let [
      [contentWidth, contentHeight],
      [parentWidth, parentHeight],
      [containerWidth, containerHeight],
    ] = await win.promiseDocumentFlushed(() =>
      // Read layout info only inside this callback and do not write, to avoid additional reflows
      [aBrowser, browserParent, browserContainer].map(element => [
        element.clientWidth,
        element.clientHeight,
      ])
    );

    log(
      `${logPrefix} contentWidth=${contentWidth} contentHeight=${contentHeight} parentWidth=${parentWidth} parentHeight=${parentHeight} containerWidth=${containerWidth} containerHeight=${containerHeight}${
        isNewTab ? " (new tab)." : "."
      }`
    );

    if (containerWidth == 0) {
      // race condition: tab already be closed, bail out
      return;
    }

    let lastRoundedSize;

    const roundDimensions = (aWidth, aHeight) => {
      const r = (width, height) => {
        lastRoundedSize = { width, height };
        log(
          `${logPrefix} roundDimensions(${aWidth}, ${aHeight}) = ${width} x ${height}`
        );
        return {
          "--letterboxing-width": `var(--rdm-width, ${width}px)`,
          "--letterboxing-height": `var(--rdm-height, ${height}px)`,
        };
      };

      log(`${logPrefix} roundDimensions(${aWidth}, ${aHeight})`);

      // If the set is empty, we will round the content with the default
      // stepping size.
      if (!this._letterboxingDimensions.length) {
        return r(this.steppedSize(aWidth, true), this.steppedSize(aHeight));
      }

      let matchingArea = aWidth * aHeight;
      let minWaste = Number.MAX_SAFE_INTEGER;
      let targetDimensions;

      // Find the desired dimensions which waste the least content area.
      for (let dim of this._letterboxingDimensions) {
        // We don't need to consider the dimensions which cannot fit into the
        // real content size.
        if (dim.width > aWidth || dim.height > aHeight) {
          continue;
        }

        let waste = matchingArea - dim.width * dim.height;

        if (waste >= 0 && waste < minWaste) {
          targetDimensions = dim;
          minWaste = waste;
        }
      }

      // If we cannot find any dimensions match to the real content window, this
      // means the content area is smaller the smallest size in the set. In this
      // case, we won't round the size and default to the max.
      return targetDimensions
        ? r(targetDimensions.width, targetDimensions.height)
        : r(aWidth, aHeight);
    };

    const isTesting = this._isLetterboxingTesting;
    const styleChanges = Object.assign([], {
      queueIfNeeded({ style }, props) {
        for (let [name, value] of Object.entries(props)) {
          if (style[name] != value) {
            this.push(() => {
              style.setProperty(name, value);
            });
          }
        }
      },
      perform() {
        win.requestAnimationFrame(() => {
          for (let change of this) {
            try {
              change();
            } catch (e) {
              lazy.logConsole.error(e);
            }
          }
          if (isTesting) {
            win.promiseDocumentFlushed(() => {
              Services.obs.notifyObservers(
                null,
                "test:letterboxing:update-size-finish"
              );
            });
          }
        });
      },
    });

    const roundedDefault = roundDimensions(containerWidth, containerHeight);

    styleChanges.queueIfNeeded(
      this.getLetterboxingDefaultRule(aBrowser.ownerDocument),
      roundedDefault
    );

    const roundedInline =
      !isNewTab && // new tabs cannot have extra UI components
      (containerHeight > parentHeight || containerWidth > parentWidth)
        ? // optional UI components such as the notification box, the find bar
          // or devtools are constraining this browser's size: recompute custom
          roundDimensions(parentWidth, parentHeight)
        : {
            "--letterboxing-width": "",
            "--letterboxing-height": "",
          }; // otherwise we can keep the default (rounded) size
    styleChanges.queueIfNeeded(browserParent, roundedInline);

    if (lastRoundedSize) {
      // Check whether the letterboxing margin is less than the border radius,
      // and if so do not show an outline.
      const gapVertical = parentHeight - lastRoundedSize.height;
      const gapHorizontal = parentWidth - lastRoundedSize.width;
      browserParent.classList.toggle(
        "letterboxing-show-outline",
        gapVertical >= this._letterboxingBorderRadius ||
          gapHorizontal >= this._letterboxingBorderRadius
      );
    }

    // If the size of the content is already quantized, we do nothing.
    if (!styleChanges.length) {
      log(`${logPrefix} is_rounded == true`);
      if (this._isLetterboxingTesting) {
        log(
          `${logPrefix} is_rounded == true test:letterboxing:update-size-finish`
        );
        Services.obs.notifyObservers(
          null,
          "test:letterboxing:update-size-finish"
        );
      }
      return;
    }

    log(
      `${logPrefix} setting size to ${JSON.stringify({
        roundedDefault,
        roundedInline,
      })}`
    );
    // Here we round the browser's size through CSS.
    // A "border" visual is created by using a CSS outline, which does't
    // affect layout, while the background appearance is borrowed from the
    // toolbar and set in the .letterboxing ancestor (see browser.css).
    styleChanges.perform();
  }

  _resetContentSize(aBrowser) {
    aBrowser.parentElement.classList.add("exclude-letterboxing");
    aBrowser.parentElement.classList.remove("letterboxing-show-outline");
  }

  _updateSizeForTabsInWindow(aWindow) {
    let tabBrowser = aWindow.gBrowser;

    tabBrowser.tabbox.classList.add("letterboxing");
    tabBrowser.tabbox.classList.toggle(
      "letterboxing-vcenter",
      Services.prefs.getBoolPref(kPrefLetterboxingVcenter, false)
    );
    if (this._letterboxingBorderRadius === undefined && tabBrowser.tabbox) {
      // Cache the value since it is not expected to change in a session for any
      // window.
      this._letterboxingBorderRadius = Math.ceil(
        parseFloat(
          aWindow
            .getComputedStyle(tabBrowser.tabbox)
            .getPropertyValue("--letterboxing-border-radius")
        )
      );
    }

    for (let tab of tabBrowser.tabs) {
      let browser = tab.linkedBrowser;
      this._roundOrResetContentSize(browser);
    }
    // We need to add this class late because otherwise new windows get
    // maximized.
    aWindow.setTimeout(() => {
      tabBrowser.tabbox.classList.add("letterboxing-ready");
    });
  }

  _attachWindow(aWindow) {
    aWindow.gBrowser.addTabsProgressListener(this);
    aWindow.addEventListener("TabOpen", this);
    let resizeObserver = new aWindow.ResizeObserver(entries => {
      for (let { target } of entries) {
        this._roundOrResetContentSize(target.querySelector("browser"));
      }
    });
    // Observe resizing of each browser's parent (gets rid of RPC from content
    // windows).
    for (let bs of aWindow.document.querySelectorAll(".browserStack")) {
      resizeObserver.observe(bs);
    }
    this._resizeObservers.set(aWindow, resizeObserver);
    // Rounding the content viewport.
    this._updateSizeForTabsInWindow(aWindow);

    this._updateLetterboxingColors(aWindow, true);
    aWindow.addEventListener("nativethemechange", this);
  }

  /**
   * Convert a CSS property to its RGBA value.
   *
   * @param {Window} win - The window for the element.
   * @param {CSSStyleDeclaration} style - The computed style for the element we
   *   want to grab the color from.
   * @param {string} property - The name of the property we want.
   * @param {object} [options] - Optional details.
   * @param {string} [options.fallbackProperty] - A fallback to use instead if
   *   the property doesn't have a computed value.
   * @param {string} [options.currentColorProperty] - The name of a property to
   *   use as the currentColor.
   *
   * @returns {InspectorRGBATuple} - The RGBA color. The "r", "g", "b" fields
   *   are relative to the 0-255 color range. The "a" field is in the 0-1 range.
   */
  _convertToRGBA(win, style, property, options) {
    let cssColor = style.getPropertyValue(property);
    if (!cssColor) {
      if (options?.fallbackProperty) {
        lazy.logConsole.debug(
          "Using fallback property for RGBA.",
          property,
          options.fallbackProperty
        );
        return this._convertToRGBA(win, style, options.fallbackProperty);
      }
      lazy.logConsole.error(`Missing color "${property}"`);
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const currentColorRegex =
      /(^|[^a-zA-Z0-9_-])currentColor($|[^a-zA-Z0-9_-])/g;
    if (currentColorRegex.test(cssColor)) {
      let currentColor;
      if (options?.currentColorProperty) {
        const currRGBA = this._convertToRGBA(
          win,
          style,
          options.currentColorProperty
        );
        currentColor = `rgba(${currRGBA.r}, ${currRGBA.g}, ${currRGBA.b}, ${currRGBA.a})`;
      } else {
        lazy.logConsole.warning(
          "Missing a specification for the currentColor, using computed color."
        );
        // Use the current "color" value. NOTE: this may not be exactly what we
        // want since it's current value may be effected by :hover, :active,
        // :focus, etc. But we want this to be a stable colour for the theme.
        currentColor = style.color;
      }
      cssColor = cssColor.replace(currentColorRegex, (_, pre, post) => {
        return pre + currentColor + post;
      });
      lazy.logConsole.debug(
        "Replaced currentColor.",
        property,
        currentColor,
        cssColor
      );
    }
    // Can drop the document argument after bugzilla bug 1973684 (142).
    const colorRGBA = win.InspectorUtils.colorToRGBA(cssColor, win.document);
    if (!colorRGBA) {
      lazy.logConsole.error(
        `Failed to convert "${property}" color (${cssColor}) to RGBA`
      );
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    return colorRGBA;
  }

  /**
   * Compose two colors with alpha values on top of each other.
   *
   * @param {InspectorRGBATuple} topRGBA - The color to place on the top.
   * @param {InspectorRGBATuple} bottomRGBA - The color to place on the bottom.
   *
   * @returns {InspectorRGBATuple} - The composed color.
   */
  _composeRGBA(topRGBA, bottomRGBA) {
    const topA = Math.max(0, Math.min(1, topRGBA.a));
    const bottomA = Math.max(0, Math.min(1, bottomRGBA.a));
    const a = topA + bottomA - topA * bottomA; // Should be 1 if either is 1.
    if (a === 0) {
      return { r: 0, g: 0, b: 0, a };
    }
    const ret = { a };
    for (const field of ["r", "g", "b"]) {
      ret[field] =
        (topRGBA[field] * topA + bottomRGBA[field] * bottomA * (1 - topA)) / a;
    }
    return ret;
  }

  /**
   * Calculate the urlbar's container opaque background color, removing any
   * transparency.
   *
   * @param {Window} win - The window to calculate the color for.
   * @param {CSSStyleDeclaration} style - The computed style for the #nav-bar
   *   element.
   * @param {boolean} verticalTabs - Whether vertical tabs are enabled.
   *
   * @returns {InspectorRGBATuple} - The calculated color, which will be opaque.
   */
  _calculateUrlbarContainerColor(win, style, verticalTabs) {
    let colorRGBA;
    if (!verticalTabs) {
      lazy.logConsole.debug("Toolbar background used.");
      colorRGBA = this._convertToRGBA(win, style, "--toolbar-background-color");
      if (colorRGBA.a === 1) {
        return colorRGBA;
      }
    } else {
      // The urlbar only has the toolbox colour.
      colorRGBA = { r: 0, g: 0, b: 0, a: 0 };
    }
    let toolboxHasBackgroundImage = false;
    const isLwTheme = win.document.documentElement.hasAttribute("lwtheme");
    if (isLwTheme) {
      for (const prop of ["--lwt-header-image", "--lwt-additional-images"]) {
        const headerImage = style.getPropertyValue(prop);
        if (headerImage && headerImage !== "none") {
          // The theme sets a background image behind the urlbar. No easy way to
          // derive a single colour from this.
          toolboxHasBackgroundImage = true;
          lazy.logConsole.debug(
            "Toolbox has background image.",
            prop,
            headerImage
          );
          break;
        }
      }
    }
    if (!toolboxHasBackgroundImage) {
      lazy.logConsole.debug("Toolbox background used.");
      colorRGBA = this._composeRGBA(
        colorRGBA,
        this._convertToRGBA(win, style, "--toolbox-background-color")
      );
      if (colorRGBA.a === 1) {
        return colorRGBA;
      }
    }

    // Determine whether the urlbar is dark.
    // At this point, the urlbar background has some transparency, likely on top
    // of an image.
    // We use the theme's text colour to figure out whether the urlbar
    // background is overall meant to be light or dark. Unlike the urlbar, we
    // expect this colour to be (almost) opaque.
    const textRGBA = this._convertToRGBA(
      win,
      style,
      "--toolbar-field-text-color"
    );
    const textColor = new lazy.Color(textRGBA.r, textRGBA.g, textRGBA.b);
    if (textColor.relativeLuminance >= 0.5) {
      // Light text, so assume it has a dark background.
      // Combine with a generic opaque dark colour. Copied from "frame" for the
      // built-in dark theme.
      lazy.logConsole.debug("Generic dark background used.");
      const darkFrameRGBA = { r: 28, g: 27, b: 34, a: 1 };
      return this._composeRGBA(colorRGBA, darkFrameRGBA);
    }
    // Combine with an opaque light colour. Copied from "frame" for the built-in
    // light theme.
    lazy.logConsole.debug("Generic light background used.");
    const lightFrameRGBA = { r: 234, g: 234, b: 237, a: 1 };
    return this._composeRGBA(colorRGBA, lightFrameRGBA);
  }

  /**
   * Update the Letterboxing colors and related classes, or clear them if
   * Letterboxing is not enabled.
   *
   * @param {Window} win - The window to update the colors for.
   * @param {boolean} letterboxingEnabled - Whether Letterboxing is enabled.
   */
  _updateLetterboxingColors(win, letterboxingEnabled) {
    let urlbarBackgroundRGBA;
    let urlbarTextRGBA;
    let contentSeparatorRGBA;
    let urlbarBackgroundDark = false;
    let lowBackgroundOutlineContrast = false;

    if (letterboxingEnabled) {
      // Want the effective colour of various elements without any alpha values
      // so they can be used consistently.

      const verticalTabs = Services.prefs.getBoolPref(kPrefVerticalTabs);
      const chromeTextColorProperty = verticalTabs
        ? "--toolbox-text-color"
        : "--toolbar-text-color";

      const navbarStyle = win.getComputedStyle(
        win.document.getElementById("nav-bar")
      );
      const containerRGBA = this._calculateUrlbarContainerColor(
        win,
        navbarStyle,
        verticalTabs
      );
      urlbarBackgroundRGBA = this._composeRGBA(
        this._convertToRGBA(
          win,
          navbarStyle,
          "--toolbar-field-background-color"
        ),
        containerRGBA
      );
      // NOTE: In the default theme (no "lwtheme" attribute) with
      // browser.theme.native-theme set to false, --toolbar-field-color can be
      // set to "inherit", which means it will have a blank computed value. We
      // fallback to --toolbar-text-color or --toolbox-text-color in this case.
      // Similarly, for windows OS, it can be set to "currentColor".
      urlbarTextRGBA = this._composeRGBA(
        this._convertToRGBA(win, navbarStyle, "--toolbar-field-text-color", {
          fallbackProperty: chromeTextColorProperty,
          currentColorProperty: chromeTextColorProperty,
        }),
        urlbarBackgroundRGBA
      );
      // Separator between the urlbar container #nav-bar and the tabbox.
      // For the default theme, this can be set to --card-border-color, which
      // can use "currentColor".
      const tabboxStyle = win.getComputedStyle(win.gBrowser.tabbox);
      contentSeparatorRGBA = this._composeRGBA(
        this._convertToRGBA(
          win,
          tabboxStyle,
          "--chrome-content-separator-color",
          { currentColorProperty: chromeTextColorProperty }
        ),
        containerRGBA
      );
      const bgColor = new lazy.Color(
        urlbarBackgroundRGBA.r,
        urlbarBackgroundRGBA.g,
        urlbarBackgroundRGBA.b
      );
      const outlineColor = new lazy.Color(
        contentSeparatorRGBA.r,
        contentSeparatorRGBA.g,
        contentSeparatorRGBA.b
      );
      const contrastRatio = bgColor.contrastRatio(outlineColor);
      lazy.logConsole.debug(
        "Outline-background contrast ratio.",
        contrastRatio
      );
      urlbarBackgroundDark = bgColor.relativeLuminance < 0.5;
      // Very low contrast ratio. For reference the default light theme has
      // a contrast ratio of ~1.1.
      lowBackgroundOutlineContrast = contrastRatio < 1.05;
    }
    for (const { name, colorRGBA } of [
      {
        name: "--letterboxing-urlbar-text-color",
        colorRGBA: urlbarTextRGBA,
      },
      {
        name: "--letterboxing-urlbar-background-color",
        colorRGBA: urlbarBackgroundRGBA,
      },
      {
        name: "--letterboxing-content-separator-color",
        colorRGBA: contentSeparatorRGBA,
      },
    ]) {
      if (letterboxingEnabled) {
        win.gBrowser.tabbox.style.setProperty(
          name,
          `rgb(${colorRGBA.r}, ${colorRGBA.g}, ${colorRGBA.b})`
        );
      } else {
        win.gBrowser.tabbox.style.removeProperty(name);
      }
    }
    win.gBrowser.tabbox.classList.toggle(
      "letterboxing-urlbar-background-dark",
      urlbarBackgroundDark
    );
    win.gBrowser.tabbox.classList.toggle(
      "letterboxing-low-background-outline-contrast",
      lowBackgroundOutlineContrast
    );
  }

  _attachAllWindows() {
    let windowList = Services.wm.getEnumerator("navigator:browser");

    while (windowList.hasMoreElements()) {
      let win = windowList.getNext();

      if (win.closed || !win.gBrowser) {
        continue;
      }

      this._attachWindow(win);
    }
  }

  _detachWindow(aWindow) {
    let resizeObserver = this._resizeObservers.get(aWindow);
    if (resizeObserver) {
      resizeObserver.disconnect();
      this._resizeObservers.delete(aWindow);
    }

    let tabBrowser = aWindow.gBrowser;
    if (!tabBrowser) {
      return;
    }
    tabBrowser.removeTabsProgressListener(this);
    aWindow.removeEventListener("TabOpen", this);

    // revert tabpanel's style to default
    tabBrowser.tabbox.classList.remove("letterboxing");

    // and restore default size on each browser element
    for (let tab of tabBrowser.tabs) {
      let browser = tab.linkedBrowser;
      this._resetContentSize(browser);
    }

    aWindow.removeEventListener("nativethemechange", this);
    this._updateLetterboxingColors(aWindow, false);
  }

  _detachAllWindows() {
    let windowList = Services.wm.getEnumerator("navigator:browser");

    while (windowList.hasMoreElements()) {
      let win = windowList.getNext();

      if (win.closed || !win.gBrowser) {
        continue;
      }

      this._detachWindow(win);
    }
  }

  _handleDOMWindowOpened(win) {
    let self = this;

    win.addEventListener(
      "load",
      () => {
        // We attach to the new window when it has been loaded if the new loaded
        // window is a browsing window.
        if (
          win.document.documentElement.getAttribute("windowtype") !==
          "navigator:browser"
        ) {
          return;
        }
        self._attachWindow(win);
        win.addEventListener(
          "unload",
          () => {
            self._detachWindow(win);
          },
          { once: true }
        );
      },
      { once: true }
    );
  }

  _handleDOMWindowClosed(win) {
    this._detachWindow(win);
  }

  getTargets() {
    return RFPTargetConstants.Targets;
  }

  getTargetDefaultsBaseline() {
    const key =
      Services.appinfo.OS === "Android" ? "ANDROID_DEFAULT" : "DESKTOP_DEFAULT";
    return RFPTargetConstants.DefaultTargetsBaseline[key];
  }

  getTargetDefaults() {
    const key =
      Services.appinfo.OS === "Android" ? "ANDROID_DEFAULT" : "DESKTOP_DEFAULT";
    return RFPTargetConstants.DefaultTargetsFPP[key];
  }
}

export let RFPHelper = new _RFPHelper();
