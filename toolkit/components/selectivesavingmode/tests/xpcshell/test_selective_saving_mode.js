/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  SelectiveSavingPrefController,
  SelectiveSavingModes,
  kSelectiveSavingModePref,
} = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/selectivesavingmode/SelectiveSavingMode.sys.mjs"
);

// secondary prefs
const kSanitizeOnShutdown = "privacy.sanitize.sanitizeOnShutdown";
const kPrivateBrowsingAutostart = "browser.privatebrowsing.autostart";
const kKeepPermissionInMemory = "permissions.memory_only";

const controller = new SelectiveSavingPrefController();

function resetToTotalSavingPrefs() {
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);
}

registerCleanupFunction(async () => {
  controller.shutdown();
});

add_task(async function test_init_from_secondary_prefs() {
  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.unconfigured
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.total_clearing,
    "After pref controller init from unconfigured state, primary pref should be set to total clearing due to the way secondary prefs were set earlier"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.unconfigured
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.selective_saving,
    "After pref controller init from unconfigured state, primary pref should be set to selective saving due to the way secondary prefs were set earlier"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.unconfigured
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.normal_browsing,
    "After pref controller init from unconfigured state, primary pref should be set to normal browsing due to the way secondary prefs were set earlier"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.unconfigured
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "After pref controller init from unconfigured state, primary pref should be set to custom browsing due to the way secondary prefs were set earlier"
  );

  controller.shutdown();
});

add_task(async function test_init_from_secondary_prefs() {
  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.total_clearing
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.total_clearing,
    "After pref controller init from total clearing mode configured state (primary and secondary), primary pref shouldn't be changed from total clearing"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "After pref controller init from total clearing mode configured state (primary and secondary), secondary pref for sanitize on shutdown should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    true,
    "After pref controller init from total clearing mode configured state (primary and secondary), secondary pref for pbm autostart should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    true,
    "After pref controller init from total clearing mode configured state (primary and secondary), secondary pref for memory only permissions should be set to true"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.selective_saving
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.selective_saving,
    "After pref controller init from selective saving configured state (primary and secondary), primary pref shouldn't be changed from selective saving"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "After pref controller init from selective saving mode configured state (primary and secondary), secondary pref for sanitize on shutdown should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "After pref controller init from selective saving mode configured state (primary and secondary), secondary pref for pbm autostart should be set to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "After pref controller init from selective saving mode configured state (primary and secondary), secondary pref for memory only permissions should be set to false"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.normal_browsing
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.normal_browsing,
    "After pref controller init from normal browsing mode configured state (primary and secondary), primary pref shouldn't be changed from normal browsing"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    false,
    "After pref controller init from normal browsing mode configured state (primary and secondary), secondary pref for sanitize on shutdown should be set to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "After pref controller init from normal browsing mode configured state (primary and secondary), secondary pref for pbm autostart should be set to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "After pref controller init from normal browsing mode configured state (primary and secondary), secondary pref for memory only permissions should be set to false"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.custom
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "After pref controller init from custom mode configured state (primary and secondary), primary pref shouldn't be changed from custom"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "After pref contoller init from total clearing mode configured state (primary and secondary), secondary pref for sanitize on shutdown should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    true,
    "After pref contoller init from total clearing mode configured state (primary and secondary), secondary pref for pbm autostart should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "After pref contoller init from total clearing mode configured state (primary and secondary), secondary pref for memory only permissions should be set to false"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.total_clearing
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.total_clearing,
    "After pref controller init from configured state, primary pref shouldn't be changed from total clearing"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "After pref contoller init from total clearing mode configured state, secondary pref for sanitize on shutdown should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    true,
    "After pref contoller init from total clearing mode configured state, secondary pref for pbm autostart should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    true,
    "After pref contoller init from total clearing mode configured state, secondary pref for memory only permissions should be set to true"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.selective_saving
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.selective_saving,
    "After pref controller init from configured state, primary pref shouldn't be changed from normal browsing"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "After pref contoller init from selective saving mode configured state, secondary pref for sanitize on shutdown should be set to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "After pref contoller init from selective saving mode configured state, secondary pref for pbm autostart should be set to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "After pref contoller init from selective saving mode configured state, secondary pref for memory only permissions should be set to false"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.normal_browsing
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.normal_browsing,
    "After pref controller init from configured state, primary pref shouldn't be changed from normal browsing"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    false,
    "After pref contoller init from normal browsing mode configured state, secondary pref for sanitize on shutdown should be set to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "After pref contoller init from normal browsing mode configured state, secondary pref for pbm autostart should be set to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "After pref contoller init from normal browsing mode configured state, secondary pref for memory only permissions should be set to false"
  );

  controller.shutdown();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.custom
  );
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  controller.init();

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "After pref controller init from configured state, primary pref shouldn't be changed from custom"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    false,
    "After pref contoller init from custom mode configured state, secondary pref for sanitize on shutdown should remain unchanged"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "After pref contoller init from custom mode configured state, secondary pref for pbm autostart should remain unchanged"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "After pref contoller init from custom mode configured state, secondary pref for memory only permissions should remain unchanged"
  );
});

