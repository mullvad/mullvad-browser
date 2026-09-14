# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import sys
from pathlib import Path

from mach.decorators import Command # noqa: I001


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
