/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const emptyPage =
  getRootDirectory(gTestPath).replace(
    "chrome://mochitests/content",
    "https://example.com"
  ) + "empty.html";

add_task(async () => {
  // Verify that setting forceOffline returns false for navigator.onLine without RFP.
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, emptyPage);
  tab.linkedBrowser.browsingContext.forceOffline = true;
  const isOnlineNonRFP = await SpecialPowers.spawn(
    tab.linkedBrowser,
    [],
    () => content.navigator.onLine
  );
  is(isOnlineNonRFP, false, "navigator.onLine should be false without RFP");

  // Verify that setting forceOffline returns true for navigator.onLine with RFP.
  await SpecialPowers.pushPrefEnv({
    set: [
      ["privacy.fingerprintingProtection", true],
      [
        "privacy.fingerprintingProtection.overrides",
        "-AllTargets,+NetworkConnection",
      ],
    ],
  });

  const isOnlineRFP = await SpecialPowers.spawn(
    tab.linkedBrowser,
    [],
    () => content.navigator.onLine
  );
  is(isOnlineRFP, true, "navigator.onLine should be true with RFP");

  await SpecialPowers.popPrefEnv();

  BrowserTestUtils.removeTab(tab);
});
