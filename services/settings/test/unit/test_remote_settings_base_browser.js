"use strict";

const { Downloader } = ChromeUtils.importESModule(
  "resource://services-settings/Attachments.sys.mjs"
);
const { sinon } = ChromeUtils.importESModule(
  "resource://testing-common/Sinon.sys.mjs"
);

// A collection with a dump that's packaged on all test builds.
const TEST_BUCKET = "main";
const TEST_COLLECTION = "password-recipes";

let client;
let DUMP_RECORDS;
let DUMP_LAST_MODIFIED;
let SERVER_LAST_MODIFIED;
let server;
let serverRequests = [];

function assertNoServerRequests() {
  Assert.deepEqual(serverRequests, [], "the server received no requests");
  serverRequests = [];
}

async function importData(records) {
  await RemoteSettingsWorker._execute("_test_only_import", [
    TEST_BUCKET,
    TEST_COLLECTION,
    records,
    records[0]?.last_modified || 0,
  ]);
}

async function pollChangesFromOutdatedData() {
  await importData([{ id: "dummy", last_modified: 1 }]);
  const seenNotification = TestUtils.topicObserved(
    "remote-settings:changes-poll-end"
  );
  await RemoteSettings.pollChanges({ trigger: "startup" });
  await seenNotification;
}

add_setup(async () => {
  Assert.ok(
    AppConstants.BASE_BROWSER_VERSION,
    "This test only makes sense when built with --with-base-browser-version"
  );

  client = RemoteSettings(TEST_COLLECTION, { bucketName: TEST_BUCKET });
  // Opening the DB from the main thread creates/upgrades it as needed.
  // The worker-based import used by importData() below opens it with
  // allowUpgrades=false, so it requires the DB to already exist.
  await client.db.getLastModified();

  const dump = await SharedUtils.loadJSONDump(TEST_BUCKET, TEST_COLLECTION);
  DUMP_RECORDS = dump.data;
  DUMP_LAST_MODIFIED = dump.timestamp;
  Assert.greater(
    DUMP_LAST_MODIFIED,
    1,
    "the dump is newer than the outdated data used by the tests"
  );

  // The server offers data that is newer than the dump, so that processing
  // anything from it would be observable.
  SERVER_LAST_MODIFIED = DUMP_LAST_MODIFIED + 1000;

  server = new HttpServer();
  server.start(-1);
  registerCleanupFunction(() => server.stop(() => {}));
  const origin = `http://localhost:${server.identity.primaryPort}`;
  const attachment = await IOUtils.readUTF8(
    do_get_file(
      "test_attachments_downloader/65650a0f-7c22-4c10-9744-2d67e301f5f4.pem"
    ).path
  );
  const responses = {
    "/v1/": {
      capabilities: { attachments: { base_url: `${origin}/cdn/` } },
    },
    "/v1/buckets/monitor/collections/changes/changeset": {
      timestamp: SERVER_LAST_MODIFIED,
      changes: [
        {
          bucket: TEST_BUCKET,
          collection: TEST_COLLECTION,
          last_modified: SERVER_LAST_MODIFIED,
        },
      ],
    },
    [`/v1/buckets/${TEST_BUCKET}/collections/${TEST_COLLECTION}/changeset`]: {
      timestamp: SERVER_LAST_MODIFIED,
      metadata: {},
      changes: [{ id: "from-server", last_modified: SERVER_LAST_MODIFIED }],
    },
  };
  server.registerPrefixHandler("/", (request, response) => {
    serverRequests.push(request.path);
    if (request.path.startsWith("/cdn/")) {
      response.write(attachment);
    } else if (request.path in responses) {
      response.setHeader("Content-Type", "application/json; charset=UTF-8");
      response.write(JSON.stringify(responses[request.path]));
    } else {
      response.setStatusLine(null, 404, "Not Found");
    }
  });
  Services.prefs.setStringPref("services.settings.server", `${origin}/v1`);
  // Tor browser routes everything through a SOCKS proxy by default, which
  // would prevent requests from ever reaching the server.
  Services.prefs.setIntPref("network.proxy.type", 0);
});

add_task(function test_shouldSkipRemoteActivity_is_always_true() {
  Assert.ok(
    Utils.shouldSkipRemoteActivity,
    "Remote activity is always skipped for base browser builds"
  );
});

