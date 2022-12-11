// -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import * as constants from "resource://gre/modules/RFPTargetConstants.sys.mjs";

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
const kPrefLetterboxingGradient =
  "privacy.resistFingerprinting.letterboxing.gradient";

const kTopicDOMWindowOpened = "domwindowopened";

var logConsole;
function log(msg) {
  if (!logConsole) {
    logConsole = console.createInstance({
      prefix: "RFPHelper",
      maxLogLevelPref: "privacy.resistFingerprinting.jsmloglevel",
    });
  }

  logConsole.log(msg);
}

class _RFPHelper {
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
    Services.obs.addObserver(this, "user-characteristics-populating-data");
    Services.obs.addObserver(this, "user-characteristics-populating-data-done");
    Services.prefs.addObserver(kPrefResistFingerprinting, this);
    Services.prefs.addObserver(kPrefLetterboxing, this);
    Services.prefs.addObserver(kPrefLetterboxingVcenter, this);
    Services.prefs.addObserver(kPrefLetterboxingGradient, this);

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
    Services.prefs.removeObserver(kPrefLetterboxingGradient, this);
    Services.prefs.removeObserver(kPrefLetterboxingVcenter, this);
    Services.prefs.removeObserver(kPrefLetterboxing, this);
    // Remove the RFP observers, swallowing exceptions if they weren't present
    this._removeRFPObservers();
  }

  observe(subject, topic, data) {
    switch (topic) {
      case "user-characteristics-populating-data":
        this._registerUserCharacteristicsActor();
        break;
      case "user-characteristics-populating-data-done":
        this._unregisterUserCharacteristicsActor();
        break;
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
      default:
        break;
    }
  }

  _registerUserCharacteristicsActor() {
    log("_registerUserCharacteristicsActor()");
    ChromeUtils.registerWindowActor("UserCharacteristics", {
      parent: {
        esModuleURI: "resource://gre/actors/UserCharacteristicsParent.sys.mjs",
      },
      child: {
        esModuleURI: "resource://gre/actors/UserCharacteristicsChild.sys.mjs",
        events: {
          UserCharacteristicsDataDone: { wantUntrusted: true },
        },
      },
      matches: ["about:fingerprintingprotection"],
      remoteTypes: ["privilegedabout"],
    });
  }

  _unregisterUserCharacteristicsActor() {
    log("_unregisterUserCharacteristicsActor()");
    ChromeUtils.unregisterWindowActor("UserCharacteristics");
  }

  handleEvent(aMessage) {
    switch (aMessage.type) {
      case "TabOpen": {
        let browser = aMessage.target.linkedBrowser;
        this._roundOrResetContentSize(browser, /* isNewTab = */ true);
        browser.ownerGlobal._rfpResizeObserver.observe(browser.parentElement);
        break;
      }
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
      case kPrefLetterboxingGradient:
        this._handleLetterboxingPrefChanged();
        break;
      default:
        break;
    }
  }

  // ============================================================================
  // Language Prompt
  // ============================================================================
  _addRFPObservers() {
    Services.prefs.addObserver(kPrefSpoofEnglish, this);
    if (this._shouldPromptForLanguagePref()) {
      Services.obs.addObserver(this, kTopicHttpOnModifyRequest);
    }
  }

  _removeRFPObservers() {
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
    if (
      (this.rfpEnabled = Services.prefs.getBoolPref(kPrefResistFingerprinting))
    ) {
      this._addRFPObservers();
    } else {
      this._removeRFPObservers();
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
      Services.ww.registerNotification(this);
      this._attachAllWindows();
    } else {
      this._detachAllWindows();
      Services.ww.unregisterNotification(this);
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
    return (document._letterBoxingSizingRule ||= (() => {
      // If not already cached on the document object, traverse the CSSOM and
      // find the rule applying the default letterboxing styles to browsers
      // preemptively in order to beat race conditions on tab/window creation
      const LETTERBOX_CSS_URL = "chrome://browser/content/browser.css";
      const LETTERBOX_CSS_SELECTOR = ".letterboxing .browserContainer";
      for (let ss of document.styleSheets) {
        if (ss.href !== LETTERBOX_CSS_URL) {
          continue;
        }
        for (let rule of ss.rules) {
          if (rule.selectorText === LETTERBOX_CSS_SELECTOR) {
            return rule;
          }
        }
      }
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
      // ... about: URIs EXCEPT about:blank
      (currentURI.schemeIs("about") && currentURI.filePath !== "blank") ||
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
  steppedSize(aDimension, isWidth = false) {
    let stepping;
    if (aDimension <= 50) {
      return 0;
    } else if (aDimension <= 500) {
      stepping = 50;
    } else if (aDimension <= 1600) {
      stepping = isWidth ? 200 : 100;
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
    let win = aBrowser.ownerGlobal;
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

    if (containerWidth === 0) {
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

      let result;

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

    const styleChanges = Object.assign([], {
      queueIfNeeded({ style }, props) {
        for (let [name, value] of Object.entries(props)) {
          if (style[name] !== value) {
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
              logConsole.error(e);
            }
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
      // check wether the letterboxing margin is less than the border radius, and if so flatten the borders
      let borderRadius = parseInt(
        win
          .getComputedStyle(browserContainer)
          .getPropertyValue("--letterboxing-border-radius")
      );
      if (
        borderRadius &&
        parentWidth - lastRoundedSize.width < borderRadius &&
        parentHeight - lastRoundedSize.height < borderRadius
      ) {
        borderRadius = 0;
      } else {
        borderRadius = "";
      }
      styleChanges.queueIfNeeded(browserParent, {
        "--letterboxing-decorator-visibility":
          borderRadius === 0 ? "hidden" : "",
        "--letterboxing-border-radius": borderRadius,
      });
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
  }

  _updateSizeForTabsInWindow(aWindow) {
    let tabBrowser = aWindow.gBrowser;

    tabBrowser.tabpanels?.classList.add("letterboxing");
    tabBrowser.tabpanels?.classList.toggle(
      "letterboxing-vcenter",
      Services.prefs.getBoolPref(kPrefLetterboxingVcenter, false)
    );
    tabBrowser.tabpanels?.classList.toggle(
      "letterboxing-gradient",
      Services.prefs.getBoolPref(kPrefLetterboxingGradient, false)
    );

    for (let tab of tabBrowser.tabs) {
      let browser = tab.linkedBrowser;
      this._roundOrResetContentSize(browser);
    }
    // we need to add this class late because otherwise new windows get maximized
    aWindow.setTimeout(() => {
      tabBrowser.tabpanels?.classList.add("letterboxing-ready");
    });
  }

  _attachWindow(aWindow) {
    aWindow.gBrowser.addTabsProgressListener(this);
    aWindow.addEventListener("TabOpen", this);
    const resizeObserver = (aWindow._rfpResizeObserver =
      new aWindow.ResizeObserver(entries => {
        for (let { target } of entries) {
          this._roundOrResetContentSize(target.querySelector("browser"));
        }
      }));
    // observe resizing of each browser's parent (gets rid of RPC from content windows)
    for (let bs of aWindow.document.querySelectorAll(".browserStack")) {
      resizeObserver.observe(bs);
    }
    // Rounding the content viewport.
    this._updateSizeForTabsInWindow(aWindow);
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
    let tabBrowser = aWindow.gBrowser;
    tabBrowser.removeTabsProgressListener(this);
    aWindow._rfpResizeObserver?.disconnect();
    delete aWindow._rfpResizeObserver;
    aWindow.removeEventListener("TabOpen", this);

    // revert tabpanel's style to default
    tabBrowser.tabpanels?.classList.remove("letterboxing");

    // and restore default size on each browser element
    for (let tab of tabBrowser.tabs) {
      let browser = tab.linkedBrowser;
      this._resetContentSize(browser);
    }
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
      },
      { once: true }
    );
  }

  getTargets() {
    return constants.Targets;
  }

  getTargetDefaults() {
    const key =
      Services.appinfo.OS === "Android" ? "ANDROID_DEFAULT" : "DESKTOP_DEFAULT";
    return constants.DefaultTargets[key];
  }
}

export let RFPHelper = new _RFPHelper();
