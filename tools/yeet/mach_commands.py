# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import sys
from os import path

from mach.decorators import Command, CommandArgument, SubCommand  # noqa: I001


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
    # tools/yeet is a package (tools/yeet/__init__.py), but mach loads
    # this file standalone, so tools/ isn't on sys.path by default.
    sys.path.append(path.dirname(path.dirname(__file__)))
    from yeet import auth

    return auth.run(
        command_context,
        verify=not no_verify,
        gitlab_username=gitlab_username,
        gitlab_token=gitlab_token,
        ssh_username=ssh_user,
    )
