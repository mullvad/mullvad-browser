# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import json
import shlex
import urllib.error
from types import SimpleNamespace

import mozunit
import pytest
from conftest import write_config
from yeet import remote


class _FakeResponse:
    def __init__(self, body):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


def _write_version(tmp_path, version="153.2.0"):
    version_dir = tmp_path / "browser" / "config"
    version_dir.mkdir(parents=True)
    (version_dir / "version.txt").write_text(f"{version}\n")


def test_read_browser_version(tmp_path):
    _write_version(tmp_path, "1.2.3")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    assert remote._read_browser_version(command_context) == "1.2.3"


def test_resolve_version_prefers_given_value(tmp_path):
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    assert remote._resolve_version(command_context, "9.9.9") == "9.9.9"


def test_resolve_version_falls_back_to_in_tree_version(tmp_path, capsys):
    _write_version(tmp_path, "1.2.3")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    assert remote._resolve_version(command_context, None) == "1.2.3"
    assert "1.2.3" in capsys.readouterr().out


def test_artifacts_and_mozharness_urls():
    artifacts = remote._artifacts_url("1.2.3", "android_x86_64")

    assert artifacts == f"{remote.TOOLCHAINS_URL_BASE}/1.2.3/android-x86_64/"
    assert remote._mozharness_url("1.2.3", "android_x86_64") == (
        artifacts + "mozharness.zip"
    )


def test_curl_command_includes_header_data_and_url():
    command = remote._curl_command(
        "https://example.org/trigger",
        {"Content-Type": "application/json"},
        b'{"a": 1}',
    )

    assert shlex.split(command) == [
        "curl",
        "--request",
        "POST",
        "--header",
        "Content-Type: application/json",
        "--data",
        '{"a": 1}',
        "https://example.org/trigger",
    ]


def _failing_upload_run(cc, file, platform, assume_yes):
    raise RuntimeError("boom")


def test_resolve_installer_url_passes_through_a_url(tmp_path):
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    url = remote._resolve_installer_url(
        command_context,
        "https://example.org/app.apk",
        "android_x86_64",
        assume_yes=False,
        dry_run=False,
    )

    assert url == "https://example.org/app.apk"


def test_resolve_installer_url_uploads_a_local_path(tmp_path, monkeypatch):
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    calls = []

    def fake_upload_run(cc, file, platform, assume_yes):
        calls.append((cc, file, platform, assume_yes))
        return "https://tb-build-03.torproject.org/~bea/yeet/ts.apk"

    monkeypatch.setattr(remote.upload, "run", fake_upload_run)

    url = remote._resolve_installer_url(
        command_context,
        "/tmp/app.apk",
        "android_x86_64",
        assume_yes=True,
        dry_run=False,
    )

    assert url == "https://tb-build-03.torproject.org/~bea/yeet/ts.apk"
    assert calls == [(command_context, "/tmp/app.apk", "android_x86_64", True)]


def test_resolve_installer_url_propagates_upload_error(tmp_path, monkeypatch):
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    monkeypatch.setattr(remote.upload, "run", _failing_upload_run)

    with pytest.raises(RuntimeError, match="boom"):
        remote._resolve_installer_url(
            command_context,
            "/tmp/app.apk",
            "android_x86_64",
            assume_yes=False,
            dry_run=False,
        )


def test_prompt_platform_rejects_invalid_choice_then_accepts(monkeypatch):
    values = iter(["0", "99", "not-a-number", "2"])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(values))

    assert remote._prompt_platform() == remote.PLATFORMS[1]


def test_prompt_channel_rejects_invalid_choice_then_accepts(monkeypatch):
    values = iter(["0", "99", "not-a-number", "2"])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(values))

    assert remote._prompt_channel() == remote.ANDROID_CHANNELS[1]


def _run_kwargs(**overrides):
    kwargs = dict(
        platform="android_x86_64",
        channel="debug",
        installer_url="https://example.org/app.apk",
        sha256sums_url=None,
        artifacts_url="https://example.org/artifacts/",
        mozharness_url="https://example.org/mozharness.zip",
        version=None,
        ref="main",
        tags=["tor"],
        dry_run=False,
    )
    kwargs.update(overrides)
    return kwargs


def test_run_aborts_without_config(tmp_path, capsys):
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = remote.run(command_context, **_run_kwargs())

    assert result == 1
    assert "mach yeet auth" in capsys.readouterr().out


