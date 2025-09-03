/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

/**
 * Empty clipboard content from private windows on exit.
 *
 * See tor-browser#42154.
 */
export const ClipboardPrivacy = {
  _lastClipboardHash: null,
  _globalActivation: false,
  _isPrivateClipboard: false,
  _hasher: null,
  _shuttingDown: false,
  _log: null,

  _createTransferable() {
    const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(
      Ci.nsITransferable
    );
    trans.init(null);
    return trans;
  },
  _computeClipboardHash() {
    const flavors = ["text/x-moz-url", "text/plain"];
    if (
      !Services.clipboard.hasDataMatchingFlavors(
        flavors,
        Ci.nsIClipboard.kGlobalClipboard
      )
    ) {
      return null;
    }
    const trans = this._createTransferable();
    flavors.forEach(trans.addDataFlavor);
    try {
      Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard);
      const clipboardContent = {};
      trans.getAnyTransferData({}, clipboardContent);
      const { data } = clipboardContent.value.QueryInterface(
        Ci.nsISupportsString
      );
      const bytes = new TextEncoder().encode(data);
      const hasher = (this._hasher ||= Cc[
        "@mozilla.org/security/hash;1"
      ].createInstance(Ci.nsICryptoHash));
      hasher.init(hasher.SHA256);
      hasher.update(bytes, bytes.length);
      return hasher.finish(true);
    } catch (e) {}
    return null;
  },

  init() {
    this._log = console.createInstance({
      prefix: "ClipboardPrivacy",
    });
    this._lastClipboardHash = this._computeClipboardHash();

    // Here we track changes in active window / application,
    // by filtering focus events and window closures.
    const handleActivation = (win, activation) => {
      if (activation) {
        if (!this._globalActivation) {
          // focus changed within this window, bail out.
          return;
        }
        this._globalActivation = false;
      } else if (!Services.focus.activeWindow) {
        // focus is leaving this window:
        // let's track whether it remains within the browser.
        lazy.setTimeout(() => {
          this._globalActivation = !Services.focus.activeWindow;
        }, 100);
      }

      const checkClipboardContent = () => {
        const clipboardHash = this._computeClipboardHash();
        if (clipboardHash !== this._lastClipboardHash) {
          this._isPrivateClipboard =
            !activation &&
            (lazy.PrivateBrowsingUtils.permanentPrivateBrowsing ||
              lazy.PrivateBrowsingUtils.isWindowPrivate(win));
          this._lastClipboardHash = clipboardHash;
          this._log.debug(
            `Clipboard changed: private ${this._isPrivateClipboard}, hash ${clipboardHash}.`
          );
        }
      };

      if (win.closed) {
        checkClipboardContent();
      } else {
        // defer clipboard access on DOM events to work-around tor-browser#42306
        lazy.setTimeout(checkClipboardContent, 0);
      }
    };
    const focusListener = e =>
      e.isTrusted && handleActivation(e.currentTarget, e.type === "focusin");
    const initWindow = win => {
      for (const e of ["focusin", "focusout"]) {
        win.addEventListener(e, focusListener);
      }
    };
    for (const w of Services.ww.getWindowEnumerator()) {
      initWindow(w);
    }
    Services.ww.registerNotification((win, event) => {
      switch (event) {
        case "domwindowopened":
          initWindow(win);
          break;
        case "domwindowclosed":
          handleActivation(win, false);
          if (
            this._isPrivateClipboard &&
            lazy.PrivateBrowsingUtils.isWindowPrivate(win) &&
            (this._shuttingDown ||
              !Array.from(Services.ww.getWindowEnumerator()).find(
                w =>
                  lazy.PrivateBrowsingUtils.isWindowPrivate(w) &&
                  // We need to filter out the HIDDEN WebExtensions window,
                  // which might be private as well but is not UI-relevant.
                  !w.location.href.startsWith("chrome://extensions/")
              ))
          ) {
            // no more private windows, empty private content if needed
            this.emptyPrivate();
          }
      }
    });

    lazy.AsyncShutdown.quitApplicationGranted.addBlocker(
      "ClipboardPrivacy: removing private data",
      () => {
        this._shuttingDown = true;
        this.emptyPrivate();
      }
    );
  },
  emptyPrivate() {
    if (
      this._isPrivateClipboard &&
      !Services.prefs.getBoolPref(
        "browser.privatebrowsing.preserveClipboard",
        false
      ) &&
      this._lastClipboardHash === this._computeClipboardHash()
    ) {
      // nsIClipboard.emptyClipboard() does nothing in Wayland:
      // we'll set an empty string as a work-around.
      const trans = this._createTransferable();
      const flavor = "text/plain";
      trans.addDataFlavor(flavor);
      const emptyString = Cc["@mozilla.org/supports-string;1"].createInstance(
        Ci.nsISupportsString
      );
      emptyString.data = "";
      trans.setTransferData(flavor, emptyString);
      const { clipboard } = Services,
        { kGlobalClipboard } = clipboard;
      clipboard.setData(trans, null, kGlobalClipboard);
      clipboard.emptyClipboard(kGlobalClipboard);
      this._lastClipboardHash = null;
      this._isPrivateClipboard = false;
      this._log.info("Private clipboard emptied.");
    }
  },
};
