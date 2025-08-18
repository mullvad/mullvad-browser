"use strict";

const { Management } = ChromeUtils.importESModule(
  "resource://gre/modules/Extension.sys.mjs"
);

// This test task quits in the middle of the test - do NOT add more tests below
// this, unless you explicitly want to verify the behavior after quitting.
//
// Regression test for https://bugzilla.mozilla.org/show_bug.cgi?id=1959339
// Quitting while an extension is starting should not block shutdown.
// Previously, if an extension was starting at application startup, and the
// application quit before the background page startup completed, then the
// implementation would wait indefinitely for the completion of background
// startup (which would not trigger because past shutdown any attempt to load
// content is aborted with NS_ERROR_ILLEGAL_DURING_SHUTDOWN).
add_task(async function test_quit_while_background_starts() {
  let extension = ExtensionTestUtils.loadExtension({
    // Extension startup is blocked on background startup (bug 1543354).
    // If we somehow fail to make progress, then we should notice that.
    delayedStartup: false,
    background() {
      browser.test.fail(
        "Unexpected background page execution. eForceQuit should have aborted all document loads"
      );
    },
  });

  info("Waiting for extension to start up");
  let browserCount = 0;
  Management.once("extension-browser-inserted", (eventName, browser) => {
    ++browserCount;
    equal(
      browser.getAttribute("webextension-view-type"),
      "background",
      "Got background browser"
    );
    // The Quit() call below calls ExitLastWindowClosingSurvivalArea() at
    // https://searchfox.org/mozilla-central/rev/38e462fe13ea42ae6cc391fb36e8b9e82e842b00/toolkit/components/startup/nsAppStartup.cpp#428,431
    // which expects an EnterLastWindowClosingSurvivalArea() to have called
    // before, or else the following assertion will be triggered at:
    // https://searchfox.org/mozilla-central/rev/38e462fe13ea42ae6cc391fb36e8b9e82e842b00/toolkit/components/startup/nsAppStartup.cpp#597-598
    // ASSERTION: consider quit stopper out of bounds: 'mConsiderQuitStopper > 0
    //
    // During normal (non-xpcshell) execution, nsAppStartup::Run() runs, which
    // calls EnterLastWindowClosingSurvivalArea(). In xpcshell tests, this is
    // not called, and we need to call it here:
    Services.startup.enterLastWindowClosingSurvivalArea();
    Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
  });
  await extension.startup();
  equal(browserCount, 1, "Seen background browser");

  equal(extension.extension.backgroundState, "stopped", "backgroundState");

  await extension.unload();
});
