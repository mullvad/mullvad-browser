export class AboutMullvadBrowserParent extends JSWindowActorParent {
  receiveMessage(message) {
    const shouldNotifyPref = "mullvadbrowser.post_update.shouldNotify";
    switch (message.name) {
      case "AboutMullvadBrowser:GetUpdateData":
        if (!Services.prefs.getBoolPref(shouldNotifyPref, false)) {
          return Promise.resolve(null);
        }
        Services.prefs.clearUserPref(shouldNotifyPref);
        return Promise.resolve({
          version: Services.prefs.getCharPref(
            "browser.startup.homepage_override.mullvadbrowser.version"
          ),
          url:
            Services.prefs.getCharPref("mullvadbrowser.post_update.url", "") ||
            Services.urlFormatter.formatURLPref(
              "startup.homepage_override_url"
            ),
        });
    }
    return undefined;
  }
}
