"use strict";

const WEB_ACCESSIBLE_STRICTNESS_PREF =
  "extensions.content_web_accessible.enabled";

const server = createHttpServer({ hosts: ["example.com"] });

server.registerPathHandler("/dummy", (request, response) => {
  response.setStatusLine(request.httpVersion, 200, "OK");
  response.setHeader("Content-Type", "text/html", false);
  response.write("<!DOCTYPE html><html></html>");
});

server.registerPathHandler("/script.js", () => {
  ok(false, "Unexpected request to /script.js");
});

/* eslint-disable no-eval, no-implied-eval */

const MODULE1 = `
  import {foo} from "./module2.js";
  export let bar = foo;

  let count = 0;

  export function counter () { return count++; }
`;

const MODULE2 = `export let foo = 2;`;

add_task(async function test_disallowed_import() {
  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      content_scripts: [
        {
          matches: ["http://example.com/dummy"],
          js: ["main.js"],
        },
      ],
    },

    files: {
      "main.js": async function () {
        let disallowedURLs = [
          "data:text/javascript,void 0",
          "javascript:void 0",
          "http://example.com/script.js",
          URL.createObjectURL(
            new Blob(["void 0", { type: "text/javascript" }])
          ),
        ];

        for (let url of disallowedURLs) {
          await browser.test.assertRejects(
            import(url),
            /error loading dynamically imported module/,
            `should reject import("${url}")`
          );
        }

        browser.test.sendMessage("done");
      },
    },
  });

  await extension.startup();
  let contentPage = await ExtensionTestUtils.loadContentPage(
    "http://example.com/dummy"
  );
  await extension.awaitMessage("done");
  await extension.unload();
  await contentPage.close();
});

add_task(async function test_import_non_web_accessible_non_strict() {
  // "non_strict" in the function name is referring to this pref. Setting it
  // to 'false' should allow MV2 extensions to dynamically load content
  // even if that content isn't in web_accessible_resources (and that's
  // what the rest of this function tests).
  Services.prefs.setBoolPref(WEB_ACCESSIBLE_STRICTNESS_PREF, false);

  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      content_scripts: [
        {
          matches: ["http://example.com/dummy"],
          js: ["main.js"],
        },
      ],
    },
    files: {
      "main.js": async function () {
        try {
          let mod = await import(browser.runtime.getURL("module1.js"));
          browser.test.assertEq(mod.bar, 2);
          browser.test.assertEq(mod.counter(), 0);
        } catch (e) {
          browser.test.assertTrue(false, `Threw while importing module: ${e}`);
        }

        browser.test.sendMessage("done");
      },
      "module1.js": MODULE1,
      "module2.js": MODULE2,
    },
  });

  await extension.startup();
  let contentPage = await ExtensionTestUtils.loadContentPage(
    "http://example.com/dummy"
  );

  await extension.awaitMessage("done");
  await extension.unload();
  await contentPage.close();
  Services.prefs.clearUserPref(WEB_ACCESSIBLE_STRICTNESS_PREF);
});

add_task(async function test_import_non_web_accessible_strict() {
  // "strict" in the function name is referring to this pref. Setting it
  // to "true" should prevent MV2 extensions from dynamically loading content
  // unless that content is listed in web_accessible_resources (and that's
  // what the rest of this function tests).
  Services.prefs.setBoolPref(WEB_ACCESSIBLE_STRICTNESS_PREF, true);

  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      content_scripts: [
        {
          matches: ["http://example.com/dummy"],
          js: ["main.js"],
        },
      ],
    },

    files: {
      "main.js": async function () {
        /* global exportFunction */
        const url = browser.runtime.getURL("module1.js");

        await browser.test.assertRejects(
          import(url),
          /error loading dynamically imported module/,
          "Cannot import script that is not web-accessible from page context"
        );

        await browser.test.assertRejects(
          window.eval(`import("${url}")`),
          /error loading dynamically imported module/,
          "Cannot import script that is not web-accessible from page context"
        );

        let promise = new Promise((resolve, reject) => {
          exportFunction(resolve, window, { defineAs: "resolve" });
          exportFunction(reject, window, { defineAs: "reject" });
        });

        window.setTimeout(`import("${url}").then(resolve, reject)`, 0);

        await browser.test.assertRejects(
          promise,
          /error loading dynamically imported module/,
          "Cannot import script that is not web-accessible from page context"
        );

        browser.test.sendMessage("done");
      },
      "module1.js": MODULE1,
      "module2.js": MODULE2,
    },
  });

  await extension.startup();
  let contentPage = await ExtensionTestUtils.loadContentPage(
    "http://example.com/dummy"
  );

  await extension.awaitMessage("done");

  // Web page can not import non-web-accessible files.
  await contentPage.spawn([extension.uuid], async uuid => {
    let files = ["main.js", "module1.js", "module2.js"];

    for (let file of files) {
      let url = `moz-extension://${uuid}/${file}`;
      await Assert.rejects(
        content.eval(`import("${url}")`),
        /error loading dynamically imported module/,
        "Cannot import script that is not web-accessible"
      );
    }
  });

  await extension.unload();
  await contentPage.close();
  Services.prefs.clearUserPref(WEB_ACCESSIBLE_STRICTNESS_PREF);
});

