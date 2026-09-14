# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from datetime import datetime, timezone
from types import SimpleNamespace

import mozunit
import pytest
from conftest import write_config
from yeet import upload


def _freeze_time(monkeypatch, fixed):
    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed

    monkeypatch.setattr(upload, "datetime", _FrozenDatetime)


def test_resolve_file_missing():
    path, error = upload.resolve_file("/no/such/file/here")

    assert path is None
    assert "No such file" in error


def test_resolve_file_existing(tmp_path):
    apk = tmp_path / "fenix-x86_64-debug.apk"
    apk.write_bytes(b"not really an apk")

    path, error = upload.resolve_file(str(apk))

    assert error is None
    assert path == apk.resolve()


def test_timestamped_name_uses_current_time_and_keeps_extension(monkeypatch):
    _freeze_time(monkeypatch, datetime(2026, 9, 14, 12, 34, 56, tzinfo=timezone.utc))

    name = upload._timestamped_name(upload.Path("/tmp/fenix-x86_64-debug.apk"))

    assert name == "20260914-123456.apk"


def test_upload_success(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        assert kwargs["stdin"] is upload.subprocess.DEVNULL
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(upload.subprocess, "run", fake_run)

    url, error = upload._upload(
        upload.Path("/tmp/app.apk"), "bea", "example.org", "ts.apk"
    )

    assert error is None
    assert url == "https://example.org/~bea/yeet/ts.apk"
    assert calls[0][0] == "ssh"
    assert calls[0][-3:] == ["mkdir", "-p", "~/public_html/yeet"]
    assert calls[1][0] == "scp"
    assert calls[1][-2:] == [
        "/tmp/app.apk",
        "bea@example.org:~/public_html/yeet/ts.apk",
    ]


def test_upload_stops_if_mkdir_fails(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return SimpleNamespace(returncode=1)

    monkeypatch.setattr(upload.subprocess, "run", fake_run)

    url, error = upload._upload(
        upload.Path("/tmp/app.apk"), "bea", "example.org", "ts.apk"
    )

    assert url is None
    assert error is not None
    assert len(calls) == 1


def test_upload_fails_if_scp_fails(monkeypatch):
    def fake_run(cmd, **kwargs):
        return SimpleNamespace(returncode=0 if cmd[0] == "ssh" else 1)

    monkeypatch.setattr(upload.subprocess, "run", fake_run)

    url, error = upload._upload(
        upload.Path("/tmp/app.apk"), "bea", "example.org", "ts.apk"
    )

    assert url is None
    assert error is not None


def test_run_aborts_without_config(tmp_path, capsys):
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    url, error = upload.run(command_context, str(tmp_path / "app.apk"))

    assert url is None
    assert error is not None
    assert "mach yeet auth" in capsys.readouterr().out


def test_run_aborts_when_file_missing(tmp_path):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    url, error = upload.run(command_context, str(tmp_path / "missing.apk"))

    assert url is None
    assert error is not None


def _write_apk(tmp_path):
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"not really an apk")
    return apk


def _set_confirm_answers(monkeypatch, *answers):
    answers = iter(answers)
    monkeypatch.setattr("builtins.input", lambda prompt="": next(answers))


def test_run_uploads_with_timestamped_name_and_prints_url(
    tmp_path, monkeypatch, capsys
):
    config = write_config(tmp_path)
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"not really an apk")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    _freeze_time(monkeypatch, datetime(2026, 9, 14, 12, 34, 56, tzinfo=timezone.utc))

    calls = []

    def fake_upload(file_path, ssh_user, ssh_host, remote_name):
        calls.append((file_path, ssh_user, ssh_host, remote_name))
        return f"https://{ssh_host}/~{ssh_user}/yeet/{remote_name}", None

    monkeypatch.setattr(upload, "_upload", fake_upload)

    url, error = upload.run(command_context, str(apk), assume_yes=True)

    assert error is None
    assert url == (
        f"https://{config['ssh_host']}/~{config['ssh_user']}/yeet/20260914-123456.apk"
    )
    assert calls == [
        (apk.resolve(), config["ssh_user"], config["ssh_host"], "20260914-123456.apk")
    ]
    assert url in capsys.readouterr().out


def test_run_reports_upload_failure(tmp_path, monkeypatch):
    write_config(tmp_path)
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"not really an apk")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    monkeypatch.setattr(
        upload,
        "_upload",
        lambda file_path, ssh_user, ssh_host, remote_name: (None, "boom"),
    )

    url, error = upload.run(command_context, str(apk), assume_yes=True)

    assert url is None
    assert error is not None


@pytest.mark.parametrize("answer", ["y", "yes", "Y"])
def test_run_uploads_after_confirmation(tmp_path, monkeypatch, answer):
    write_config(tmp_path)
    apk = _write_apk(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    _set_confirm_answers(monkeypatch, answer)
    monkeypatch.setattr(
        upload,
        "_upload",
        lambda file_path, ssh_user, ssh_host, remote_name: ("https://x/y", None),
    )

    url, error = upload.run(command_context, str(apk))

    assert (url, error) == ("https://x/y", None)


@pytest.mark.parametrize("answers", [("",), ("n",), ("no",), ("maybe", "n")])
def test_run_does_not_upload_when_declined(tmp_path, monkeypatch, answers):
    write_config(tmp_path)
    apk = _write_apk(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    _set_confirm_answers(monkeypatch, *answers)
    monkeypatch.setattr(
        upload,
        "_upload",
        lambda *args: pytest.fail("_upload called after the user declined"),
    )

    url, error = upload.run(command_context, str(apk))

    assert url is None
    assert error


def test_run_skips_confirmation_with_assume_yes(tmp_path, monkeypatch):
    write_config(tmp_path)
    apk = _write_apk(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    monkeypatch.setattr(
        "builtins.input", lambda prompt="": pytest.fail("unexpected prompt")
    )
    monkeypatch.setattr(
        upload,
        "_upload",
        lambda file_path, ssh_user, ssh_host, remote_name: ("https://x/y", None),
    )

    url, error = upload.run(command_context, str(apk), assume_yes=True)

    assert (url, error) == ("https://x/y", None)


if __name__ == "__main__":
    mozunit.main()
