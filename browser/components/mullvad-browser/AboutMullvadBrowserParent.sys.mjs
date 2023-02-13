/**
 * Actor parent class for the about:mullvad-browser page.
 */
export class AboutMullvadBrowserParent extends JSWindowActorParent {
  receiveMessage(message) {
    const shouldNotifyPref = "mullvadbrowser.post_update.shouldNotify";
    switch (message.name) {
      case "AboutMullvadBrowser:GetUpdateData": {
        if (!Services.prefs.getBoolPref(shouldNotifyPref, false)) {
          return Promise.resolve(null);
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

        return Promise.resolve({
          version: Services.prefs.getCharPref(
            "browser.startup.homepage_override.mullvadbrowser.version"
          ),
          url: updateURL,
        });
      }
    }
    return undefined;
  }
}
