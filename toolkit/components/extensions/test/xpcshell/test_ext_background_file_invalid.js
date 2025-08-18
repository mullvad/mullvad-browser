"use strict";

add_task(async function test_missing_background_file() {
  let extension = ExtensionTestUtils.loadExtension({
    // Extension startup is blocked on background startup (bug 1543354).
    // If we somehow fail to make progress, then we should notice that.
    delayedStartup: false,
    manifest: {
      background: { page: "non_existing_background_page.html" },
    },
    files: {
      "tab.html": `<script src="tab.js"></script>`,
      "tab.js": async () => {
        browser.test.assertEq(
          browser.extension.getBackgroundPage(),
          null,
          "extension.getBackgroundPage() is null"
        );
        browser.test.assertEq(
          await browser.runtime.getBackgroundPage(),
          null,
          "runtime.getBackgroundPage() is null"
        );
        browser.test.sendMessage("done");
      },
    },
  });
  info("Waiting for extension to start up");
  await extension.startup();

  if (WebExtensionPolicy.useRemoteWebExtensions) {
    // TODO bug 1978688: This is questionable, "stopped" would make more sense.
    // The current implementation detects the background load, because the
    // DOMContentLoaded event is fired right before the load navigates to an
    // error page.
    equal(extension.extension.backgroundState, "running", "backgroundState");
  } else {
    equal(extension.extension.backgroundState, "stopped", "backgroundState");
  }

  let contentPage = await ExtensionTestUtils.loadContentPage(
    `moz-extension://${extension.uuid}/tab.html`
  );
  await extension.awaitMessage("done");
  await contentPage.close();

  equal(
    extension.extension.backgroundState,
    // Should ideally be "stopped", but see above.
    WebExtensionPolicy.useRemoteWebExtensions ? "running" : "stopped",
    "backgroundState not changed"
  );

  await extension.unload();
});
