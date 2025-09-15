/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EventEmitter } from "resource:///modules/syncedtabs/EventEmitter.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  SitePermissions: "resource:///modules/SitePermissions.sys.mjs",
});
ChromeUtils.defineLazyGetter(
  lazy,
  "syncL10n",
  () => new Localization(["browser/webrtcIndicator.ftl"], true)
);
ChromeUtils.defineLazyGetter(
  lazy,
  "listFormat",
  () => new Services.intl.ListFormat(undefined)
);

const SHARING_L10NID_BY_TYPE = new Map([
  [
    "Camera",
    [
      "webrtc-indicator-menuitem-sharing-camera-with",
      "webrtc-indicator-menuitem-sharing-camera-with-n-tabs",
    ],
  ],
  [
    "Microphone",
    [
      "webrtc-indicator-menuitem-sharing-microphone-with",
      "webrtc-indicator-menuitem-sharing-microphone-with-n-tabs",
    ],
  ],
  [
    "Application",
    [
      "webrtc-indicator-menuitem-sharing-application-with",
      "webrtc-indicator-menuitem-sharing-application-with-n-tabs",
    ],
  ],
  [
    "Screen",
    [
      "webrtc-indicator-menuitem-sharing-screen-with",
      "webrtc-indicator-menuitem-sharing-screen-with-n-tabs",
    ],
  ],
  [
    "Window",
    [
      "webrtc-indicator-menuitem-sharing-window-with",
      "webrtc-indicator-menuitem-sharing-window-with-n-tabs",
    ],
  ],
  [
    "Browser",
    [
      "webrtc-indicator-menuitem-sharing-browser-with",
      "webrtc-indicator-menuitem-sharing-browser-with-n-tabs",
    ],
  ],
]);

// These identifiers are defined in MediaStreamTrack.webidl
const MEDIA_SOURCE_L10NID_BY_TYPE = new Map([
  ["camera", "webrtc-item-camera"],
  ["screen", "webrtc-item-screen"],
  ["application", "webrtc-item-application"],
  ["window", "webrtc-item-window"],
  ["browser", "webrtc-item-browser"],
  ["microphone", "webrtc-item-microphone"],
  ["audioCapture", "webrtc-item-audio-capture"],
]);