add_task(async function test_secondary_prefs_update_mode() {
  controller.init();

  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.total_clearing,
    "After pref update mode should be set to total clearing"
  );

  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.selective_saving,
    "After pref update mode should be set to selective saving"
  );

  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.normal_browsing,
    "After pref update mode should be set to normal browsing"
  );

  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.normal_browsing,
    "Duplicate for idempotency. after pref update mode should be set to normal browsing"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    false,
    "Duplicate for idempotency. Changing browsing mode to normal browsing should set sanitize on shutdown to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "Duplicate for idempotency. Changing browsing mode to normal browsing should set pbm autostart to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "Duplicate for idempotency. Changing browsing mode to normal browsing should set memory only permissions to false"
  );

  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "After pref update mode should be set to custom"
  );

  resetToTotalSavingPrefs();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.custom
  );
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.selective_saving,
    "Manually changing to custom browsing via primary pref then changing secondary prefs to match another browsing mode should leave custom browsing"
  );

  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "Secondary Prefs set to (true, true, false) should result in Custom Browsing Mode"
  );

  Services.prefs.setBoolPref(kSanitizeOnShutdown, true);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "Secondary Prefs set to (true, false, true) should result in Custom Browsing Mode"
  );

  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "Secondary Prefs set to (false, false, true) should result in Custom Browsing Mode"
  );

  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "Secondary Prefs set to (false, true, false) should result in Custom Browsing Mode"
  );

  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, true);
  Services.prefs.setBoolPref(kKeepPermissionInMemory, true);

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "Secondary Prefs set to (false, true, true) should result in Custom Browsing Mode"
  );
});

add_task(async function test_mode_updates_from_secondary_prefs() {
  controller.init();

  Services.prefs.setBoolPref(kKeepPermissionInMemory, false);
  Services.prefs.setBoolPref(kPrivateBrowsingAutostart, false);
  Services.prefs.setBoolPref(kSanitizeOnShutdown, false);

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.total_clearing
  );

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.total_clearing,
    "Changing browsing mode to total clearing should set browsing mode to match"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "Changing browsing mode to total clearing should set sanitize on shutdown to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    true,
    "Changing browsing mode to total clearing should set pbm autostart to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    true,
    "Changing browsing mode to total clearing should set memory only permissions to true"
  );

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.total_clearing
  );

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.total_clearing,
    "Duplicate for idempotency. Changing browsing mode to total clearing should set browsing mode to match"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "Duplicate for idempotency. Changing browsing mode to total clearing should set sanitize on shutdown to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    true,
    "Duplicate for idempotency. Changing browsing mode to total clearing should set pbm autostart to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    true,
    "Duplicate for idempotency. Changing browsing mode to total clearing should set memory only permissions to true"
  );

  resetToTotalSavingPrefs();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.selective_saving
  );

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.selective_saving,
    "Changing browsing mode to selective saving should set browsing mode to match"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "Changing browsing mode to selective saving should set sanitize on shutdown to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "Changing browsing mode to selective saving should set pbm autostart to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "Changing browsing mode to selective saving should set memory only permissions to false"
  );

  resetToTotalSavingPrefs();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.normal_browsing
  );

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.normal_browsing,
    "Changing browsing mode to normal browsing should set browsing mode to match"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    false,
    "Changing browsing mode to normal browsing should set sanitize on shutdown to true"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    false,
    "Changing browsing mode to normal browsing should set pbm autostart to false"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    false,
    "Changing browsing mode to normal browsing should set memory only permissions to false"
  );

  resetToTotalSavingPrefs();

  for (const sanitize of [false, true]) {
    for (const pbmAutostart of [false, true]) {
      for (const permissions of [false, true]) {
        Services.prefs.setBoolPref(kSanitizeOnShutdown, sanitize);
        Services.prefs.setBoolPref(kPrivateBrowsingAutostart, pbmAutostart);
        Services.prefs.setBoolPref(kKeepPermissionInMemory, permissions);

        if (sanitize && pbmAutostart && permissions) {
          Assert.equal(
            Services.prefs.getIntPref(kSelectiveSavingModePref),
            SelectiveSavingModes.total_clearing,
            "pref settings for true true true should result in total clearing"
          );
        } else if (sanitize && !pbmAutostart && !permissions) {
          Assert.equal(
            Services.prefs.getIntPref(kSelectiveSavingModePref),
            SelectiveSavingModes.selective_saving,
            "pref settings for true false false should result in selective saving"
          );
        } else if (!sanitize && !pbmAutostart && !permissions) {
          Assert.equal(
            Services.prefs.getIntPref(kSelectiveSavingModePref),
            SelectiveSavingModes.normal_browsing,
            "pref settings for false false false should result in normal browsing"
          );
        } else {
          Assert.equal(
            Services.prefs.getIntPref(kSelectiveSavingModePref),
            SelectiveSavingModes.custom,
            `pref settings of ${sanitize} ${pbmAutostart} ${permissions} should result in custom browsing`
          );
        }
      }
    }
  }

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.custom
  );

  Assert.equal(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.custom,
    "Manually changing to custom browsing via primary pref should happen regardless of secondary prefs"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "Changing browsing mode to custom should leave sanitize on shutdown as previously set"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    true,
    "Changing browsing mode to custom should leave pbm autostart as previously set"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    true,
    "Changing browsing mode to custom should leave memory only permissions as previously set"
  );

  resetToTotalSavingPrefs();

  Services.prefs.setIntPref(
    kSelectiveSavingModePref,
    SelectiveSavingModes.unconfigured
  );

  Assert.notEqual(
    Services.prefs.getIntPref(kSelectiveSavingModePref),
    SelectiveSavingModes.unconfigured,
    "Manually changing to unconfigured mode via primary pref should set primary pref based on secondary prefs"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kSanitizeOnShutdown),
    true,
    "Changing browsing mode to unconfigured should leave sanitize on shutdown as previously set"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kPrivateBrowsingAutostart),
    true,
    "Changing browsing mode to unconfigured should leave pbm autostart to true as previously set"
  );

  Assert.equal(
    Services.prefs.getBoolPref(kKeepPermissionInMemory),
    true,
    "Changing browsing mode to unconfigured should leave memory only permissions to true as previously set"
  );
});
