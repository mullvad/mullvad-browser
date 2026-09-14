# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import json

from yeet import common  # noqa: E402


def write_config(tmp_path, **overrides):
    """Write a `.yeet.json` under `tmp_path`, as `mach yeet auth` would,
    for tests that need one already in place.
    """
    config = {
        "project": "bea/tor-browser-bundle-testsuite",
        "token": "s3cr3t",
        "ssh_host": common.DEFAULT_SSH_HOST,
        "ssh_user": "bea",
    }
    config.update(overrides)
    with open(tmp_path / common.YEET_CONFIG_FILENAME, "w") as f:
        json.dump(config, f)
    return config