export var webrtcUI = {
  initialized: false,

  peerConnectionBlockers: new Set(),
  emitter: new EventEmitter(),

  init() {
    if (!this.initialized) {
      Services.obs.addObserver(this, "browser-delayed-startup-finished");
      this.initialized = true;

      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "deviceGracePeriodTimeoutMs",
        "privacy.webrtc.deviceGracePeriodTimeoutMs"
      );
      XPCOMUtils.defineLazyPreferenceGetter(
        this,
        "showIndicatorsOnMacos14AndAbove",
        "privacy.webrtc.showIndicatorsOnMacos14AndAbove",
        true
      );
    }
  },

  uninit() {
    if (this.initialized) {
      Services.obs.removeObserver(this, "browser-delayed-startup-finished");
      this.initialized = false;
    }
  },

  observe(subject, topic) {
    if (topic == "browser-delayed-startup-finished") {
      if (webrtcUI.showGlobalIndicator) {
        showOrCreateMenuForWindow(subject);
      }
    }
  },

  SHARING_NONE: 0,
  SHARING_WINDOW: 1,
  SHARING_SCREEN: 2,

  // Set of browser windows that are being shared over WebRTC.
  sharedBrowserWindows: new WeakSet(),

  // True if one or more screens is being shared.
  sharingScreen: false,

  allowedSharedBrowsers: new WeakSet(),
  allowTabSwitchesForSession: false,
  tabSwitchCountForSession: 0,

  // Map of browser elements to indicator data.
  perTabIndicators: new Map(),
  activePerms: new Map(),

  get showGlobalIndicator() {
    for (let [, indicators] of this.perTabIndicators) {
      if (
        indicators.showCameraIndicator ||
        indicators.showMicrophoneIndicator ||
        indicators.showScreenSharingIndicator
      ) {
        return true;
      }
    }
    return false;
  },

  get showCameraIndicator() {
    // Bug 1857254 - MacOS 14 displays two camera icons in menu bar
    // temporarily disabled the firefox camera icon until a better fix comes around
    if (
      AppConstants.isPlatformAndVersionAtLeast("macosx", 14.0) &&
      !this.showIndicatorsOnMacos14AndAbove
    ) {
      return false;
    }

    for (let [, indicators] of this.perTabIndicators) {
      if (indicators.showCameraIndicator) {
        return true;
      }
    }
    return false;
  },

  get showMicrophoneIndicator() {
    // Bug 1857254 - MacOS 14 displays two microphone icons in menu bar
    // temporarily disabled the firefox camera icon until a better fix comes around
    if (
      AppConstants.isPlatformAndVersionAtLeast("macosx", 14.0) &&
      !this.showIndicatorsOnMacos14AndAbove
    ) {
      return false;
    }

    for (let [, indicators] of this.perTabIndicators) {
      if (indicators.showMicrophoneIndicator) {
        return true;
      }
    }
    return false;
  },

  get showScreenSharingIndicator() {
    // Bug 1857254 - MacOS 14 displays two screen share icons in menu bar
    // temporarily disabled the firefox camera icon until a better fix comes around
    if (
      AppConstants.isPlatformAndVersionAtLeast("macosx", 14.0) &&
      !this.showIndicatorsOnMacos14AndAbove
    ) {
      return "";
    }

    let list = [""];
    for (let [, indicators] of this.perTabIndicators) {
      if (indicators.showScreenSharingIndicator) {
        list.push(indicators.showScreenSharingIndicator);
      }
    }

    let precedence = ["Screen", "Window", "Application", "Browser", ""];

    list.sort((a, b) => {
      return precedence.indexOf(a) - precedence.indexOf(b);
    });

    return list[0];
  },

  _streams: [],
  // The boolean parameters indicate which streams should be included in the result.
  getActiveStreams(aCamera, aMicrophone, aScreen, aWindow = false) {
    return webrtcUI._streams
      .filter(aStream => {
        let state = aStream.state;
        return (
          (aCamera && state.camera) ||
          (aMicrophone && state.microphone) ||
          (aScreen && state.screen) ||
          (aWindow && state.window)
        );
      })
      .map(aStream => {
        let state = aStream.state;
        let types = {
          camera: state.camera,
          microphone: state.microphone,
          screen: state.screen,
          window: state.window,
        };
        let browser = aStream.topBrowsingContext.embedderElement;
        // browser can be null when we are in the process of closing a tab
        // and our stream list hasn't been updated yet.
        // gBrowser will be null if a stream is used outside a tabbrowser window.
        let tab = browser?.ownerGlobal.gBrowser?.getTabForBrowser(browser);
        return {
          uri: state.documentURI,
          tab,
          browser,
          types,
          devices: state.devices,
        };
      });
  },

  /**
   * Returns true if aBrowser has an active WebRTC stream.
   */
  browserHasStreams(aBrowser) {
    for (let stream of this._streams) {
      if (stream.topBrowsingContext.embedderElement == aBrowser) {
        return true;
      }
    }

    return false;
  },

  /**
   * Determine the combined state of all the active streams associated with
   * the specified top-level browsing context.
   */
  getCombinedStateForBrowser(aTopBrowsingContext) {
    function combine(x, y) {
      if (
        x == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED ||
        y == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED
      ) {
        return Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED;
      }
      if (
        x == Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED ||
        y == Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED
      ) {
        return Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED;
      }
      return Ci.nsIMediaManagerService.STATE_NOCAPTURE;
    }

    let camera, microphone, screen, window, browser;
    for (let stream of this._streams) {
      if (stream.topBrowsingContext == aTopBrowsingContext) {
        camera = combine(stream.state.camera, camera);
        microphone = combine(stream.state.microphone, microphone);
        screen = combine(stream.state.screen, screen);
        window = combine(stream.state.window, window);
        browser = combine(stream.state.browser, browser);
      }
    }

    let tabState = { camera, microphone };
    if (screen == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED) {
      tabState.screen = "Screen";
    } else if (window == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED) {
      tabState.screen = "Window";
    } else if (browser == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED) {
      tabState.screen = "Browser";
    } else if (screen == Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED) {
      tabState.screen = "ScreenPaused";
    } else if (window == Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED) {
      tabState.screen = "WindowPaused";
    } else if (browser == Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED) {
      tabState.screen = "BrowserPaused";
    }

    let screenEnabled = tabState.screen && !tabState.screen.includes("Paused");
    let cameraEnabled =
      tabState.camera == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED;
    let microphoneEnabled =
      tabState.microphone == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED;

    // tabState.sharing controls which global indicator should be shown
    // for the tab. It should always be set to the _enabled_ device which
    // we consider most intrusive (screen > camera > microphone).
    if (screenEnabled) {
      tabState.sharing = "screen";
    } else if (cameraEnabled) {
      tabState.sharing = "camera";
    } else if (microphoneEnabled) {
      tabState.sharing = "microphone";
    } else if (tabState.screen) {
      tabState.sharing = "screen";
    } else if (tabState.camera) {
      tabState.sharing = "camera";
    } else if (tabState.microphone) {
      tabState.sharing = "microphone";
    }

    // The stream is considered paused when we're sharing something
    // but all devices are off or set to disabled.
    tabState.paused =
      tabState.sharing &&
      !screenEnabled &&
      !cameraEnabled &&
      !microphoneEnabled;

    if (
      tabState.camera == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED ||
      tabState.camera == Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED
    ) {
      tabState.showCameraIndicator = true;
    }
    if (
      tabState.microphone == Ci.nsIMediaManagerService.STATE_CAPTURE_ENABLED ||
      tabState.microphone == Ci.nsIMediaManagerService.STATE_CAPTURE_DISABLED
    ) {
      tabState.showMicrophoneIndicator = true;
    }

    tabState.showScreenSharingIndicator = "";
    if (tabState.screen) {
      if (tabState.screen.startsWith("Screen")) {
        tabState.showScreenSharingIndicator = "Screen";
      } else if (tabState.screen.startsWith("Window")) {
        if (tabState.showScreenSharingIndicator != "Screen") {
          tabState.showScreenSharingIndicator = "Window";
        }
      } else if (tabState.screen.startsWith("Browser")) {
        if (!tabState.showScreenSharingIndicator) {
          tabState.showScreenSharingIndicator = "Browser";
        }
      }
    }

    return tabState;
  },

  /*
   * Indicate that a stream has been added or removed from the given
   * browsing context. If it has been added, aData specifies the
   * specific indicator types it uses. If aData is null or has no
   * documentURI assigned, then the stream has been removed.
   */
  streamAddedOrRemoved(aBrowsingContext, aData) {
    this.init();

    let index;
    for (index = 0; index < webrtcUI._streams.length; ++index) {
      let stream = this._streams[index];
      if (stream.browsingContext == aBrowsingContext) {
        break;
      }
    }
    // The update is a removal of the stream, triggered by the
    // recording-window-ended notification.
    if (aData.remove) {
      if (index < this._streams.length) {
        this._streams.splice(index, 1);
      }
    } else {
      this._streams[index] = {
        browsingContext: aBrowsingContext,
        topBrowsingContext: aBrowsingContext.top,
        state: aData,
      };
    }

    // Reset our internal notion of whether or not we're sharing
    // a screen or browser window. Now we'll go through the shared
    // devices and re-determine what's being shared.
    let sharingBrowserWindow = false;
    let sharedWindowRawDeviceIds = new Set();
    this.sharingScreen = false;
    let suppressNotifications = false;

    // First, go through the streams and collect the counts on things
    // like the total number of shared windows, and whether or not we're
    // sharing screens.
    for (let stream of this._streams) {
      let { state } = stream;
      suppressNotifications |= state.suppressNotifications;

      for (let device of state.devices) {
        if (!device.scary) {
          continue;
        }

        let mediaSource = device.mediaSource;
        if (mediaSource == "window") {
          sharedWindowRawDeviceIds.add(device.rawId);
        } else if (mediaSource == "screen") {
          this.sharingScreen = true;
        }

        // If the user has granted a particular site the ability
        // to get a stream from a window or screen, we will
        // presume that it's exempt from the tab switch warning.
        //
        // We use the permanentKey here so that the allowing of
        // the tab survives tab tear-in and tear-out. We ignore
        // browsers that don't have permanentKey, since those aren't
        // tabbrowser browsers.
        let browser = stream.topBrowsingContext.embedderElement;
        if (browser.permanentKey) {
          this.allowedSharedBrowsers.add(browser.permanentKey);
        }
      }
    }

    // Next, go through the list of shared windows, and map them
    // to our browser windows so that we know which ones are shared.
    this.sharedBrowserWindows = new WeakSet();

    for (let win of lazy.BrowserWindowTracker.orderedWindows) {
      let rawDeviceId;
      try {
        rawDeviceId = win.windowUtils.webrtcRawDeviceId;
      } catch (e) {
        // This can theoretically throw if some of the underlying
        // window primitives don't exist. In that case, we can skip
        // to the next window.
        continue;
      }
      if (sharedWindowRawDeviceIds.has(rawDeviceId)) {
        this.sharedBrowserWindows.add(win);

        // If we've shared a window, then the initially selected tab
        // in that window should be exempt from tab switch warnings,
        // since it's already been shared.
        let selectedBrowser = win.gBrowser.selectedBrowser;
        this.allowedSharedBrowsers.add(selectedBrowser.permanentKey);

        sharingBrowserWindow = true;
      }
    }

    // Since we're not sharing a screen or browser window,
    // we can clear these state variables, which are used
    // to warn users on tab switching when sharing. These
    // are safe to reset even if we hadn't been sharing
    // the screen or browser window already.
    if (!this.sharingScreen && !sharingBrowserWindow) {
      this.allowedSharedBrowsers = new WeakSet();
      this.allowTabSwitchesForSession = false;
      this.tabSwitchCountForSession = 0;
    }

    this._setSharedData();
    if (
      Services.prefs.getBoolPref(
        "privacy.webrtc.allowSilencingNotifications",
        false
      )
    ) {
      let alertsService = Cc["@mozilla.org/alerts-service;1"]
        .getService(Ci.nsIAlertsService)
        .QueryInterface(Ci.nsIAlertsDoNotDisturb);
      alertsService.suppressForScreenSharing = suppressNotifications;
    }
  },

  /**
   * Remove all the streams associated with a given
   * browsing context.
   */
  forgetStreamsFromBrowserContext(aBrowsingContext) {
    for (let index = 0; index < webrtcUI._streams.length; ) {
      let stream = this._streams[index];
      if (stream.browsingContext == aBrowsingContext) {
        this._streams.splice(index, 1);
      } else {
        index++;
      }
    }

    // Remove the per-tab indicator if it no longer needs to be displayed.
    let topBC = aBrowsingContext.top;
    if (this.perTabIndicators.has(topBC)) {
      let tabState = this.getCombinedStateForBrowser(topBC);
      if (
        !tabState.showCameraIndicator &&
        !tabState.showMicrophoneIndicator &&
        !tabState.showScreenSharingIndicator
      ) {
        this.perTabIndicators.delete(topBC);
      }
    }

    this.updateGlobalIndicator();
    this._setSharedData();
  },

  /**
   * Given some set of streams, stops device access for those streams.
   * Optionally, it's possible to stop a subset of the devices on those
   * streams by passing in optional arguments.
   *
   * Once the streams have been stopped, this method will also find the
   * newest stream's <xul:browser> and window, focus the window, and
   * select the browser.
   *
   * For camera and microphone streams, this will also revoke any associated
   * permissions from SitePermissions.
   *
   * @param {Array<Object>} activeStreams - An array of streams obtained via webrtcUI.getActiveStreams.
   * @param {boolean} stopCameras - True to stop the camera streams (defaults to true)
   * @param {boolean} stopMics - True to stop the microphone streams (defaults to true)
   * @param {boolean} stopScreens - True to stop the screen streams (defaults to true)
   * @param {boolean} stopWindows - True to stop the window streams (defaults to true)
   */
  stopSharingStreams(
    activeStreams,
    stopCameras = true,
    stopMics = true,
    stopScreens = true,
    stopWindows = true
  ) {
    if (!activeStreams.length) {
      return;
    }

    let ids = [];
    if (stopCameras) {
      ids.push("camera");
    }
    if (stopMics) {
      ids.push("microphone");
    }
    if (stopScreens || stopWindows) {
      ids.push("screen");
    }

    for (let stream of activeStreams) {
      let { browser } = stream;

      let gBrowser = browser.getTabBrowser();
      if (!gBrowser) {
        console.error("Can't stop sharing stream - cannot find gBrowser.");
        continue;
      }

      let tab = gBrowser.getTabForBrowser(browser);
      if (!tab) {
        console.error("Can't stop sharing stream - cannot find tab.");
        continue;
      }

      this.clearPermissionsAndStopSharing(ids, tab);
    }

    // Switch to the newest stream's browser.
    let mostRecentStream = activeStreams[activeStreams.length - 1];
    let { browser: browserToSelect } = mostRecentStream;

    let window = browserToSelect.ownerGlobal;
    let gBrowser = browserToSelect.getTabBrowser();
    let tab = gBrowser.getTabForBrowser(browserToSelect);
    window.focus();
    gBrowser.selectedTab = tab;
  },

  /**
   * Clears permissions and stops sharing (if active) for a list of device types
   * and a specific tab.
   * @param {("camera"|"microphone"|"screen")[]} types - Device types to stop
   * and clear permissions for.
   * @param tab - Tab of the devices to stop and clear permissions.
   */
  clearPermissionsAndStopSharing(types, tab) {
    let invalidTypes = types.filter(
      type => !["camera", "screen", "microphone", "speaker"].includes(type)
    );
    if (invalidTypes.length) {
      throw new Error(`Invalid device types ${invalidTypes.join(",")}`);
    }
    let browser = tab.linkedBrowser;
    let sharingState = tab._sharingState?.webRTC;

    // If we clear a WebRTC permission we need to remove all permissions of
    // the same type across device ids. We also need to stop active WebRTC
    // devices related to the permission.
    let perms = lazy.SitePermissions.getAllForBrowser(browser);

    // If capturing, don't revoke one of camera/microphone without the other.
    let sharingCameraOrMic =
      (sharingState?.camera || sharingState?.microphone) &&
      (types.includes("camera") || types.includes("microphone"));

    perms
      .filter(perm => {
        let [id] = perm.id.split(lazy.SitePermissions.PERM_KEY_DELIMITER);
        if (sharingCameraOrMic && (id == "camera" || id == "microphone")) {
          return true;
        }
        return types.includes(id);
      })
      .forEach(perm => {
        lazy.SitePermissions.removeFromPrincipal(
          browser.contentPrincipal,
          perm.id,
          browser
        );
      });

    if (!sharingState?.windowId) {
      return;
    }

    // If the device of the permission we're clearing is currently active,
    // tell the WebRTC implementation to stop sharing it.
    let { windowId } = sharingState;

    let windowIds = [];
    if (types.includes("screen") && sharingState.screen) {
      windowIds.push(`screen:${windowId}`);
    }
    if (sharingCameraOrMic) {
      windowIds.push(windowId);
    }

    if (!windowIds.length) {
      return;
    }

    let actor =
      sharingState.browsingContext.currentWindowGlobal.getActor("WebRTC");

    // Delete activePerms for all outerWindowIds under the current browser. We
    // need to do this prior to sending the stopSharing message, so WebRTCParent
    // can skip adding grace periods for these devices.
    webrtcUI.forgetActivePermissionsFromBrowser(browser);

    windowIds.forEach(id => actor.sendAsyncMessage("webrtc:StopSharing", id));
  },

  updateIndicators(aTopBrowsingContext) {
    let tabState = this.getCombinedStateForBrowser(aTopBrowsingContext);

    let indicators;
    if (this.perTabIndicators.has(aTopBrowsingContext)) {
      indicators = this.perTabIndicators.get(aTopBrowsingContext);
    } else {
      indicators = {};
      this.perTabIndicators.set(aTopBrowsingContext, indicators);
    }

    indicators.showCameraIndicator = tabState.showCameraIndicator;
    indicators.showMicrophoneIndicator = tabState.showMicrophoneIndicator;
    indicators.showScreenSharingIndicator = tabState.showScreenSharingIndicator;
    this.updateGlobalIndicator();

    return tabState;
  },

  swapBrowserForNotification(aOldBrowser, aNewBrowser) {
    for (let stream of this._streams) {
      if (stream.browser == aOldBrowser) {
        stream.browser = aNewBrowser;
      }
    }
  },

  /**
   * Remove all entries from the activePerms map for a browser, including all
   * child frames.
   * Note: activePerms is an internal WebRTC UI permission map and does not
   * reflect the PermissionManager or SitePermissions state.
   * @param aBrowser - Browser to clear active permissions for.
   */
  forgetActivePermissionsFromBrowser(aBrowser) {
    let browserWindowIds = aBrowser.browsingContext
      .getAllBrowsingContextsInSubtree()
      .map(bc => bc.currentWindowGlobal?.outerWindowId)
      .filter(id => id != null);
    browserWindowIds.push(aBrowser.outerWindowId);
    browserWindowIds.forEach(id => this.activePerms.delete(id));
  },

  /**
   * Shows the Permission Panel for the tab associated with the provided
   * active stream.
   * @param aActiveStream - The stream that the user wants to see permissions for.
   * @param aEvent - The user input event that is invoking the panel. This can be
   *        undefined / null if no such event exists.
   */
  showSharingDoorhanger(aActiveStream, aEvent) {
    let browserWindow = aActiveStream.browser.ownerGlobal;
    if (aActiveStream.tab) {
      browserWindow.gBrowser.selectedTab = aActiveStream.tab;
    } else {
      aActiveStream.browser.focus();
    }
    browserWindow.focus();

    if (AppConstants.platform == "macosx" && !Services.focus.activeWindow) {
      browserWindow.addEventListener(
        "activate",
        function () {
          Services.tm.dispatchToMainThread(function () {
            browserWindow.gPermissionPanel.openPopup(aEvent);
          });
        },
        { once: true }
      );
      Cc["@mozilla.org/widget/macdocksupport;1"]
        .getService(Ci.nsIMacDockSupport)
        .activateApplication(true);
      return;
    }
    browserWindow.gPermissionPanel.openPopup(aEvent);
  },

  updateWarningLabel(aMenuList) {
    let type = aMenuList.selectedItem.getAttribute("devicetype");
    let document = aMenuList.ownerDocument;
    document.getElementById("webRTC-all-windows-shared").hidden =
      type != "screen";
  },

  // Add-ons can override stock permission behavior by doing:
  //
  //   webrtcUI.addPeerConnectionBlocker(function(aParams) {
  //     // new permission checking logic
  //   }));
  //
  // The blocking function receives an object with origin, callID, and windowID
  // parameters.  If it returns the string "deny" or a Promise that resolves
  // to "deny", the connection is immediately blocked.  With any other return
  // value (though the string "allow" is suggested for consistency), control
  // is passed to other registered blockers.  If no registered blockers block
  // the connection (or of course if there are no registered blockers), then
  // the connection is allowed.
  //
  // Add-ons may also use webrtcUI.on/off to listen to events without
  // blocking anything:
  //   peer-request-allowed is emitted when a new peer connection is
  //                        established (and not blocked).
  //   peer-request-blocked is emitted when a peer connection request is
  //                        blocked by some blocking connection handler.
  //   peer-request-cancel is emitted when a peer-request connection request
  //                       is canceled.  (This would typically be used in
  //                       conjunction with a blocking handler to cancel
  //                       a user prompt or other work done by the handler)
  addPeerConnectionBlocker(aCallback) {
    this.peerConnectionBlockers.add(aCallback);
  },

  removePeerConnectionBlocker(aCallback) {
    this.peerConnectionBlockers.delete(aCallback);
  },

  on(...args) {
    return this.emitter.on(...args);
  },

  off(...args) {
    return this.emitter.off(...args);
  },

  getHostOrExtensionName(uri, href) {
    let host;
    try {
      if (!uri) {
        uri = Services.io.newURI(href);
      }

      let addonPolicy = WebExtensionPolicy.getByURI(uri);
      host = addonPolicy?.name ?? uri.hostPort;
    } catch (ex) {}

    if (!host) {
      if (uri && uri.scheme.toLowerCase() == "about") {
        // For about URIs, just use the full spec, without any #hash parts.
        host = uri.specIgnoringRef;
      } else {
        // This is unfortunate, but we should display *something*...
        host = lazy.syncL10n.formatValueSync(
          "webrtc-sharing-menuitem-unknown-host"
        );
      }
    }
    return host;
  },

  updateGlobalIndicator() {
    for (let chromeWin of Services.wm.getEnumerator("navigator:browser")) {
      if (this.showGlobalIndicator) {
        showOrCreateMenuForWindow(chromeWin);
      } else {
        let doc = chromeWin.document;
        let existingMenu = doc.getElementById("tabSharingMenu");
        if (existingMenu) {
          existingMenu.hidden = true;
        }
        if (AppConstants.platform == "macosx") {
          let separator = doc.getElementById("tabSharingSeparator");
          if (separator) {
            separator.hidden = true;
          }
        }
      }
    }

    if (this.showGlobalIndicator) {
      if (!gIndicatorWindow) {
        gIndicatorWindow = getGlobalIndicator();
      } else {
        try {
          gIndicatorWindow.updateIndicatorState();
        } catch (err) {
          console.error(
            `error in gIndicatorWindow.updateIndicatorState(): ${err.message}`
          );
        }
      }
    } else if (gIndicatorWindow) {
      if (gIndicatorWindow.closingInternally) {
        // Before calling .close(), we call .closingInternally() to allow us to
        // differentiate between situations where the indicator closes because
        // we no longer want to show the indicator (this case), and cases where
        // the user has found a way to close the indicator via OS window control
        // mechanisms.
        gIndicatorWindow.closingInternally();
      }
      gIndicatorWindow.close();
      gIndicatorWindow = null;
    }
  },

  getWindowShareState(window) {
    if (this.sharingScreen) {
      return this.SHARING_SCREEN;
    } else if (this.sharedBrowserWindows.has(window)) {
      return this.SHARING_WINDOW;
    }
    return this.SHARING_NONE;
  },

  tabAddedWhileSharing(tab) {
    this.allowedSharedBrowsers.add(tab.linkedBrowser.permanentKey);
  },

  shouldShowSharedTabWarning(tab) {
    if (!tab || !tab.linkedBrowser) {
      return false;
    }

    let browser = tab.linkedBrowser;
    // We want the user to be able to switch to one tab after starting
    // to share their window or screen. The presumption here is that
    // most users will have a single window with multiple tabs, where
    // the selected tab will be the one with the screen or window
    // sharing web application, and it's most likely that the contents
    // that the user wants to share are in another tab that they'll
    // switch to immediately upon sharing. These presumptions are based
    // on research that our user research team did with users using
    // video conferencing web applications.
    if (!this.tabSwitchCountForSession) {
      this.allowedSharedBrowsers.add(browser.permanentKey);
    }

    this.tabSwitchCountForSession++;
    let shouldShow =
      !this.allowTabSwitchesForSession &&
      !this.allowedSharedBrowsers.has(browser.permanentKey);

    return shouldShow;
  },

  allowSharedTabSwitch(tab, allowForSession) {
    let browser = tab.linkedBrowser;
    let gBrowser = browser.getTabBrowser();
    this.allowedSharedBrowsers.add(browser.permanentKey);
    gBrowser.selectedTab = tab;
    this.allowTabSwitchesForSession = allowForSession;
  },

  /**
   * Updates the sharedData structure to reflect shared screen and window
   * state. This sets the following key: data pairs on sharedData.
   * - "webrtcUI:isSharingScreen": a boolean value reflecting
   * this.sharingScreen.
   * - "webrtcUI:sharedTopInnerWindowIds": a set containing the inner window
   * ids of each top level browser window that is in sharedBrowserWindows.
   */
  _setSharedData() {
    let sharedTopInnerWindowIds = new Set();
    for (let win of lazy.BrowserWindowTracker.orderedWindows) {
      if (this.sharedBrowserWindows.has(win)) {
        sharedTopInnerWindowIds.add(
          win.browsingContext.currentWindowGlobal.innerWindowId
        );
      }
    }
    Services.ppmm.sharedData.set(
      "webrtcUI:isSharingScreen",
      this.sharingScreen
    );
    Services.ppmm.sharedData.set(
      "webrtcUI:sharedTopInnerWindowIds",
      sharedTopInnerWindowIds
    );
  },
};

