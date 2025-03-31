// Preferences specific to Mullvad Browser

pref("browser.startup.homepage", "about:mullvad-browser");

// Do not show the bookmark panel for now, because it makes the initial browser
// window (about:home) bigger, and regular pages will show letterbox margins as
// a result.
pref("browser.toolbars.bookmarks.visibility", "never");

// mullvad-browser#19: Enable Mullvad's DOH
pref("network.trr.uri", "https://dns.mullvad.net/dns-query");
pref("network.trr.default_provider_uri", "https://dns.mullvad.net/dns-query");
pref("network.trr.mode", 3);
pref("doh-rollout.provider-list", "[{\"UIName\":\"Mullvad\",\"autoDefault\":true,\"canonicalName\":\"\",\"id\":\"mullvad\",\"last_modified\":0,\"schema\":0,\"uri\":\"https://dns.mullvad.net/dns-query\"},{\"UIName\":\"Mullvad (Ad-blocking)\",\"autoDefault\":false,\"canonicalName\":\"\",\"id\":\"mullvad\",\"last_modified\":0,\"schema\":0,\"uri\":\"https://adblock.dns.mullvad.net/dns-query\"}]");
// mullvad-browser#122: Audit DoH heuristics
pref("doh-rollout.disable-heuristics", true);

// mullvad-browser#37: Customization for the about dialog
pref("app.releaseNotesURL.aboutDialog", "about:blank");

// mullvad-browser#87: Windows and Linux need additional work to make the
// default browser choice working.
// We are shipping only the portable versions for the initial release anyway, so
// we leave this popup enabled only on macOS.
#ifndef XP_MACOSX
pref("browser.shell.checkDefaultBrowser", false);
#endif

// mullvad-browser#228: default to spoof en-US and skip showing the dialog
pref("privacy.spoof_english", 2);

// mullvad-browser#234: Do not spoof the OS in the User-Agent header
pref("privacy.resistFingerprinting.spoofOsInUserAgentHeader", false);

// mullvad-browser#222: Hide "List all tabs" when the tabs don't overflow
pref("browser.tabs.tabmanager.enabled", false);
