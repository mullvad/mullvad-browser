/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/**
 * This tests the SearchService to check our override of the remote settings is
 * working as expected.
 *
 * When adding new engines, it should be enough to change expectedURLs below.
 */

"use strict";

const { SearchService } = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/search/SearchService.sys.mjs"
);

const expectedURLs = {
  ddg: "https://duckduckgo.com/?q=test",
  "ddg-noai": "https://noai.duckduckgo.com/?q=test",
  startpage: "https://www.startpage.com/sp/search?q=test",
};
const defaultEngine = "ddg";

add_setup(async function setup() {
  await SearchService.init();
});

add_task(async function test_listEngines() {
  const { engines } = await SearchService._fetchEngineSelectorEngines();
  const foundIdentifiers = engines.map(e => e.identifier);
  Assert.deepEqual(foundIdentifiers, Object.keys(expectedURLs));
});

add_task(async function test_default() {
  Assert.equal(
    (await SearchService.getDefault()).id,
    defaultEngine,
    `${defaultEngine} is our default search engine in normal mode.`
  );
  Assert.equal(
    (await SearchService.getDefaultPrivate()).id,
    defaultEngine,
    `${defaultEngine} is our default search engine in PBM.`
  );
});

add_task(function test_checkSearchURLs() {
  for (const [id, url] of Object.entries(expectedURLs)) {
    const engine = SearchService.getEngineById(id);
    const foundUrl = engine.getSubmission("test").uri.spec;
    Assert.equal(foundUrl, url, `The URL of ${engine.name} is not altered.`);
  }
});

add_task(async function test_iconsDoesNotFail() {
  for (const id of Object.keys(expectedURLs)) {
    const engine = SearchService.getEngineById(id);
    // No need to assert anything, as in case of error this method should throw.
    await engine.getIconURL();
  }
});
