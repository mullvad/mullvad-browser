/* Any copyright is dedicated to the Public Domain.
https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ProfileDataUpgrader } = ChromeUtils.importESModule(
  "moz-src:///browser/components/ProfileDataUpgrader.sys.mjs"
);

const DOH_NOTIFICATION_PREF = "mullvadbrowser.migration.show_doh_notification";
const DOH_URI_PREF = "network.trr.uri";
const DOH_MODE_PREF = "network.trr.mode";
const MULLVAD_ADBLOCK_URL = "https://adblock.dns.mullvad.net/dns-query";

/**
 * Run a test case.
 *
 * The test takes for granted the final mode can be either off (only if it was
 * already) or TRR-only in all other cases.
 * The caller need to supply the expected outcomes for the other prefs.
 *
 * @param {number} mode The mode to set before the migration
 * @param {string?} oldUri The URI to set before the migration, or null to clear
 *   the related preference.
 * @param {string?} newUri The expected new value for the preference, or null if
 *   the preference should have its default value.
 * @param {boolean} showNotification The expected value for the preference that
 *   signals that the change notification should be shown to the UI.
 */
async function runTest(mode, oldUri, newUri, showNotification) {
  info(`Running test for mode ${mode} and old uri ${oldUri}.`);

  Services.prefs.setIntPref(DOH_MODE_PREF, mode);
  if (oldUri !== null) {
    Services.prefs.setStringPref(DOH_URI_PREF, oldUri);
  } else {
    Services.prefs.clearUserPref(DOH_URI_PREF);
  }
  Services.prefs.clearUserPref(DOH_NOTIFICATION_PREF);

  await ProfileDataUpgrader.upgradeMB(false, 2);

  if (newUri) {
    Assert.equal(Services.prefs.getStringPref(DOH_URI_PREF), newUri);
  } else {
    Assert.ok(
      !Services.prefs.prefHasUserValue(DOH_URI_PREF),
      "The migration was supposed to clear the custom URI and so it did."
    );
  }

  if (mode === Ci.nsIDNSService.MODE_TRROFF) {
    Assert.equal(
      Services.prefs.getIntPref(DOH_MODE_PREF, -1),
      Ci.nsIDNSService.MODE_TRROFF,
      "The migration did not turn on DoH."
    );
  } else {
    Assert.equal(
      Services.prefs.getIntPref(DOH_MODE_PREF, -1),
      Ci.nsIDNSService.MODE_TRRONLY,
      "Regardless of the starting mode, after the migration we are on TRR-only."
    );
  }

  Assert.equal(
    Services.prefs.getBoolPref(DOH_NOTIFICATION_PREF, false),
    showNotification,
    `The value for ${DOH_NOTIFICATION_PREF} is correct after the migration`
  );
}

add_task(async function test_default_uri() {
  // Max protection (our default): inherits the URI change, so we need to show
  // the notification.
  await runTest(Ci.nsIDNSService.MODE_TRRONLY, null, null, true);
  // We move default and increased protection to maximum protection, and they
  // inherit the default URI: show the notification.
  await runTest(Ci.nsIDNSService.MODE_NATIVEONLY, null, null, true);
  await runTest(Ci.nsIDNSService.MODE_TRRFIRST, null, null, true);
});

add_task(async function test_mullvad_adblock() {
  // Mullvad Adblock was retired, so move to the default URI with maximum
  // protection. Show the notification.
  // This option could be set only with TRR first and TRR only, so test only
  // those.
  await runTest(
    Ci.nsIDNSService.MODE_TRRFIRST,
    MULLVAD_ADBLOCK_URL,
    null,
    true
  );
  await runTest(Ci.nsIDNSService.MODE_TRRONLY, MULLVAD_ADBLOCK_URL, null, true);
});

add_task(async function test_custom_provider() {
  const CUSTOM_URL = "https://example.org/dns";
  // Custom provider + TRR-only: nothing should change, do not show the
  // notification.
  await runTest(Ci.nsIDNSService.MODE_TRRONLY, CUSTOM_URL, CUSTOM_URL, false);
  // Custom provider but TRR-first: we change it to TRR-only, so we should show
  // a notification.
  await runTest(Ci.nsIDNSService.MODE_TRRFIRST, CUSTOM_URL, CUSTOM_URL, true);
  // Firefox's "default" mode and off automatically reset the provider URI, so
  // we do not test them here.
});

add_task(async function test_update_doh_disabled() {
  // No DoH: the migration should not turn it on. I.e., no changes, therefore no
  // notification as well.
  // Firefox resets the URL to the default one from the UI, so test only the
  // default URI case.
  await runTest(Ci.nsIDNSService.MODE_TRROFF, null, null, false);
});
