# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import getpass
import json
import sys
from pathlib import Path

from mozterm import Terminal

TERM = Terminal()

GITLAB_API_BASE = "https://gitlab.torproject.org/api/v4"

# The canonical repo. `mach yeet remote` must never target this directly --
# only a fork of it, so CI runs don't pile up on the shared project.
CANONICAL_GITLAB_PROJECT = "tpo/applications/tor-browser-bundle-testsuite"
CANONICAL_GITLAB_REPO_NAME = CANONICAL_GITLAB_PROJECT.rsplit("/", 1)[-1]

# Project and token saved by `mach yeet auth`.
YEET_CONFIG_FILENAME = ".yeet.json"

# The server `mach yeet` uploads to and runs commands on over SSH. Not
# user-configurable -- uploaded files are served from this host's
# public_html, so it can't be swapped out per-user.
SSH_HOST = "tb-build-03.torproject.org"


def prompt(message, secret=False):
    """Read a line of user input, first discarding anything typed before the
    prompt appeared so stray keystrokes aren't taken as the answer.
    """
    if sys.stdin.isatty():
        try:
            import termios

            termios.tcflush(sys.stdin, termios.TCIFLUSH)
        except ImportError:
            pass
    if secret:
        return getpass.getpass(message)
    return input(message)


def confirm(message):
    """Ask a yes/no question, defaulting to no, until a valid answer is given."""
    while True:
        answer = prompt(f"{message} [y/N]: ").strip().lower()
        if answer in ("y", "yes"):
            return True
        if answer in ("", "n", "no"):
            return False
        print(TERM.red("ERROR! Please answer 'y' or 'n'."))


def read_config(command_context):
    """Read the project/token/ssh_* config saved by `mach yeet auth`, or
    None if it hasn't been run yet.
    """
    config_path = Path(command_context.topsrcdir) / YEET_CONFIG_FILENAME
    if not config_path.is_file():
        return None

    with open(config_path) as f:
        return json.load(f)
