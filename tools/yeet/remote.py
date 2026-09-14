# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import json
import os
import shlex
import urllib.error
import urllib.parse
import urllib.request

from yeet import upload
from yeet.common import GITLAB_API_BASE, TERM, prompt, read_config

PLATFORMS = ["debian_x86_64", "windows_x86_64", "macos_x86_64", "android_x86_64"]

TOOLCHAINS_URL_BASE = "https://nightlies.tbb.torproject.org/nightly-builds/toolchains"

PLATFORM_TOOLCHAIN_DIR = {
    "debian_x86_64": "linux-x86_64",
    "windows_x86_64": "windows-x86_64",
    "macos_x86_64": "macos-x86_64",
    "android_x86_64": "android-x86_64",
}

# Each Android build channel/flavor ships under its own package name, so the
# pipeline needs to be told which one to install.
ANDROID_CHANNEL_PACKAGE_NAMES = {
    "debug": "org.torproject.torbrowser_debug",
    "nightly": "org.torproject.torbrowser_nightly",
    "alpha": "org.torproject.torbrowser_alpha",
    "release": "org.torproject.torbrowser",
}
ANDROID_CHANNELS = list(ANDROID_CHANNEL_PACKAGE_NAMES)


def _read_browser_version(command_context):
    version_path = os.path.join(
        command_context.topsrcdir, "browser", "config", "version.txt"
    )
    with open(version_path) as f:
        return f.read().strip()


def _resolve_version(command_context, version):
    if version:
        return version

    version = _read_browser_version(command_context)
    print(
        TERM.yellow(
            f"""Inferred platform version {version} from
browser/config/version.txt. Pass --version if
this isn't the version you want to test."""
        )
    )
    return version


def _artifacts_url(version, platform):
    return f"{TOOLCHAINS_URL_BASE}/{version}/{PLATFORM_TOOLCHAIN_DIR[platform]}/"


def _mozharness_url(version, platform):
    return f"{_artifacts_url(version, platform)}mozharness.zip"


def _curl_command(url, headers, data):
    args = ["curl", "--request", "POST"]
    for name, value in headers.items():
        args += ["--header", f"{name}: {value}"]
    args += ["--data", data.decode("utf-8"), url]
    return shlex.join(args)


def _resolve_installer_url(command_context, installer, assume_yes, dry_run):
    """Accept either an installer URL directly, or a local file path to
    upload first. On a dry run a local file is not uploaded, and a
    placeholder URL is returned instead. Returns (url, error).
    """
    if urllib.parse.urlparse(installer).scheme in ("http", "https"):
        return installer, None
    if dry_run:
        file_path, error = upload.resolve_file(installer)
        if error:
            print(TERM.red(f"ERROR! {error}"))
            return None, error
        print(TERM.yellow(f"Dry run: not uploading {file_path}."))
        return f"<URL of uploaded {file_path.name}>", None
    return upload.run(command_context, installer, assume_yes=assume_yes)


def _prompt_platform():
    print()
    print(
        TERM.bold(
            "Select the platform you are testing for (if not listed, tests are not supported yet):"
        )
    )
    for i, platform in enumerate(PLATFORMS, 1):
        print(f"  {TERM.cyan(str(i))}) {platform}")
    print()

    while True:
        choice = prompt(f"Platform [1-{len(PLATFORMS)}]: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(PLATFORMS):
            print()
            return PLATFORMS[int(choice) - 1]
        print(TERM.red(f"ERROR! Please enter a number between 1 and {len(PLATFORMS)}."))


def _prompt_channel():
    print()
    print(TERM.bold("Select the Android build channel/flavor you are testing:"))
    for i, channel in enumerate(ANDROID_CHANNELS, 1):
        print(f"  {TERM.cyan(str(i))}) {channel}")
    print()

    while True:
        choice = prompt(f"Channel [1-{len(ANDROID_CHANNELS)}]: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(ANDROID_CHANNELS):
            print()
            return ANDROID_CHANNELS[int(choice) - 1]
        print(
            TERM.red(
                f"ERROR! Please enter a number between 1 and {len(ANDROID_CHANNELS)}."
            )
        )


def run(
    command_context,
    platform,
    channel,
    installer_url,
    sha256sums_url,
    artifacts_url,
    mozharness_url,
    version,
    ref,
    tags,
    dry_run,
    assume_yes=False,
):
    # TODO: this runs whatever the pipeline runs, indiscriminately -- fine
    # for now since marionette is the only suite it has, but once others
    # (xpcshell, cppunittest, mochitest, ...) exist, add a --suite argument
    # here and thread it into `inputs` so a run can be scoped to just one.
    config = read_config(command_context)
    if config is None:
        print(TERM.red("No GitLab fork/token found, run `mach yeet auth` first."))
        return 1

    installer_url, error = _resolve_installer_url(
        command_context, installer_url, assume_yes, dry_run
    )
    if error:
        return 1

    if not platform:
        platform = _prompt_platform()

    package_name = None
    if platform == "android_x86_64":
        if not channel:
            channel = _prompt_channel()
        if channel not in ANDROID_CHANNEL_PACKAGE_NAMES:
            print(TERM.red(f"ERROR! Unknown channel {channel!r}."))
            return 1
        package_name = ANDROID_CHANNEL_PACKAGE_NAMES[channel]

    if not artifacts_url or not mozharness_url:
        version = _resolve_version(command_context, version)
    if not artifacts_url:
        artifacts_url = _artifacts_url(version, platform)
    if not mozharness_url:
        mozharness_url = _mozharness_url(version, platform)

    inputs = {
        "mozharness_url": mozharness_url,
        f"{platform}_installer_url": installer_url,
        f"{platform}_artifacts_url": artifacts_url,
    }
    if package_name:
        inputs[f"{platform}_package_name"] = package_name
    if sha256sums_url:
        inputs[f"{platform}_sha256sums_url"] = sha256sums_url
    if tags:
        inputs["tags"] = shlex.join(arg for tag in tags for arg in ("--tag", tag))

    project_id = urllib.parse.quote(config["project"], safe="")
    url = f"{GITLAB_API_BASE}/projects/{project_id}/trigger/pipeline"
    headers = {"Content-Type": "application/json"}
    data = json.dumps({"token": config["token"], "ref": ref, "inputs": inputs}).encode(
        "utf-8"
    )

    if dry_run:
        print()
        print(TERM.cyan(_curl_command(url, headers, data)))
        print()
        return 0

    request = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print(
            TERM.red(f"ERROR! Failed to trigger pipeline: {e.code} {e.reason}\n{body}")
        )
        return 1
    except urllib.error.URLError as e:
        print(TERM.red(f"ERROR! Could not reach GitLab: {e}"))
        return 1

    print()
    print(TERM.green(f"Pipeline triggered: {result.get('web_url')}"))
    return 0
