# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import json
import urllib.error
from types import SimpleNamespace

import mozunit
import pytest
from yeet import auth, common


def _set_inputs(monkeypatch, *values):
    values = iter(values)
    monkeypatch.setattr("builtins.input", lambda prompt="": next(values))


def _forbid_prompts(monkeypatch):
    """Make input()/getpass() blow up instead of hanging, so a test can
    assert that a fully non-interactive call never prompts."""

    def _fail(prompt=""):
        raise AssertionError(f"unexpected prompt: {prompt!r}")

    monkeypatch.setattr("builtins.input", _fail)
    monkeypatch.setattr(common.getpass, "getpass", _fail)


@pytest.mark.parametrize("value", ["bea", "  bea  ", "bea.b", "bea_b-1"])
def test_resolve_project_accepts_username(value):
    project, error = auth._resolve_project(value)

    assert error is None
    assert project == f"{value.strip()}/{common.CANONICAL_GITLAB_REPO_NAME}"


@pytest.mark.parametrize(
    "value",
    [
        "",
        "bea/tor-browser-bundle-testsuite",
        "https://gitlab.torproject.org/bea/tor-browser-bundle-testsuite",
        "/bea/",
        "-bea",
        "bea x",
        "bea?x",
    ],
)
def test_resolve_project_rejects_non_username(value):
    project, error = auth._resolve_project(value)

    assert project is None
    assert error


def test_prompt_fork_rejects_canonical_namespace(monkeypatch, capsys):
    canonical_namespace = common.CANONICAL_GITLAB_PROJECT.split("/", 1)[0]
    _set_inputs(monkeypatch, canonical_namespace, "bea")

    project = auth._prompt_fork()

    assert project == f"bea/{common.CANONICAL_GITLAB_REPO_NAME}"
    assert "not a" in capsys.readouterr().out.lower()


def test_prompt_fork_rejects_empty_username(monkeypatch):
    _set_inputs(monkeypatch, "", "bea")

    project = auth._prompt_fork()

    assert project == f"bea/{common.CANONICAL_GITLAB_REPO_NAME}"


@pytest.mark.parametrize("status", [400])
def test_verify_auth_accepts_valid_token(monkeypatch, status):
    def fake_urlopen(request, *args, **kwargs):
        raise urllib.error.HTTPError("url", status, "msg", None, None)

    monkeypatch.setattr(auth.urllib.request, "urlopen", fake_urlopen)

    assert auth._verify_auth("bea/tor-browser-bundle-testsuite", "tok") is True


@pytest.mark.parametrize("status", [401, 404])
def test_verify_auth_rejects_bad_token_or_project(monkeypatch, status):
    def fake_urlopen(request, *args, **kwargs):
        raise urllib.error.HTTPError("url", status, "msg", None, None)

    monkeypatch.setattr(auth.urllib.request, "urlopen", fake_urlopen)

    assert auth._verify_auth("bea/tor-browser-bundle-testsuite", "tok") is False


def test_verify_auth_propagates_network_errors(monkeypatch):
    def fake_urlopen(request, *args, **kwargs):
        raise urllib.error.URLError("unreachable")

    monkeypatch.setattr(auth.urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(urllib.error.URLError):
        auth._verify_auth("bea/tor-browser-bundle-testsuite", "tok")


def test_verify_ssh_success(monkeypatch):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(auth.subprocess, "run", fake_run)

    assert auth._verify_ssh("bea@tb-build-03.torproject.org") is True
    cmd, kwargs = calls[0]
    assert cmd[-2:] == ["bea@tb-build-03.torproject.org", "true"]
    assert kwargs["stdin"] is auth.subprocess.DEVNULL


def test_verify_ssh_failure(monkeypatch):
    monkeypatch.setattr(
        auth.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=255),
    )

    assert auth._verify_ssh("bea@tb-build-03.torproject.org") is False


def test_verify_ssh_missing_binary(monkeypatch, capsys):
    def fake_run(*args, **kwargs):
        raise FileNotFoundError()

    monkeypatch.setattr(auth.subprocess, "run", fake_run)

    assert auth._verify_ssh("bea@tb-build-03.torproject.org") is False
    assert "no `ssh` binary" in capsys.readouterr().out.lower()


def test_run_saves_config_and_skips_verification(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "bea", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=False)

    assert result == 0
    config_path = tmp_path / common.YEET_CONFIG_FILENAME
    with open(config_path) as f:
        saved = json.load(f)
    assert saved == {
        "project": f"bea/{common.CANONICAL_GITLAB_REPO_NAME}",
        "token": "s3cr3t",
        "ssh_host": common.SSH_HOST,
        "ssh_user": "bea",
    }
    assert (config_path.stat().st_mode & 0o777) == 0o600


