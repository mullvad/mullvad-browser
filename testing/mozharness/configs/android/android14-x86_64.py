# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# mozharness configuration for Android x86/x86_64 14 unit tests
#
# This configuration should be combined with suite definitions and other
# mozharness configuration from android_common.py, or similar.

config = {
    "emulator_avd_name": "mozemulator-android34-x86_64",
    "emulator_process_name": "qemu-system-x86_64",
    "emulator_extra_args": [
        "-no-window",
        "-no-audio",
        "-no-boot-anim",
        "-skip-adb-auth",
        "-verbose",
        "-show-kernel",
        "-ranchu",
        "-selinux",
        "permissive",
        "-memory",
        "4096",
        "-cores",
        "8",
        "-skin",
        "800x1280",
        "-no-snapstorage",
        "-no-snapshot",
        # Skips first-run dialogs
        "-prop",
        "ro.test_harness=true",
    ],
    "exes": {
        "adb": "%(abs_sdk_dir)s/platform-tools/adb",
    },
    "env": {
        "DISPLAY": ":0.0",
        "PATH": "%(PATH)s:%(abs_sdk_dir)s/emulator:%(abs_sdk_dir)s/tools:%(abs_sdk_dir)s/platform-tools",
        # "LIBGL_DEBUG": "verbose"
    },
    "bogomips_minimum": 3000,
    # in support of test-verify
    "android_version": 34,
    "os_version": "14",
    "is_emulator": True,
}