function getGlobalIndicator() {
  const INDICATOR_CHROME_URI = "chrome://browser/content/webrtcIndicator.xhtml";
  let features = "chrome,titlebar=no,alwaysontop,minimizable,dialog";

  return Services.ww.openWindow(
    null,
    INDICATOR_CHROME_URI,
    "_blank",
    features,
    null
  );
}

/**
 * Add a localized stream sharing menu to the event target
 *
 * @param {Window} win - The parent `window`
 * @param {Event} event - The popupshowing event for the <menu>.
 * @param {boolean} inclWindow - Should the window stream be included in the active streams.
 */
export function showStreamSharingMenu(win, event, inclWindow = false) {
  win.MozXULElement.insertFTLIfNeeded("browser/webrtcIndicator.ftl");
  const doc = win.document;
  const menu = event.target;

  let type = menu.getAttribute("type");
  let activeStreams;
  if (type == "Camera") {
    activeStreams = webrtcUI.getActiveStreams(true, false, false);
  } else if (type == "Microphone") {
    activeStreams = webrtcUI.getActiveStreams(false, true, false);
  } else if (type == "Screen") {
    activeStreams = webrtcUI.getActiveStreams(false, false, true, inclWindow);
    type = webrtcUI.showScreenSharingIndicator;
  }

  if (!activeStreams.length) {
    event.preventDefault();
    return;
  }

  const l10nIds = SHARING_L10NID_BY_TYPE.get(type) ?? [];
  if (activeStreams.length == 1) {
    let stream = activeStreams[0];

    const sharingItem = doc.createXULElement("menuitem");
    const displayHost = getDisplayHostForStream(stream);
    doc.l10n.setAttributes(sharingItem, l10nIds[0], {
      streamTitle: displayHost,
    });
    sharingItem.setAttribute("disabled", "true");
    menu.appendChild(sharingItem);

    const controlItem = doc.createXULElement("menuitem");
    doc.l10n.setAttributes(
      controlItem,
      "webrtc-indicator-menuitem-control-sharing"
    );
    controlItem.stream = stream;
    controlItem.addEventListener("command", this);

    menu.appendChild(controlItem);
  } else {
    // We show a different menu when there are several active streams.
    const sharingItem = doc.createXULElement("menuitem");
    doc.l10n.setAttributes(sharingItem, l10nIds[1], {
      tabCount: activeStreams.length,
    });
    sharingItem.setAttribute("disabled", "true");
    menu.appendChild(sharingItem);

    for (let stream of activeStreams) {
      const controlItem = doc.createXULElement("menuitem");
      const displayHost = getDisplayHostForStream(stream);
      doc.l10n.setAttributes(
        controlItem,
        "webrtc-indicator-menuitem-control-sharing-on",
        { streamTitle: displayHost }
      );
      controlItem.stream = stream;
      controlItem.addEventListener("command", this);
      menu.appendChild(controlItem);
    }
  }
}

