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

// mullvad-browser#94: Disable legacy global microphone/webcam indicator
// Disable the legacy Firefox Quantum-styled global webcam/microphone indicator in favor of each
// platform's native indicator
pref("privacy.webrtc.legacyGlobalIndicator", false);

// mullvad-browser#87: Windows and Linux need additional work to make the
// default browser choice working.
// We are shipping only the portable versions for the initial release anyway, so
// we leave this popup enabled only on macOS.
#ifndef XP_MACOSX
pref("browser.shell.checkDefaultBrowser", false);
#endif

// mullvad-browser#228: default to spoof en-US and skip showing the dialog
pref("privacy.spoof_english", 2);

// mullvad-browser#131: Review a few updater preferences
pref("app.update.notifyDuringDownload", true);
pref("app.update.url.manual", "https://mullvad.net/download/browser");
pref("app.update.url.details", "https://mullvad.net/download/browser");
pref("app.update.badgeWaitTime", 0);
pref("app.releaseNotesURL", "https://github.com/mullvad/mullvad-browser/releases");
// disables the 'What's New?' link in the about dialog, otherwise we need to
// duplicate logic for generating the url to the github releases page
pref("app.releaseNotesURL.aboutDialog", "about:blank");
// point to our feedback url rather than Mozilla's
pref("app.feedback.baseURL", "https://mullvad.net/help/tag/browser/");

// mullvad-browser#234: Do not spoof the OS in the User-Agent header
pref("privacy.resistFingerprinting.spoofOsInUserAgentHeader", false);