add_task(async function test_import_non_web_accessible_mv3() {
  // Here we set the prev to the non-strict value, but we still expect
  // the same as the "strict" test above, because our extension is using
  // 'manifest_version: 3' which should be strict regardless of the pref value.
  Services.prefs.setBoolPref(WEB_ACCESSIBLE_STRICTNESS_PREF, false);

  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      manifest_version: 3,
      content_scripts: [
        {
          matches: ["http://example.com/dummy"],
          js: ["main.js"],
        },
      ],
    },

    files: {
      "main.js": async function () {
        const url = browser.runtime.getURL("module1.js");

        await browser.test.assertRejects(
          import(url),
          /error loading dynamically imported module/,
          "Cannot import script that is not web-accessible from page context"
        );

        await browser.test.assertRejects(
          window.eval(`import("${url}")`),
          /error loading dynamically imported module/,
          "Cannot import script that is not web-accessible from page context"
        );

        let promise = new Promise((resolve, reject) => {
          exportFunction(resolve, window, { defineAs: "resolve" });
          exportFunction(reject, window, { defineAs: "reject" });
        });

        window.setTimeout(`import("${url}").then(resolve, reject)`, 0);

        await browser.test.assertRejects(
          promise,
          /error loading dynamically imported module/,
          "Cannot import script that is not web-accessible from page context"
        );

        browser.test.sendMessage("done");
      },
      "module1.js": MODULE1,
      "module2.js": MODULE2,
    },
  });

  await extension.startup();
  let contentPage = await ExtensionTestUtils.loadContentPage(
    "http://example.com/dummy"
  );

  await extension.awaitMessage("done");

  // Web page can not import non-web-accessible files.
  await contentPage.spawn([extension.uuid], async uuid => {
    let files = ["main.js", "module1.js", "module2.js"];

    for (let file of files) {
      let url = `moz-extension://${uuid}/${file}`;
      await Assert.rejects(
        content.eval(`import("${url}")`),
        /error loading dynamically imported module/,
        "Cannot import script that is not web-accessible"
      );
    }
  });

  await extension.unload();
  await contentPage.close();
  Services.prefs.clearUserPref(WEB_ACCESSIBLE_STRICTNESS_PREF);
});

add_task(async function test_import_web_accessible() {
  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      content_scripts: [
        {
          matches: ["http://example.com/dummy"],
          js: ["main.js"],
        },
      ],
      web_accessible_resources: ["module1.js", "module2.js"],
    },

    files: {
      "main.js": async function () {
        let mod = await import(browser.runtime.getURL("module1.js"));
        browser.test.assertEq(mod.bar, 2);
        browser.test.assertEq(mod.counter(), 0);
        browser.test.sendMessage("done");
      },
      "module1.js": MODULE1,
      "module2.js": MODULE2,
    },
  });

  await extension.startup();
  let contentPage = await ExtensionTestUtils.loadContentPage(
    "http://example.com/dummy"
  );
  await extension.awaitMessage("done");

  // Web page can import web-accessible files,
  // even after WebExtension imported the same files.
  await contentPage.spawn([extension.uuid], async uuid => {
    let base = `moz-extension://${uuid}`;

    await Assert.rejects(
      content.eval(`import("${base}/main.js")`),
      /error loading dynamically imported module/,
      "Cannot import script that is not web-accessible"
    );

    let promise = content.eval(`import("${base}/module1.js")`);
    let mod = (await promise.wrappedJSObject).wrappedJSObject;
    Assert.equal(mod.bar, 2, "exported value should match");
    Assert.equal(mod.counter(), 0, "Counter should be fresh");
    Assert.equal(mod.counter(), 1, "Counter should be fresh");

    promise = content.eval(`import("${base}/module2.js")`);
    mod = (await promise.wrappedJSObject).wrappedJSObject;
    Assert.equal(mod.foo, 2, "exported value should match");
  });

  await extension.unload();
  await contentPage.close();
});

add_task(async function test_import_web_accessible_after_page() {
  let extension = ExtensionTestUtils.loadExtension({
    manifest: {
      content_scripts: [
        {
          matches: ["http://example.com/dummy"],
          js: ["main.js"],
        },
      ],
      web_accessible_resources: ["module1.js", "module2.js"],
    },

    files: {
      "main.js": async function () {
        browser.test.onMessage.addListener(async msg => {
          browser.test.assertEq(msg, "import");

          const url = browser.runtime.getURL("module1.js");
          let mod = await import(url);
          browser.test.assertEq(mod.bar, 2);
          browser.test.assertEq(mod.counter(), 0, "Counter should be fresh");

          let promise = window.eval(`import("${url}")`);
          let mod2 = (await promise.wrappedJSObject).wrappedJSObject;
          browser.test.assertEq(
            mod2.counter(),
            2,
            "Counter should have been incremented by page"
          );

          browser.test.sendMessage("done");
        });
        browser.test.sendMessage("ready");
      },
      "module1.js": MODULE1,
      "module2.js": MODULE2,
    },
  });

  await extension.startup();
  let contentPage = await ExtensionTestUtils.loadContentPage(
    "http://example.com/dummy"
  );
  await extension.awaitMessage("ready");

  // The web page imports the web-accessible files first,
  // when the WebExtension imports the same file, they should
  // not be shared.
  await contentPage.spawn([extension.uuid], async uuid => {
    let base = `moz-extension://${uuid}`;

    await Assert.rejects(
      content.eval(`import("${base}/main.js")`),
      /error loading dynamically imported module/,
      "Cannot import script that is not web-accessible"
    );

    let promise = content.eval(`import("${base}/module1.js")`);
    let mod = (await promise.wrappedJSObject).wrappedJSObject;
    Assert.equal(mod.bar, 2, "exported value should match");
    Assert.equal(mod.counter(), 0);
    Assert.equal(mod.counter(), 1);

    promise = content.eval(`import("${base}/module2.js")`);
    mod = (await promise.wrappedJSObject).wrappedJSObject;
    Assert.equal(mod.foo, 2, "exported value should match");
  });

  extension.sendMessage("import");

  await extension.awaitMessage("done");

  await extension.unload();
  await contentPage.close();
});