@pytest.mark.parametrize("value", ["bea", "_bea", "bea_1", "bea-b"])
def test_ssh_username_error_accepts_valid(value):
    assert auth._ssh_username_error(value) is None


@pytest.mark.parametrize(
    "value",
    [
        "",
        "bea@evil.example.com",
        "-oProxyCommand=true",
        "bea:x",
        "bea/x",
        "bea x",
        "1bea",
        "Bea",
    ],
)
def test_ssh_username_error_rejects_invalid(value):
    assert auth._ssh_username_error(value)


def test_prompt_ssh_username_reprompts_until_valid(monkeypatch, capsys):
    _set_inputs(monkeypatch, "", "bea@evil.example.com", "bea")

    assert auth._prompt_ssh_username() == "bea"
    assert capsys.readouterr().out.count("ERROR!") == 2


def test_prompt_token_reprompts_until_non_empty(monkeypatch, capsys):
    values = iter(["", "  ", "s3cr3t"])
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": next(values))

    assert auth._prompt_token() == "s3cr3t"
    assert capsys.readouterr().out.count("ERROR!") == 2


def test_run_rejects_empty_cli_gitlab_token(tmp_path, monkeypatch):
    _forbid_prompts(monkeypatch)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context,
        verify=False,
        gitlab_username="bea",
        gitlab_token="   ",
        ssh_username="bea",
    )

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()


def test_run_aborts_when_gitlab_verification_fails(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "bea", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: False)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()


def test_run_aborts_when_gitlab_unreachable(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "bea", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")

    def raise_url_error(project, token):
        raise urllib.error.URLError("unreachable")

    monkeypatch.setattr(auth, "_verify_auth", raise_url_error)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()


def test_run_aborts_when_ssh_verification_fails(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "bea", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: True)
    monkeypatch.setattr(auth, "_verify_ssh", lambda target: False)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()


def test_run_saves_config_when_verification_succeeds(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "bea", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: True)
    monkeypatch.setattr(auth, "_verify_ssh", lambda target: True)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 0
    assert (tmp_path / common.YEET_CONFIG_FILENAME).exists()


def test_run_uses_cli_gitlab_username_and_still_prompts_for_rest(tmp_path, monkeypatch):
    # ssh username isn't given via CLI, so it's the only thing prompted for.
    _set_inputs(monkeypatch, "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=False, gitlab_username="bea")

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        saved = json.load(f)
    assert saved["project"] == f"bea/{common.CANONICAL_GITLAB_REPO_NAME}"
    assert saved["ssh_user"] == "bea"


def test_run_rejects_invalid_cli_gitlab_username(tmp_path, monkeypatch, capsys):
    _forbid_prompts(monkeypatch)
    canonical_namespace = common.CANONICAL_GITLAB_PROJECT.split("/", 1)[0]
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context, verify=False, gitlab_username=canonical_namespace
    )

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()
    assert "not a" in capsys.readouterr().out.lower()


def test_run_rejects_empty_cli_gitlab_username(tmp_path, monkeypatch):
    _forbid_prompts(monkeypatch)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=False, gitlab_username="   ")

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()


@pytest.mark.parametrize("ssh_username", ["   ", "bea@evil.example.com"])
def test_run_rejects_invalid_cli_ssh_user(tmp_path, monkeypatch, ssh_username):
    _set_inputs(monkeypatch, "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=False, ssh_username=ssh_username)

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()


def test_run_fully_noninteractive_with_all_cli_args(tmp_path, monkeypatch):
    _forbid_prompts(monkeypatch)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context,
        verify=False,
        gitlab_username="bea",
        gitlab_token="s3cr3t",
        ssh_username="bea",
    )

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        saved = json.load(f)
    assert saved == {
        "project": f"bea/{common.CANONICAL_GITLAB_REPO_NAME}",
        "token": "s3cr3t",
        "ssh_host": common.SSH_HOST,
        "ssh_user": "bea",
    }


def test_run_fully_noninteractive_with_verification(tmp_path, monkeypatch):
    _forbid_prompts(monkeypatch)
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: True)
    monkeypatch.setattr(auth, "_verify_ssh", lambda target: True)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context,
        verify=True,
        gitlab_username="bea",
        gitlab_token="s3cr3t",
        ssh_username="bea",
    )

    assert result == 0
    assert (tmp_path / common.YEET_CONFIG_FILENAME).exists()


if __name__ == "__main__":
    mozunit.main()