add_task(async function test_appconstants_disable_remote_settings_server() {
  Assert.deepEqual(
    AppConstants.REMOTE_SETTINGS_SERVER_URLS,
    [""],
    "No real Remote Settings server is configured"
  );
  Assert.equal(
    AppConstants.REMOTE_SETTINGS_VERIFY_SIGNATURE,
    false,
    "Signature verification is disabled, since we never fetch from a server"
  );
  Assert.equal(
    Services.prefs
      .getDefaultBranch("")
      .getStringPref("services.settings.server", ""),
    "",
    "The services.settings.server pref has no default value"
  );
});

add_task(async function test_sync_never_contacts_server() {
  await importData([{ id: "dummy", last_modified: 1 }]);

  await client.sync();

  Assert.equal(
    await client.getLastModified(),
    1,
    "sync() did not touch local data"
  );
  assertNoServerRequests();

  // Sanity check: the server does offer newer data for this collection.
  const { remoteTimestamp } = await client._fetchChangeset();
  Assert.equal(
    remoteTimestamp,
    SERVER_LAST_MODIFIED,
    "the server offers newer data"
  );
  serverRequests = [];
});

add_task(async function test_pollChanges_imports_from_newer_local_dump() {
  RemoteSettings._initialized = false;

  await pollChangesFromOutdatedData();

  Assert.equal(
    await client.getLastModified(),
    DUMP_LAST_MODIFIED,
    "local data was updated from the packaged dump"
  );
  const current = await client.get({ loadDumpIfNewer: false });
  Assert.equal(
    current.length,
    DUMP_RECORDS.length,
    "all dump records imported"
  );
  assertNoServerRequests();

  // Sanity check: the server does advertise newer changes.
  const { changes } = await Utils.fetchLatestChanges(Utils.SERVER_URL);
  Assert.deepEqual(
    changes.map(c => c.last_modified),
    [SERVER_LAST_MODIFIED],
    "the server advertises newer changes"
  );
  serverRequests = [];
});

add_task(async function test_pollChanges_is_noop_after_first_call() {
  RemoteSettings._initialized = false;
  await pollChangesFromOutdatedData();

  // The local dump import is not awaited by pollChanges(), but it calls
  // hasLocalDump() synchronously, so this spy tells us deterministically
  // whether an import was started.
  const hasLocalDumpSpy = sinon.spy(Utils, "hasLocalDump");

  // This guards against bug 1730026, where GeckoView calls this twice.
  await RemoteSettings.pollChanges({ trigger: "timer" });
  Assert.ok(
    hasLocalDumpSpy.notCalled,
    "second call to pollChanges() is a no-op"
  );

  // Sanity check: without the guard, the same call starts an import.
  RemoteSettings._initialized = false;
  await pollChangesFromOutdatedData();
  Assert.ok(
    hasLocalDumpSpy.called,
    "pollChanges() starts an import when unguarded"
  );

  hasLocalDumpSpy.restore();
  assertNoServerRequests();
});

add_task(async function test_pollChanges_never_records_sync_history() {
  RemoteSettings._initialized = false;
  const syncHistory = new SyncHistory("settings-sync");
  await syncHistory.clear();

  await pollChangesFromOutdatedData();

  const history = await syncHistory.list();
  Assert.equal(history.length, 0, "no sync history was recorded");
  assertNoServerRequests();
});

add_task(async function test_downloader_never_downloads_from_server() {
  // Same fixture as test_attachments_downloader.js: a record whose attachment
  // is not available from any dump or cache.
  const record = {
    id: "1f3a0802-648d-11ea-bd79-876a8b69c377",
    attachment: {
      hash: "f41ed47d0f43325c9f089d03415c972ce1d3f1ecab6e4d6260665baf3db3ccee",
      size: 1597,
      filename: "test_file.pem",
      location:
        "main-workspace/some-collection/65650a0f-7c22-4c10-9744-2d67e301f5f4.pem",
      mimetype: "application/x-pem-file",
    },
  };
  const downloader = new Downloader(TEST_BUCKET, "some-collection");

  // There's no local dump or cache for this attachment, so download must fail
  // rather than fall back to the network.
  await Assert.rejects(
    downloader.downloadAsBytes(record),
    e => e instanceof Downloader.NotFoundError,
    "download never falls back to the network"
  );
  assertNoServerRequests();

  // Sanity check: the server does serve this attachment.
  const { size, hash, location } = record.attachment;
  const buffer = await downloader._fetchAttachment(
    (await Utils.baseAttachmentsURL()) + location
  );
  Assert.ok(
    await RemoteSettingsWorker.checkContentHash(buffer, size, hash),
    "the server serves the attachment"
  );
  serverRequests = [];
});
