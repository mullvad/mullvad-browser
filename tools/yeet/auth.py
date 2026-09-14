# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from yeet.common import (
    CANONICAL_GITLAB_PROJECT,
    CANONICAL_GITLAB_REPO_NAME,
    GITLAB_API_BASE,
    SSH_HOST,
    TERM,
    YEET_CONFIG_FILENAME,
    prompt,
)

_GITLAB_USERNAME_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]*")


def _resolve_project(raw_username):
    """Build a fork project path out of a GitLab username, or return an
    error message if it's empty, malformed or the canonical repo's own
    namespace.
    """
    username = raw_username.strip()
    if not username:
        return None, "A GitLab username is required."

    if not _GITLAB_USERNAME_RE.fullmatch(username):
        return None, (
            f"Invalid GitLab username {username!r}. Enter just the username, "
            "not a URL or project path."
        )

    if username.lower() == CANONICAL_GITLAB_PROJECT.split("/", 1)[0].lower():
        return None, (
            "That's the canonical repo's namespace, not a fork. Use your "
            "own GitLab username instead."
        )

    return f"{username}/{CANONICAL_GITLAB_REPO_NAME}", None


def _prompt_fork():
    print()
    print(
        TERM.yellow(
            f"""`mach yeet remote` runs against your own fork
of {CANONICAL_GITLAB_PROJECT}, never against the
canonical repo directly -- that keeps CI runs off
the shared project.

If you haven't forked it yet, fork it first at:
  https://gitlab.torproject.org/{CANONICAL_GITLAB_PROJECT}/-/forks/new

Keep your fork up to date too. An outdated fork's
.gitlab-ci.yml may be missing pieces this command
relies on, so pipelines could fail or come back
empty."""
        )
    )
    print()

    while True:
        project, error = _resolve_project(prompt("Your GitLab username: "))
        if error:
            print(TERM.red(f"ERROR! {error}"))
            continue
        return project


def _gitlab_token_instructions(project):
    return f"""
Now you need a pipeline trigger token for your fork:
  {project}

This is NOT a personal access token -- it's
specific to this one project, and it's the only
kind that can actually run CI jobs here (their
rules require it):

  1. Go to https://gitlab.torproject.org/{project}/-/settings/ci_cd#js-pipeline-triggers
  2. Expand "Pipeline trigger tokens" and add a new one.
  3. Paste the token below.

The project and token will be saved to
{YEET_CONFIG_FILENAME} at the root of the repository
and are not committed to it.
""".strip()


_SSH_USERNAME_RE = re.compile(r"[a-z_][a-z0-9_-]*")


def _ssh_username_error(username):
    if not username:
        return "Username cannot be empty."
    if not _SSH_USERNAME_RE.fullmatch(username):
        return (
            f"Invalid username {username!r}. Use only lowercase letters, "
            "digits, '_' and '-', not starting with a digit or '-'."
        )
    return None


def _prompt_ssh_username():
    print()
    print(
        TERM.yellow(
            f"""`mach yeet` also uploads to and runs commands on
{SSH_HOST} over SSH. Uploaded files are served from
your account's public_html there, at:
  https://{SSH_HOST}/~<username>

Anything special about the connection -- port, jump
host, a hardware key's PKCS11 provider, agent
forwarding -- belongs in your ~/.ssh/config, not
here: we just shell out to `ssh`. Whatever already
works on your command line works for `mach yeet`
too."""
        )
    )
    print()

    while True:
        username = prompt(f"Your username on {SSH_HOST}: ").strip()
        error = _ssh_username_error(username)
        if not error:
            return username
        print(TERM.red(f"ERROR! {error}"))


def _prompt_token():
    while True:
        token = prompt("GitLab token: ", secret=True).strip()
        if token:
            return token
        print(TERM.red("ERROR! Token cannot be empty."))


def _verify_ssh(target):
    """Try an actual SSH connection. stdin is /dev/null so ssh can't swallow
    input buffered for us; its touch/PIN/passphrase prompts go through
    /dev/tty and still reach the user.

    A short ConnectTimeout only bounds the initial TCP connection, so it
    won't cut off someone who's slow to respond to that prompt.
    """
    try:
        result = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=15", target, "true"],
            stdin=subprocess.DEVNULL,
            check=False,
        )
    except FileNotFoundError:
        print()
        print(TERM.red("ERROR! No `ssh` binary found on PATH."))
        return False
    return result.returncode == 0


def _verify_auth(project, token):
    """Check that `project`/`token` are accepted by GitLab, without
    actually triggering a pipeline.

    GitLab authenticates the trigger token before validating the rest of
    the request, so posting to the trigger endpoint without the required
    `ref` param never queues a pipeline: a valid token/project combination
    gets rejected with 400 (missing ref) instead, while an invalid token
    or unknown project is rejected with 401/404 before `ref` is even
    looked at.
    """
    url = f"{GITLAB_API_BASE}/projects/{urllib.parse.quote(project, safe='')}/trigger/pipeline"
    data = urllib.parse.urlencode({"token": token}).encode()
    request = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(request):
            pass
    except urllib.error.HTTPError as e:
        return e.code == 400
    else:
        return True


def run(
    command_context,
    verify=True,
    gitlab_username=None,
    gitlab_token=None,
    ssh_username=None,
):
    if gitlab_username is not None:
        project, error = _resolve_project(gitlab_username)
        if error:
            print(TERM.red(f"ERROR! --gitlab-username: {error}"))
            return 1
    else:
        project = _prompt_fork()

    if gitlab_token is not None:
        token = gitlab_token.strip()
        if not token:
            print()
            print(TERM.red("ERROR! --gitlab-token was empty."))
            return 1
    else:
        print()
        print(_gitlab_token_instructions(project))
        print()
        token = _prompt_token()

    if verify:
        print()
        print("Verifying credentials with GitLab...")
        try:
            verified = _verify_auth(project, token)
        except urllib.error.URLError as e:
            print()
            print(TERM.red(f"ERROR! Could not reach GitLab: {e}"))
            return 1

        if not verified:
            print()
            print(
                TERM.red(
                    "ERROR! GitLab rejected that project/token combination. "
                    "Double-check the fork name and the trigger token."
                )
            )
            return 1
        print(TERM.green("Credentials verified."))

    if ssh_username is not None:
        ssh_username = ssh_username.strip()
        error = _ssh_username_error(ssh_username)
        if error:
            print()
            print(TERM.red(f"ERROR! --ssh-user: {error}"))
            return 1
    else:
        ssh_username = _prompt_ssh_username()

    if verify:
        ssh_target = f"{ssh_username}@{SSH_HOST}"
        print()
        print(f"Verifying SSH access to {ssh_target}...")
        if not _verify_ssh(ssh_target):
            print()
            print(
                TERM.red(
                    f"ERROR! Could not SSH into {ssh_target}. Make sure you "
                    "can `ssh` there yourself first."
                )
            )
            return 1
        print(TERM.green("SSH access verified."))

    tokens_path = Path(command_context.topsrcdir) / YEET_CONFIG_FILENAME
    file_desc = os.open(
        tokens_path, flags=os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode=0o600
    )
    with open(file_desc, "w") as f:
        json.dump(
            {
                "project": project,
                "token": token,
                "ssh_host": SSH_HOST,
                "ssh_user": ssh_username,
            },
            f,
        )
    os.chmod(tokens_path, 0o600)

    print()
    print(TERM.green(f"Saved to {tokens_path}"))
    return 0
