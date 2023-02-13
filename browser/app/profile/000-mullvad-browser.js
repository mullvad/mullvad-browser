// Preferences specific to Mullvad Browser

pref("browser.startup.homepage", "about:mullvad-browser");

// General browser support url. tor-browser#43864 and mullvad-browser#244.
pref("browser.base-browser-support-url", "https://mullvad.net/en/help/");

// Do not show the bookmark panel for now, because it makes the initial browser
// window (about:home) bigger, and regular pages will show letterbox margins as
// a result.
pref("browser.toolbars.bookmarks.visibility", "never");

// mullvad-browser#19: Enable Mullvad's DOH
pref("network.trr.uri", "https://doh-mullvad.quad9.net/dns-query");
pref("network.trr.default_provider_uri", "https://doh-mullvad.quad9.net/dns-query");
pref("network.trr.mode", 3);
pref("doh-rollout.provider-list", "[{\"uri\":\"https://doh-mullvad.quad9.net/dns-query\",\"UIName\":\"Quad9 - no threat blocking\",\"schema\":0,\"autoDefault\":false,\"canonicalName\":\"\",\"id\":\"quad9-no-threat-blocking\",\"last_modified\":0},{\"uri\":\"https://dns.quad9.net/dns-query\",\"UIName\":\"Quad9 - secure: threat blocking\",\"schema\":0,\"autoDefault\":true,\"canonicalName\":\"\",\"id\":\"quad9-threat-blocking\",\"last_modified\":0}]");
// mullvad-browser#122: Audit DoH heuristics
pref("doh-rollout.disable-heuristics", true);
// mullvad-browser#537: migrate users from Mullvad DoH service.
pref("mullvadbrowser.migration.show_doh_notification", false);

// mullvad-browser#87: Windows and Linux need additional work to make the
// default browser choice working.
// We are shipping only the portable versions for the initial release anyway, so
// we leave this popup enabled only on macOS.
#ifndef XP_MACOSX
pref("browser.shell.checkDefaultBrowser", false);
#endif

// mullvad-browser#228: default to spoof en-US and skip showing the dialog
pref("privacy.spoof_english", 2);

// mullvad-browser#222: Hide "List all tabs" when the tabs don't overflow
pref("browser.tabs.tabmanager.enabled", false);
