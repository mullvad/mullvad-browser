# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from yeet.common import TERM, YEET_CONFIG_FILENAME, confirm, read_config


def resolve_file(file_arg):
    path = Path(file_arg).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"No such file: {path}")
    return path


def _remote_dir_name(platform):
    """Name the upload's directory after the current time and `platform`,
    so repeated uploads never collide or overwrite each other.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{timestamp}-{platform}"


def _upload(file_path, ssh_user, ssh_host, remote_dir):
    """scp `file_path` into ~/public_html/yeet/`remote_dir` on
    ssh_user@ssh_host, keeping its name (with characters unsafe in a URL or
    shell replaced by `_`) and creating that directory first
    if needed. Both commands
    get /dev/null as stdin so they can't swallow input buffered for us;
    their touch/PIN/passphrase prompts go through /dev/tty and still reach
    the user.

    Returns the file's final https:// URL. Raises RuntimeError on failure.
    """
    ssh_target = f"{ssh_user}@{ssh_host}"
    remote_name = re.sub(r"[^A-Za-z0-9._-]", "_", file_path.name)
    dest_dir = f"~/public_html/yeet/{remote_dir}"
    dest_path = f"{dest_dir}/{remote_name}"
    html_path = f"~{ssh_user}/yeet/{remote_dir}/{remote_name}"

    mkdir = subprocess.run(
        ["ssh", ssh_target, "mkdir", "-p", dest_dir],
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if mkdir.returncode != 0:
        raise RuntimeError(f"Could not create {dest_dir} on {ssh_target}.")

    scp = subprocess.run(
        ["scp", str(file_path), f"{ssh_target}:{dest_path}"],
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if scp.returncode != 0:
        raise RuntimeError(f"Upload to {ssh_target} failed.")

    return f"https://{ssh_host}/{html_path}"


def run(command_context, file, platform, assume_yes=False):
    """Upload `file` for `platform` to the configured server, asking for
    confirmation first unless `assume_yes`. Returns the file's final https:// URL. Raises
    FileNotFoundError if `file` or the config is missing, and RuntimeError
    if the upload fails or is cancelled.
    """
    config = read_config(command_context)
    if config is None:
        raise FileNotFoundError(
            f"No {YEET_CONFIG_FILENAME} found. Run `mach yeet auth` first."
        )

    file_path = resolve_file(file)

    remote_dir = _remote_dir_name(platform)

    if not assume_yes:
        print()
        print(
            TERM.yellow(
                f"{file_path} will be uploaded to {config['ssh_host']} and "
                "be publicly accessible."
            )
        )
        if not confirm("Upload it?"):
            raise RuntimeError("Upload cancelled.")

    print()
    print(f"Uploading {file_path.name} to {remote_dir}/...")
    url = _upload(file_path, config["ssh_user"], config["ssh_host"], remote_dir)

    print()
    print(TERM.green(f"Uploaded: {url}"))
    return url