function getDisplayHostForStream(stream) {
  let uri = Services.io.newURI(stream.uri);

  let displayHost;

  try {
    displayHost = uri.displayHost;
  } catch (ex) {
    displayHost = null;
  }

  // Host getter threw or returned "". Fall back to spec.
  if (displayHost == null || displayHost == "") {
    displayHost = uri.displaySpec;
  }

  return displayHost;
}

function onTabSharingMenuPopupShowing(e) {
  const streams = webrtcUI.getActiveStreams(true, true, true, true);
  for (let streamInfo of streams) {
    const names = streamInfo.devices.map(({ mediaSource }) => {
      const l10nId = MEDIA_SOURCE_L10NID_BY_TYPE.get(mediaSource);
      return l10nId ? lazy.syncL10n.formatValueSync(l10nId) : mediaSource;
    });

    const doc = e.target.ownerDocument;
    const menuitem = doc.createXULElement("menuitem");
    doc.l10n.setAttributes(menuitem, "webrtc-sharing-menuitem", {
      origin: webrtcUI.getHostOrExtensionName(null, streamInfo.uri),
      itemList: lazy.listFormat.format(names),
    });
    menuitem.stream = streamInfo;
    menuitem.addEventListener("command", onTabSharingMenuPopupCommand);
    e.target.appendChild(menuitem);
  }
}

