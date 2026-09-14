# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from mach.decorators import Command, CommandArgument, SubCommand  # noqa: I001

from yeet import remote


@Command(
    "yeet",
    category="ci",
    description="TODO: build / test remotely from the current state of the repo.",
)
def yeet(command_context):
    # TODO: this will be the main "yeet" command -- push, build and (maybe)
    # test remotely from the current state of the local repo, rather than
    # requiring an already-published build like `yeet remote` does.
    pass


@SubCommand(
    "yeet",
    "remote",
    description="Trigger a tor-browser-bundle-testsuite CI job against an "
    "already-published build, for a single platform.",
)
@CommandArgument(
    "--platform",
    default=None,
    choices=remote.PLATFORMS,
    help="Platform to test. Prompted for if not provided.",
)
@CommandArgument(
    "--channel",
    default=None,
    choices=remote.ANDROID_CHANNELS,
    help="Android build channel/flavor to install (only used with "
    "--platform android_x86_64). Prompted for if not provided.",
)
@CommandArgument(
    "installer_url",
    help="URL of the installer to test, or a local file path to upload first.",
)
@CommandArgument(
    "--sha256sums-url", default=None, help="URL of the build's sha256sums file."
)
@CommandArgument(
    "--artifacts-url",
    default=None,
    help="URL of the build's artifacts directory. Inferred from the "
    "in-tree browser version and --platform if not provided.",
)
@CommandArgument(
    "--mozharness-url",
    default=None,
    help="URL of the mozharness.zip to use. Inferred from the in-tree "
    "browser version and --platform if not provided.",
)
@CommandArgument(
    "--version",
    default=None,
    help="Browser version to use when inferring --artifacts-url and "
    "--mozharness-url. Defaults to the in-tree version "
    "(browser/config/version.txt).",
)
@CommandArgument(
    "--ref",
    default="main",
    help="tor-browser-bundle-testsuite ref to run on. Must have a "
    ".gitlab-ci.yml, which the default branch may not.",
)
@CommandArgument(
    "--tag",
    dest="tags",
    action="append",
    default=["tor", "base-browser"],
    help="Test tag to filter tests by (can be passed multiple times, e.g. "
    "--tag tor --tag base-browser). Defaults to 'tor'.",
)
@CommandArgument(
    "--dry-run",
    action="store_true",
    default=False,
    help="Print the curl command instead of triggering the pipeline.",
)
@CommandArgument(
    "--yes",
    "-y",
    dest="assume_yes",
    action="store_true",
    default=False,
    help="Upload a local installer without asking for confirmation.",
)
def yeet_remote(
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
    assume_yes,
):
    return remote.run(
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
        assume_yes=assume_yes,
    )


@SubCommand(
    "yeet",
    "auth",
    description="Save a GitLab project and access token for running CI jobs.",
)
@CommandArgument(
    "--no-verify",
    action="store_true",
    help="Skip checking the GitLab and SSH credentials before saving them.",
)
@CommandArgument(
    "--gitlab-username",
    default=None,
    help="GitLab username to use, skipping that prompt.",
)
@CommandArgument(
    "--gitlab-token",
    default=None,
    help=(
        "GitLab pipeline trigger token to use, skipping that prompt. Note "
        "this may end up in your shell history."
    ),
)
@CommandArgument(
    "--ssh-user",
    default=None,
    help="Username on the build server, skipping that prompt.",
)
def yeet_auth(
    command_context,
    no_verify=False,
    gitlab_username=None,
    gitlab_token=None,
    ssh_user=None,
):
    from yeet import auth

    return auth.run(
        command_context,
        verify=not no_verify,
        gitlab_username=gitlab_username,
        gitlab_token=gitlab_token,
        ssh_username=ssh_user,
    )
