# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import mozunit
import pytest
from conftest import write_config
from yeet import upload


def _freeze_time(monkeypatch, fixed):
    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz)

    monkeypatch.setattr(upload, "datetime", _FrozenDatetime)


def test_resolve_file_missing():
    with pytest.raises(FileNotFoundError, match="No such file"):
        upload.resolve_file("/no/such/file/here")


def test_resolve_file_existing(tmp_path):
    apk = tmp_path / "fenix-x86_64-debug.apk"
    apk.write_bytes(b"not really an apk")

    assert upload.resolve_file(str(apk)) == apk.resolve()


@pytest.mark.parametrize(
    "fixed,expected",
    [
        (datetime(2026, 9, 14, 12, 34, 56, tzinfo=timezone.utc), "20260914-123456"),
        (
            datetime(
                2026, 9, 14, 18, 4, 56, tzinfo=timezone(timedelta(hours=5, minutes=30))
            ),
            "20260914-123456",
        ),
        (
            datetime(2026, 9, 14, 21, 0, 0, tzinfo=timezone(timedelta(hours=-5))),
            "20260915-020000",
        ),
    ],
)
def test_remote_dir_name_is_current_utc_time_and_platform(monkeypatch, fixed, expected):
    _freeze_time(monkeypatch, fixed)

    assert upload._remote_dir_name("android_x86_64") == f"{expected}-android_x86_64"


def test_upload_success(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        assert kwargs["stdin"] is upload.subprocess.DEVNULL
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(upload.subprocess, "run", fake_run)

    url = upload._upload(upload.Path("/tmp/app.apk"), "bea", "example.org", "ts-os")

    assert url == "https://example.org/~bea/yeet/ts-os/app.apk"
    assert calls[0][0] == "ssh"
    assert calls[0][-3:] == ["mkdir", "-p", "~/public_html/yeet/ts-os"]
    assert calls[1][0] == "scp"
    assert calls[1][-2:] == [
        "/tmp/app.apk",
        "bea@example.org:~/public_html/yeet/ts-os/app.apk",
    ]


def test_upload_replaces_unsafe_filename_characters(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(upload.subprocess, "run", fake_run)

    url = upload._upload(
        upload.Path("/tmp/app (1)#%?.apk"), "bea", "example.org", "ts-os"
    )

    assert url == "https://example.org/~bea/yeet/ts-os/app__1____.apk"
    assert calls[1][-2:] == [
        "/tmp/app (1)#%?.apk",
        "bea@example.org:~/public_html/yeet/ts-os/app__1____.apk",
    ]


def test_upload_stops_if_mkdir_fails(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return SimpleNamespace(returncode=1)

    monkeypatch.setattr(upload.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError):
        upload._upload(upload.Path("/tmp/app.apk"), "bea", "example.org", "ts-os")

    assert len(calls) == 1


def test_upload_fails_if_scp_fails(monkeypatch):
    def fake_run(cmd, **kwargs):
        return SimpleNamespace(returncode=0 if cmd[0] == "ssh" else 1)

    monkeypatch.setattr(upload.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError):
        upload._upload(upload.Path("/tmp/app.apk"), "bea", "example.org", "ts-os")


def test_run_aborts_without_config(tmp_path):
    apk = tmp_path / "app.apk"
    apk.touch()
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    with pytest.raises(FileNotFoundError, match="mach yeet auth"):
        upload.run(command_context, str(apk), "android_x86_64")


def test_run_aborts_when_file_missing(tmp_path):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    with pytest.raises(FileNotFoundError):
        upload.run(command_context, str(tmp_path / "missing.apk"), "android_x86_64")


def _write_apk(tmp_path):
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"not really an apk")
    return apk


def _set_confirm_answers(monkeypatch, *answers):
    answers = iter(answers)
    monkeypatch.setattr("builtins.input", lambda prompt="": next(answers))


def test_run_uploads_into_timestamped_dir_and_prints_url(tmp_path, monkeypatch, capsys):
    config = write_config(tmp_path)
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"not really an apk")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    _freeze_time(monkeypatch, datetime(2026, 9, 14, 12, 34, 56, tzinfo=timezone.utc))

    calls = []

    def fake_upload(file_path, ssh_user, ssh_host, remote_dir):
        calls.append((file_path, ssh_user, ssh_host, remote_dir))
        return f"https://{ssh_host}/~{ssh_user}/yeet/{remote_dir}/{file_path.name}"

    monkeypatch.setattr(upload, "_upload", fake_upload)

    url = upload.run(command_context, str(apk), "android_x86_64", assume_yes=True)

    assert url == (
        f"https://{config['ssh_host']}/~{config['ssh_user']}/yeet/20260914-123456-android_x86_64/app.apk"
    )
    assert calls == [
        (
            apk.resolve(),
            config["ssh_user"],
            config["ssh_host"],
            "20260914-123456-android_x86_64",
        )
    ]
    assert url in capsys.readouterr().out


def test_run_reports_upload_failure(tmp_path, monkeypatch):
    write_config(tmp_path)
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"not really an apk")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    def fake_upload(file_path, ssh_user, ssh_host, remote_dir):
        raise RuntimeError("boom")

    monkeypatch.setattr(upload, "_upload", fake_upload)

    with pytest.raises(RuntimeError, match="boom"):
        upload.run(command_context, str(apk), "android_x86_64", assume_yes=True)


@pytest.mark.parametrize("answer", ["y", "yes", "Y"])
def test_run_uploads_after_confirmation(tmp_path, monkeypatch, answer):
    write_config(tmp_path)
    apk = _write_apk(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    _set_confirm_answers(monkeypatch, answer)
    monkeypatch.setattr(
        upload,
        "_upload",
        lambda file_path, ssh_user, ssh_host, remote_dir: "https://x/y",
    )

    assert upload.run(command_context, str(apk), "android_x86_64") == "https://x/y"


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

    with pytest.raises(RuntimeError, match="cancelled"):
        upload.run(command_context, str(apk), "android_x86_64")


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
        lambda file_path, ssh_user, ssh_host, remote_dir: "https://x/y",
    )

    assert (
        upload.run(command_context, str(apk), "android_x86_64", assume_yes=True)
        == "https://x/y"
    )


if __name__ == "__main__":
    mozunit.main()
