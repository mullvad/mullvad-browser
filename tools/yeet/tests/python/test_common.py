# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import sys
from types import SimpleNamespace

import mozunit
import pytest
from yeet import common


@pytest.mark.parametrize("secret", [False, True])
def test_prompt_flushes_pending_tty_input(monkeypatch, secret):
    termios = pytest.importorskip("termios")
    events = []
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(isatty=lambda: True))
    monkeypatch.setattr(
        termios, "tcflush", lambda fd, queue: events.append(("flush", queue))
    )
    monkeypatch.setattr(
        "builtins.input", lambda message="": events.append("input") or "plain"
    )
    monkeypatch.setattr(
        common.getpass,
        "getpass",
        lambda message="": events.append("getpass") or "hidden",
    )

    answer = common.prompt("Q: ", secret=secret)

    assert answer == ("hidden" if secret else "plain")
    assert events == [
        ("flush", termios.TCIFLUSH),
        "getpass" if secret else "input",
    ]


def test_prompt_skips_flush_when_not_a_tty(monkeypatch):
    termios = pytest.importorskip("termios")
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(isatty=lambda: False))
    monkeypatch.setattr(
        termios,
        "tcflush",
        lambda *args: pytest.fail("tcflush called on non-tty stdin"),
    )
    monkeypatch.setattr("builtins.input", lambda message="": "piped")

    assert common.prompt("Q: ") == "piped"


if __name__ == "__main__":
    mozunit.main()
