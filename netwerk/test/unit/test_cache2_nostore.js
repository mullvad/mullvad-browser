/* -*- Mode: js; tab-width: 2; indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ts=2 sw=2 sts=2 et: */

/**
 * @fileoverview
 *   Unit test to verify that resources with Cache-Control: no-store, no-cache
 *   and Cache-Control: no-cache, no-store headers are not saved in the cache.
 */

const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);

let httpServer = null;

function startServer() {
  httpServer = new HttpServer();
  httpServer.registerPathHandler("/test1", (request, response) => {
    response.setHeader("Cache-Control", "no-cache, no-store", false);
    response.setHeader("Content-Type", "text/plain", false);
    response.write("OK");
  });
  httpServer.registerPathHandler("/test2", (request, response) => {
    response.setHeader("Cache-Control", "no-cache, no-store", false);
    response.setHeader("Content-Type", "text/plain", false);
    response.write("OK");
  });
  httpServer.registerPathHandler("/test3", (request, response) => {
    response.setHeader("Cache-Control", "no-cache", false);
    response.setHeader("Cache-Control", "no-store", false);
    response.setHeader("Content-Type", "text/plain", false);
    response.write("OK");
  });
  httpServer.registerPathHandler("/test4", (request, response) => {
    response.setHeader("Cache-Control", "no-cache", false);
    response.setHeader("Cache-Control", "no-store", false);
    response.setHeader("Content-Type", "text/plain", false);
    response.write("OK");
  });
  httpServer.start(-1);
  registerCleanupFunction(async () => {
    if (httpServer) {
      await httpServer.stop();
    }
  });
  return httpServer.identity.primaryPort;
}

add_task(async function test_no_cache_no_store() {
  const port = startServer();
  const baseURI = `http://localhost:${port}`;
  let tests = ["/test1", "/test2", "/test3", "/test4"];

  for (let test of tests) {
    let uri = baseURI + test;
    let channel = NetUtil.newChannel({
      uri,
      loadUsingSystemPrincipal: true,
    });

    let buffer = await new Promise(resolve => {
      channel.asyncOpen(
        new ChannelListener(
          (request, buffer) => resolve(buffer),
          null,
          CL_ALLOW_UNKNOWN_CL
        )
      );
    });

    Assert.equal(buffer, "OK", `Received expected content for ${test}`);

    let entry = await new Promise(resolve => {
      asyncOpenCacheEntry(
        uri,
        "disk",
        Ci.nsICacheStorage.OPEN_READONLY,
        null,
        (status, entry) => resolve(entry)
      );
    });
    Assert.equal(
      entry.persistent,
      false,
      `${test} should not be persistently cached`
    );
  }
});
