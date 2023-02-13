/**
 * Actor parent class for the about:mullvad-browser page.
 */
export class AboutMullvadBrowserParent extends JSWindowActorParent {
  /**
   * Whether this instance has a preloaded browser.
   *
   * @type {boolean}
   */
  #preloaded = false;

  /**
   * Method to be called when the browser corresponding to this actor has its
   * preloadedState attribute removed.
   */
  preloadedRemoved() {
    if (!this.#preloaded) {
      return;
    }
    this.#preloaded = false;
    // Send in the initial data now that the page is actually going to be
    // visible.
    this.sendAsyncMessage(
      "AboutMullvadBrowser:DelayedUpdateData",
      this.#getUpdateData()
    );
  }

  /**
   * Get the update data for the page.
   *
   * @returns {object?} - The update data, or `null` if no update should be
   *   shown.
   */
  #getUpdateData() {
    const shouldNotifyPref = "mullvadbrowser.post_update.shouldNotify";
    if (!Services.prefs.getBoolPref(shouldNotifyPref, false)) {
      return null;
    }
    Services.prefs.clearUserPref(shouldNotifyPref);
    // Try use the same URL as the about dialog. See mullvad-browser#411.
    let updateURL = Services.urlFormatter.formatURLPref(
      "app.releaseNotesURL.aboutDialog"
    );
    if (updateURL === "about:blank") {
      updateURL = Services.urlFormatter.formatURLPref(
        "startup.homepage_override_url"
      );
    }

    return {
      version: Services.prefs.getCharPref(
        "browser.startup.homepage_override.mullvadbrowser.version"
      ),
      url: updateURL,
    };
  }

  receiveMessage(message) {
    switch (message.name) {
      case "AboutMullvadBrowser:GetUpdateData": {
        const browser = this.browsingContext.top.embedderElement;
        if (browser?.getAttribute("preloadedState") === "preloaded") {
          // Wait until the page is actually about to be shown before sending
          // the initial data.
          // Otherwise the preloaded page might grab the updateData even though
          // it won't be shown as the landing page. See mullvad-browser#486.
          this.#preloaded = true;
          return Promise.resolve({ delayed: true });
        }
        return Promise.resolve({ updateData: this.#getUpdateData() });
      }
    }
    return undefined;
  }
}
