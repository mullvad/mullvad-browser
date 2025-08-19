/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  NimbusFeatures: "resource://nimbus/ExperimentAPI.sys.mjs",
});

const { EnterprisePolicyTesting } = ChromeUtils.importESModule(
  "resource://testing-common/EnterprisePolicyTesting.sys.mjs"
);

const test = new SearchConfigTest({
  identifier: "google",
  aliases: ["@google"],
  default: {
    // Included everywhere apart from the exclusions below. These are basically
    // just excluding what Baidu includes.
    excluded: [
      {
        regions: ["cn"],
        locales: ["zh-CN"],
      },
    ],
  },
  available: {
    excluded: [
      // Should be available everywhere.
    ],
  },
  details: [
    {
      included: [{ regions: ["us"] }],
      domain: "google.com",
      telemetryId:
        SearchUtils.MODIFIED_APP_CHANNEL == "esr"
          ? "google-b-1-e"
          : "google-b-1-d",
      searchUrlCode:
        SearchUtils.MODIFIED_APP_CHANNEL == "esr"
          ? "client=firefox-b-1-e"
          : "client=firefox-b-1-d",
      partnerCode:
        SearchUtils.MODIFIED_APP_CHANNEL == "esr"
          ? "firefox-b-1-e"
          : "firefox-b-1-d",
    },
    {
      excluded: [{ regions: ["us", "by", "kz", "ru", "tr"] }],
      included: [{}],
      domain: "google.com",
      telemetryId:
        SearchUtils.MODIFIED_APP_CHANNEL == "esr" ? "google-b-e" : "google-b-d",
      searchUrlCode:
        SearchUtils.MODIFIED_APP_CHANNEL == "esr"
          ? "client=firefox-b-e"
          : "client=firefox-b-d",
      partnerCode:
        SearchUtils.MODIFIED_APP_CHANNEL == "esr"
          ? "firefox-b-e"
          : "firefox-b-d",
    },
    {
      included: [{ regions: ["by", "kz", "ru", "tr"] }],
      domain: "google.com",
      telemetryId: "google-com-nocodes",
      partnerCode: "",
    },
  ],
});

add_setup(async function () {
  sinon.spy(NimbusFeatures.searchConfiguration, "onUpdate");
  sinon.stub(NimbusFeatures.searchConfiguration, "ready").resolves();
  await test.setup();

  // This is needed to make sure the search settings can be loaded
  // when the search service is initialized.
  do_get_profile();

  registerCleanupFunction(async () => {
    sinon.restore();
  });
});

add_task(async function test_searchConfig_google() {
  await test.run();
});

// We skip this test on ESR as on the ESR channel, we don't set up nimbus
// because we are not using any experiments there - the channel pref is used
// for enterprise, rather than the google_channel_* experiment options.
add_task(
  { skip_if: () => SearchUtils.MODIFIED_APP_CHANNEL == "esr" },
  async function test_searchConfig_google_with_nimbus() {
    let sandbox = sinon.createSandbox();
    // Test a couple of configurations with a preference parameter set up.
    const TEST_DATA = [
      {
        locale: "en-US",
        region: "US",
        expected: "nimbus_us_param",
      },
      {
        locale: "en-US",
        region: "GB",
        expected: "nimbus_row_param",
      },
    ];

    Assert.ok(
      NimbusFeatures.searchConfiguration.onUpdate.called,
      "Should register an update listener for Nimbus experiments"
    );
    // Stub getVariable to populate the cache with our expected data
    sandbox.stub(NimbusFeatures.searchConfiguration, "getVariable").returns([
      { key: "google_channel_us", value: "nimbus_us_param" },
      { key: "google_channel_row", value: "nimbus_row_param" },
    ]);
    // Set the pref cache with Nimbus values
    NimbusFeatures.searchConfiguration.onUpdate.firstCall.args[0]();

    for (const testData of TEST_DATA) {
      info(`Checking region ${testData.region}, locale ${testData.locale}`);
      const { engines } = await test._getEngines(
        testData.region,
        testData.locale
      );

      Assert.ok(
        engines[0].identifier.startsWith("google"),
        "Should have the correct engine"
      );

      const submission = engines[0].getSubmission("test", URLTYPE_SEARCH_HTML);
      Assert.ok(
        NimbusFeatures.searchConfiguration.ready.called,
        "Should wait for Nimbus to get ready"
      );
      Assert.ok(
        NimbusFeatures.searchConfiguration.getVariable,
        "Should call NimbusFeatures.searchConfiguration.getVariable to populate the cache"
      );
      Assert.ok(
        submission.uri.query
          .split("&")
          .includes("channel=" + testData.expected),
        "Should be including the correct preference parameter for the engine"
      );
    }

    sandbox.restore();
  }
);

async function assertEnterpriseParameter(useEmptyPolicy) {
  // Test a couple of configurations.
  const TEST_DATA = [
    {
      locale: "en-US",
      region: "US",
    },
    {
      locale: "en-US",
      region: "GB",
    },
  ];

  Services.search.wrappedJSObject.reset();
  await EnterprisePolicyTesting.setupPolicyEngineWithJson(
    useEmptyPolicy
      ? {}
      : {
          policies: {
            BlockAboutSupport: true,
          },
        }
  );
  await Services.search.init();

  for (const testData of TEST_DATA) {
    info(`Checking region ${testData.region}, locale ${testData.locale}`);
    const { engines } = await test._getEngines(
      testData.region,
      testData.locale
    );

    Assert.ok(
      engines[0].identifier.startsWith("google"),
      "Should have the correct engine"
    );

    const submission = engines[0].getSubmission("test", URLTYPE_SEARCH_HTML);
    Assert.ok(
      submission.uri.query.split("&").includes("channel=entpr"),
      "Should be including the correct preference parameter for the engine"
    );
  }
}

// On ESR the channel parameter should always be `entpr`, regardless of if
// enterprise policies are set up or not.
add_task(
  { skip_if: () => SearchUtils.MODIFIED_APP_CHANNEL != "esr" },
  async function test_searchConfig_google_enterprise_on_esr() {
    await assertEnterpriseParameter(true);
  }
);

// If there's a policy set, we should also have the channel=entpr parameter
// set.
add_task(async function test_searchConfig_google_enterprise_policy() {
  await assertEnterpriseParameter(false);
});
