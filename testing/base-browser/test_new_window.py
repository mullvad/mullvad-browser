from marionette_harness import MarionetteTestCase, WindowManagerMixin


class TestNewWindow(WindowManagerMixin, MarionetteTestCase):
    def tearDown(self):
        self.close_all_windows()
        super().tearDown()

    def test_open_new_window(self):
        with self.marionette.using_context("chrome"):
            new_window = self.open_window()

        self.assertEqual(
            len(self.marionette.chrome_window_handles),
            len(self.start_windows) + 1,
            "A new browser window should have been opened.",
        )

        self.marionette.switch_to_window(new_window)
        self.marionette.navigate("about:blank")
        self.assertEqual(
            self.marionette.get_url(),
            "about:blank",
            "Should be able to navigate in the newly opened window.",
        )
