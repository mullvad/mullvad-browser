/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This file contains branding-specific prefs.

pref("startup.homepage_override_url", "");
// app.update.url.manual: URL user can browse to manually if for some reason
// all update installation attempts fail.
// app.update.url.details: a default value for the "More information about this
// update" link supplied in the "An update is available" page of the update
// wizard.
pref("app.update.url.manual", "https://mullvad.net/download/browser#alpha");
pref("app.update.url.details", "https://mullvad.net/download/browser#alpha");
pref("app.releaseNotesURL", "https://github.com/mullvad/mullvad-browser/releases/tag/%BB_VERSION%");
pref("app.releaseNotesURL.aboutDialog", "https://github.com/mullvad/mullvad-browser/releases/tag/%BB_VERSION%");

// Interval: Time between checks for a new version (in seconds)
pref("app.update.interval", 43200); // 12 hours
// The number of days a binary is permitted to be old
// without checking for an update.  This assumes that
// app.update.checkInstallTime is true.
pref("app.update.checkInstallTime.days", 63);

// Number of usages of the web console.
// If this is less than 5, then pasting code into the web console is disabled
pref("devtools.selfxss.count", 0);