def test_run_dry_run_prints_curl_and_skips_network(tmp_path, monkeypatch, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    def fail_urlopen(*args, **kwargs):
        raise AssertionError("urlopen should not be called in dry-run mode")

    monkeypatch.setattr(remote.urllib.request, "urlopen", fail_urlopen)

    result = remote.run(command_context, **_run_kwargs(dry_run=True))

    assert result == 0
    out = capsys.readouterr().out
    assert "curl --request POST" in out
    assert "app.apk" in out


def test_run_prompts_for_platform_when_missing(tmp_path, monkeypatch, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    calls = []

    def fake_prompt_platform():
        calls.append(True)
        return "debian_x86_64"

    monkeypatch.setattr(remote, "_prompt_platform", fake_prompt_platform)

    result = remote.run(command_context, **_run_kwargs(platform=None, dry_run=True))

    assert result == 0
    assert len(calls) == 1
    assert "debian_x86_64_installer_url" in capsys.readouterr().out


def test_run_prompts_for_channel_when_android_and_missing(
    tmp_path, monkeypatch, capsys
):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    calls = []

    def fake_prompt_channel():
        calls.append(True)
        return "nightly"

    monkeypatch.setattr(remote, "_prompt_channel", fake_prompt_channel)

    result = remote.run(command_context, **_run_kwargs(channel=None, dry_run=True))

    assert result == 0
    assert len(calls) == 1
    assert remote.ANDROID_CHANNEL_PACKAGE_NAMES["nightly"] in capsys.readouterr().out


def test_run_adds_package_name_input_for_android(tmp_path, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = remote.run(command_context, **_run_kwargs(channel="nightly", dry_run=True))

    assert result == 0
    out = capsys.readouterr().out
    assert "android_x86_64_package_name" in out
    assert remote.ANDROID_CHANNEL_PACKAGE_NAMES["nightly"] in out


def test_run_skips_channel_for_non_android_platforms(tmp_path, monkeypatch, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    monkeypatch.setattr(
        remote,
        "_prompt_channel",
        lambda: (_ for _ in ()).throw(AssertionError("should not prompt")),
    )

    result = remote.run(
        command_context,
        **_run_kwargs(
            platform="debian_x86_64",
            channel=None,
            artifacts_url="https://example.org/artifacts/",
            mozharness_url="https://example.org/mozharness.zip",
            dry_run=True,
        ),
    )

    assert result == 0
    out = capsys.readouterr().out
    assert "package_name" not in out


def test_run_rejects_unknown_channel(tmp_path, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = remote.run(command_context, **_run_kwargs(channel="not-a-channel"))

    assert result == 1
    assert "ERROR! Unknown channel 'not-a-channel'." in capsys.readouterr().out


@pytest.mark.parametrize("dry_run", [False, True])
@pytest.mark.parametrize("installer_url", ["", "   ", "\t\n"])
def test_run_rejects_empty_installer(
    tmp_path, monkeypatch, capsys, installer_url, dry_run
):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    monkeypatch.setattr(
        remote, "_prompt_platform", lambda: pytest.fail("prompted for platform")
    )
    monkeypatch.setattr(
        remote.upload, "run", lambda *args, **kwargs: pytest.fail("uploaded")
    )
    monkeypatch.setattr(
        remote.urllib.request,
        "urlopen",
        lambda *args, **kwargs: pytest.fail("pipeline triggered"),
    )

    result = remote.run(
        command_context,
        **_run_kwargs(platform=None, installer_url=installer_url, dry_run=dry_run),
    )

    assert result == 1
    out = capsys.readouterr().out
    assert "ERROR! The installer URL or path was empty." in out
    assert "curl" not in out


def test_run_trims_installer_url(tmp_path, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = remote.run(
        command_context,
        **_run_kwargs(installer_url="  https://example.org/app.apk\n", dry_run=True),
    )

    assert result == 0
    assert '"android_x86_64_installer_url": "https://example.org/app.apk"' in (
        capsys.readouterr().out
    )


def test_run_ignores_channel_for_non_android_platforms(tmp_path, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = remote.run(
        command_context,
        **_run_kwargs(platform="debian_x86_64", channel="nightly", dry_run=True),
    )

    assert result == 0
    out = capsys.readouterr().out
    assert "package_name" not in out
    assert remote.ANDROID_CHANNEL_PACKAGE_NAMES["nightly"] not in out


@pytest.mark.parametrize(
    "platform,installer",
    [
        ("debian_x86_64", "tor-browser-linux-x86_64.tar.xz"),
        ("windows_x86_64", "tor-browser-windows-x86_64-portable.exe"),
        ("macos_x86_64", "tor-browser-macos.dmg"),
        ("android_x86_64", "tor-browser-android-x86_64.apk"),
    ],
)
def test_run_uploads_a_local_path_before_triggering(
    tmp_path, monkeypatch, platform, installer
):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    installer_path = f"/tmp/{installer}"
    uploaded_url = (
        f"https://tb-build-03.torproject.org/~bea/yeet/ts-{platform}/{installer}"
    )
    uploads = []

    def fake_upload_run(cc, file, platform, assume_yes):
        uploads.append((file, platform))
        return uploaded_url

    monkeypatch.setattr(remote.upload, "run", fake_upload_run)
    requests = []

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _FakeResponse(json.dumps({"web_url": "https://x"}).encode())

    monkeypatch.setattr(remote.urllib.request, "urlopen", fake_urlopen)

    result = remote.run(
        command_context,
        **_run_kwargs(platform=platform, installer_url=installer_path),
    )

    assert result == 0
    assert uploads == [(installer_path, platform)]
    inputs = json.loads(requests[0].data)["inputs"]
    assert inputs[f"{platform}_installer_url"] == uploaded_url
    assert (f"{platform}_package_name" in inputs) == (platform == "android_x86_64")


def test_run_prompts_for_platform_before_uploading(tmp_path, monkeypatch):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    monkeypatch.setattr(remote, "_prompt_platform", lambda: "debian_x86_64")
    seen = []

    def fake_upload_run(cc, file, platform, assume_yes):
        seen.append(platform)
        raise RuntimeError("stop here")

    monkeypatch.setattr(remote.upload, "run", fake_upload_run)

    remote.run(
        command_context, **_run_kwargs(platform=None, installer_url="/tmp/app.tar.xz")
    )

    assert seen == ["debian_x86_64"]


@pytest.mark.parametrize("assume_yes", [False, True])
def test_run_forwards_assume_yes_to_upload(tmp_path, monkeypatch, assume_yes):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    seen = []

    def fake_upload_run(cc, file, platform, assume_yes):
        seen.append(assume_yes)
        raise RuntimeError("stop here")

    monkeypatch.setattr(remote.upload, "run", fake_upload_run)

    remote.run(
        command_context,
        **_run_kwargs(installer_url="/tmp/app.apk", assume_yes=assume_yes),
    )

    assert seen == [assume_yes]


@pytest.mark.parametrize(
    "tags,expected",
    [
        (["tor", "base-browser"], "--tag tor --tag base-browser"),
        (["a b"], "--tag 'a b'"),
        (["a b", '"c"'], """--tag 'a b' --tag '"c"'"""),
    ],
)
def test_run_formats_tags_as_flags(tmp_path, monkeypatch, tags, expected):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    requests = []

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _FakeResponse(json.dumps({"web_url": "https://x"}).encode())

    monkeypatch.setattr(remote.urllib.request, "urlopen", fake_urlopen)

    remote.run(command_context, **_run_kwargs(tags=tags))

    assert json.loads(requests[0].data)["inputs"]["tags"] == expected


def test_run_omits_tags_input_when_empty(tmp_path, monkeypatch):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    requests = []

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _FakeResponse(json.dumps({"web_url": "https://x"}).encode())

    monkeypatch.setattr(remote.urllib.request, "urlopen", fake_urlopen)

    remote.run(command_context, **_run_kwargs(tags=[]))

    assert "tags" not in json.loads(requests[0].data)["inputs"]


def _triggered_inputs(tmp_path, monkeypatch, **overrides):
    write_config(tmp_path)
    _write_version(tmp_path, "1.2.3")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    requests = []

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _FakeResponse(json.dumps({"web_url": "https://x"}).encode())

    monkeypatch.setattr(remote.urllib.request, "urlopen", fake_urlopen)

    assert remote.run(command_context, **_run_kwargs(**overrides)) == 0
    return json.loads(requests[0].data)["inputs"]


@pytest.mark.parametrize("sha256sums_url", [None, "https://example.org/sha256sums.txt"])
def test_run_includes_sha256sums_input_only_when_given(
    tmp_path, monkeypatch, sha256sums_url
):
    inputs = _triggered_inputs(tmp_path, monkeypatch, sha256sums_url=sha256sums_url)

    assert inputs.get("android_x86_64_sha256sums_url") == sha256sums_url


@pytest.mark.parametrize("artifacts_url", [None, "https://example.org/artifacts/"])
@pytest.mark.parametrize("mozharness_url", [None, "https://example.org/mozharness.zip"])
def test_run_uses_given_artifacts_and_mozharness_urls_or_infers_them(
    tmp_path, monkeypatch, artifacts_url, mozharness_url
):
    inputs = _triggered_inputs(
        tmp_path,
        monkeypatch,
        artifacts_url=artifacts_url,
        mozharness_url=mozharness_url,
    )

    assert inputs["android_x86_64_artifacts_url"] == (
        artifacts_url or remote._artifacts_url("1.2.3", "android_x86_64")
    )
    assert inputs["mozharness_url"] == (
        mozharness_url or remote._mozharness_url("1.2.3", "android_x86_64")
    )


def test_run_aborts_when_local_upload_fails(tmp_path, monkeypatch, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    monkeypatch.setattr(remote.upload, "run", _failing_upload_run)
    monkeypatch.setattr(
        remote.urllib.request,
        "urlopen",
        lambda *args, **kwargs: pytest.fail("pipeline triggered after failed upload"),
    )

    result = remote.run(command_context, **_run_kwargs(installer_url="/tmp/app.apk"))

    assert result == 1
    assert "ERROR! boom" in capsys.readouterr().out


def test_run_dry_run_does_not_upload_a_local_path(tmp_path, monkeypatch, capsys):
    write_config(tmp_path)
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"not really an apk")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    monkeypatch.setattr(
        remote.upload,
        "run",
        lambda *args, **kwargs: pytest.fail("uploaded during a dry run"),
    )

    result = remote.run(
        command_context, **_run_kwargs(installer_url=str(apk), dry_run=True)
    )

    assert result == 0
    assert "<URL of uploaded app.apk>" in capsys.readouterr().out


def test_run_dry_run_rejects_missing_local_path(tmp_path, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))
    missing = tmp_path / "missing.apk"

    result = remote.run(
        command_context, **_run_kwargs(installer_url=str(missing), dry_run=True)
    )

    assert result == 1
    out = capsys.readouterr().out
    assert f"ERROR! No such file: {missing}" in out
    assert "curl" not in out


def test_run_infers_version_artifacts_and_mozharness(tmp_path, capsys):
    write_config(tmp_path)
    _write_version(tmp_path, "1.2.3")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = remote.run(
        command_context,
        **_run_kwargs(artifacts_url=None, mozharness_url=None, dry_run=True),
    )

    assert result == 0
    out = capsys.readouterr().out
    assert "1.2.3" in out
    assert "android-x86_64" in out


def test_run_triggers_pipeline_and_reports_url(tmp_path, monkeypatch, capsys):
    config = write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    requests = []

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        body = json.dumps({"web_url": "https://gitlab.example/pipelines/1"}).encode()
        return _FakeResponse(body)

    monkeypatch.setattr(remote.urllib.request, "urlopen", fake_urlopen)

    result = remote.run(command_context, **_run_kwargs())

    assert result == 0
    assert "https://gitlab.example/pipelines/1" in capsys.readouterr().out
    assert requests[0].full_url == (
        f"{remote.GITLAB_API_BASE}/projects/"
        f"{config['project'].replace('/', '%2F')}/trigger/pipeline"
    )
    payload = json.loads(requests[0].data)
    assert payload["token"] == config["token"]
    assert payload["ref"] == "main"
    assert payload["inputs"]["tags"] == "--tag tor"


def test_run_reports_http_error(tmp_path, monkeypatch, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    def fake_urlopen(request, timeout=None):
        raise urllib.error.HTTPError(
            request.full_url,
            401,
            "Unauthorized",
            None,
            SimpleNamespace(read=lambda: b"bad token", close=lambda: None),
        )

    monkeypatch.setattr(remote.urllib.request, "urlopen", fake_urlopen)

    result = remote.run(command_context, **_run_kwargs())

    assert result == 1
    out = capsys.readouterr().out
    assert "401" in out
    assert "bad token" in out


def test_run_reports_url_error(tmp_path, monkeypatch, capsys):
    write_config(tmp_path)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    def fake_urlopen(request, timeout=None):
        raise urllib.error.URLError("unreachable")

    monkeypatch.setattr(remote.urllib.request, "urlopen", fake_urlopen)

    result = remote.run(command_context, **_run_kwargs())

    assert result == 1
    assert "unreachable" in capsys.readouterr().out


if __name__ == "__main__":
    mozunit.main()