function onTabSharingMenuPopupHiding() {
  while (this.lastChild) {
    this.lastChild.remove();
  }
}

function onTabSharingMenuPopupCommand(e) {
  webrtcUI.showSharingDoorhanger(e.target.stream, e);
}

function showOrCreateMenuForWindow(aWindow) {
  let document = aWindow.document;
  let menu = document.getElementById("tabSharingMenu");
  if (!menu) {
    menu = document.createXULElement("menu");
    menu.id = "tabSharingMenu";
    document.l10n.setAttributes(menu, "webrtc-sharing-menu");

    let container, insertionPoint;
    if (AppConstants.platform == "macosx") {
      container = document.getElementById("menu_ToolsPopup");
      insertionPoint = document.getElementById("devToolsSeparator");
      let separator = document.createXULElement("menuseparator");
      separator.id = "tabSharingSeparator";
      container.insertBefore(separator, insertionPoint);
    } else {
      container = document.getElementById("main-menubar");
      insertionPoint = document.getElementById("helpMenu");
    }
    let popup = document.createXULElement("menupopup");
    popup.id = "tabSharingMenuPopup";
    popup.addEventListener("popupshowing", onTabSharingMenuPopupShowing);
    popup.addEventListener("popuphiding", onTabSharingMenuPopupHiding);
    menu.appendChild(popup);
    container.insertBefore(menu, insertionPoint);
  } else {
    menu.hidden = false;
    if (AppConstants.platform == "macosx") {
      document.getElementById("tabSharingSeparator").hidden = false;
    }
  }
}

var gIndicatorWindow = null;
