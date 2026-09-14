# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import subprocess
from datetime import datetime, timezone
from pathlib import Path

from yeet.common import TERM, YEET_CONFIG_FILENAME, confirm, read_config


def resolve_file(file_arg):
    path = Path(file_arg).resolve()
    if not path.is_file():
        return None, f"No such file: {path}"
    return path, None


def _timestamped_name(file_path):
    """Name the upload after the current time instead of its local
    filename, so repeated uploads never collide or overwrite each other.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{timestamp}{file_path.suffix}"


def _upload(file_path, ssh_user, ssh_host, remote_name):
    """scp `file_path` into ~/public_html/yeet on ssh_user@ssh_host as
    `remote_name`, creating that directory first if needed. Both commands
    get /dev/null as stdin so they can't swallow input buffered for us;
    their touch/PIN/passphrase prompts go through /dev/tty and still reach
    the user.

    Returns (url, error): the file's final https:// URL on success, or
    (None, message) on failure.
    """
    ssh_target = f"{ssh_user}@{ssh_host}"
    dest_dir = "~/public_html/yeet"
    dest_path = f"{dest_dir}/{remote_name}"
    html_path = f"~{ssh_user}/yeet/{remote_name}"

    mkdir = subprocess.run(
        [
            "ssh",
            "-o",
            "ConnectTimeout=15",
            ssh_target,
            "mkdir",
            "-p",
            dest_dir,
        ],
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if mkdir.returncode != 0:
        return None, f"Could not create {dest_dir} on {ssh_target}."

    scp = subprocess.run(
        [
            "scp",
            "-o",
            "ConnectTimeout=15",
            str(file_path),
            f"{ssh_target}:{dest_path}",
        ],
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if scp.returncode != 0:
        return None, f"Upload to {ssh_target} failed."

    return f"https://{ssh_host}/{html_path}", None


def run(command_context, file, assume_yes=False):
    """Upload `file` to the configured server, asking for confirmation first
    unless `assume_yes`. Returns (url, error): the file's final https:// URL
    on success, or (None, message) on failure.
    """
    config = read_config(command_context)
    if config is None:
        error = f"No {YEET_CONFIG_FILENAME} found. Run `mach yeet auth` first."
        print()
        print(TERM.red(f"ERROR! {error}"))
        return None, error

    file_path, error = resolve_file(file)
    if error:
        print()
        print(TERM.red(f"ERROR! {error}"))
        return None, error

    remote_name = _timestamped_name(file_path)

    if not assume_yes:
        print()
        print(
            TERM.yellow(
                f"{file_path} will be uploaded to {config['ssh_host']} and "
                "be publicly accessible."
            )
        )
        if not confirm("Upload it?"):
            error = "Upload cancelled."
            print(TERM.red(error))
            return None, error

    print()
    print(f"Uploading {file_path.name} as {remote_name}...")
    url, error = _upload(file_path, config["ssh_user"], config["ssh_host"], remote_name)
    if error:
        print()
        print(TERM.red(f"ERROR! {error}"))
        return None, error

    print()
    print(TERM.green(f"Uploaded: {url}"))
    return url, None
