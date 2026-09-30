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
    project = auth._resolve_project(value)

    assert project == f"{value.strip()}/{common.CANONICAL_GITLAB_REPO_NAME}"


@pytest.mark.parametrize(
    "value",
    [
        common.CANONICAL_GITLAB_NAMESPACE,
        common.CANONICAL_GITLAB_NAMESPACE.upper(),
        f"  {common.CANONICAL_GITLAB_NAMESPACE}  ",
    ],
)
def test_resolve_project_rejects_canonical_namespace(value):
    with pytest.raises(ValueError, match="canonical"):
        auth._resolve_project(value)


def test_resolve_project_accepts_top_level_group_of_canonical_namespace():
    group = common.CANONICAL_GITLAB_NAMESPACE.split("/", 1)[0]

    assert auth._resolve_project(group) == (
        f"{group}/{common.CANONICAL_GITLAB_REPO_NAME}"
    )


def test_prompt_fork_rejects_canonical_namespace(monkeypatch, capsys):
    canonical_namespace = common.CANONICAL_GITLAB_NAMESPACE
    _set_inputs(monkeypatch, canonical_namespace, "bea")

    project = auth._prompt_fork()

    assert project == f"bea/{common.CANONICAL_GITLAB_REPO_NAME}"
    assert "not a" in capsys.readouterr().out.lower()


@pytest.mark.parametrize("value", ["", "   ", "\t\n"])
def test_resolve_project_rejects_blank_username(value):
    with pytest.raises(ValueError):
        auth._resolve_project(value)


def test_prompt_fork_rejects_empty_username(monkeypatch):
    _set_inputs(monkeypatch, "", " \t ", "bea")

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
    _set_inputs(monkeypatch, "bea", "", "bea")
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
        "ssh_host": common.DEFAULT_SSH_HOST,
        "ssh_user": "bea",
    }
    assert (config_path.stat().st_mode & 0o777) == 0o600


def test_prompt_ssh_username_reprompts_until_non_empty(monkeypatch, capsys):
    _set_inputs(monkeypatch, "", "  ", "bea")

    assert auth._prompt_ssh_username(common.DEFAULT_SSH_HOST) == "bea"
    assert capsys.readouterr().out.count("ERROR!") == 2


def test_prompt_ssh_host_defaults_when_empty(monkeypatch):
    _set_inputs(monkeypatch, "  ")

    assert auth._prompt_ssh_host() == common.DEFAULT_SSH_HOST


def test_run_prompts_for_ssh_host(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "build.example.com", "bea")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context, verify=False, gitlab_username="bea", gitlab_token="s3cr3t"
    )

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        saved = json.load(f)
    assert saved["ssh_host"] == "build.example.com"
    assert saved["ssh_user"] == "bea"


def test_prompt_token_reprompts_until_non_empty(monkeypatch, capsys):
    values = iter(["", "  ", "s3cr3t"])
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": next(values))

    assert auth._prompt_token() == "s3cr3t"
    assert capsys.readouterr().out.count("ERROR!") == 2


def test_run_aborts_when_gitlab_verification_fails(tmp_path, monkeypatch, capsys):
    _set_inputs(monkeypatch, "bea", "", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: False)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()
    assert (
        "ERROR! GitLab rejected that project/token combination."
        in capsys.readouterr().out
    )


def test_run_aborts_when_gitlab_unreachable(tmp_path, monkeypatch, capsys):
    _set_inputs(monkeypatch, "bea", "", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")

    def raise_url_error(project, token):
        raise urllib.error.URLError("unreachable")

    monkeypatch.setattr(auth, "_verify_auth", raise_url_error)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()
    assert (
        "ERROR! Could not reach GitLab: <urlopen error unreachable>"
        in capsys.readouterr().out
    )


def test_run_aborts_when_ssh_verification_fails(tmp_path, monkeypatch, capsys):
    _set_inputs(monkeypatch, "bea", "", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: True)
    monkeypatch.setattr(auth, "_verify_ssh", lambda target: False)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()
    assert (
        f"ERROR! Could not SSH into bea@{common.DEFAULT_SSH_HOST}."
        in capsys.readouterr().out
    )


def test_run_saves_config_when_verification_succeeds(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "bea", "", "bea")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "s3cr3t")
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: True)
    monkeypatch.setattr(auth, "_verify_ssh", lambda target: True)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=True)

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        assert json.load(f) == {
            "project": f"bea/{common.CANONICAL_GITLAB_REPO_NAME}",
            "token": "s3cr3t",
            "ssh_host": common.DEFAULT_SSH_HOST,
            "ssh_user": "bea",
        }


def test_run_uses_cli_gitlab_username_and_still_prompts_for_rest(tmp_path, monkeypatch):
    # ssh host and username aren't given via CLI, so they're the only things
    # prompted for.
    _set_inputs(monkeypatch, "", "bea")
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
    canonical_namespace = common.CANONICAL_GITLAB_NAMESPACE
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context, verify=False, gitlab_username=canonical_namespace
    )

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()
    assert "not a" in capsys.readouterr().out.lower()


def test_run_fully_noninteractive_with_all_cli_args(tmp_path, monkeypatch):
    _forbid_prompts(monkeypatch)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context,
        verify=False,
        gitlab_username="bea",
        gitlab_token="s3cr3t",
        ssh_username="bea",
        ssh_host=common.DEFAULT_SSH_HOST,
    )

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        saved = json.load(f)
    assert saved == {
        "project": f"bea/{common.CANONICAL_GITLAB_REPO_NAME}",
        "token": "s3cr3t",
        "ssh_host": common.DEFAULT_SSH_HOST,
        "ssh_user": "bea",
    }


def test_run_saves_cli_ssh_host(tmp_path, monkeypatch):
    _forbid_prompts(monkeypatch)
    targets = []
    monkeypatch.setattr(auth, "_verify_auth", lambda project, token: True)
    monkeypatch.setattr(
        auth, "_verify_ssh", lambda target: targets.append(target) or True
    )
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context,
        verify=True,
        gitlab_username="bea",
        gitlab_token="s3cr3t",
        ssh_username="bea",
        ssh_host="build.example.com",
    )

    assert result == 0
    assert targets == ["bea@build.example.com"]
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        assert json.load(f)["ssh_host"] == "build.example.com"


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
        ssh_host=common.DEFAULT_SSH_HOST,
    )

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        assert json.load(f) == {
            "project": f"bea/{common.CANONICAL_GITLAB_REPO_NAME}",
            "token": "s3cr3t",
            "ssh_host": common.DEFAULT_SSH_HOST,
            "ssh_user": "bea",
        }


_CLI_ARGS = {
    "gitlab_username": "bea",
    "gitlab_token": "s3cr3t",
    "ssh_username": "bea",
    "ssh_host": "build.example.com",
}

_SAVED_CONFIG = {
    "project": f"bea/{common.CANONICAL_GITLAB_REPO_NAME}",
    "token": "s3cr3t",
    "ssh_host": "build.example.com",
    "ssh_user": "bea",
}


@pytest.mark.parametrize("padding", [" ", "\t", "\n", " \t\n "])
def test_run_trims_cli_args(tmp_path, monkeypatch, padding):
    _forbid_prompts(monkeypatch)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(
        command_context,
        verify=False,
        **{name: f"{padding}{value}{padding}" for name, value in _CLI_ARGS.items()},
    )

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        assert json.load(f) == _SAVED_CONFIG


def test_run_trims_prompted_values(tmp_path, monkeypatch):
    _set_inputs(monkeypatch, "  bea\t", " build.example.com\n", "\tbea  ")
    monkeypatch.setattr(common.getpass, "getpass", lambda prompt="": "  s3cr3t\t")
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=False)

    assert result == 0
    with open(tmp_path / common.YEET_CONFIG_FILENAME) as f:
        assert json.load(f) == _SAVED_CONFIG


@pytest.mark.parametrize("arg", list(_CLI_ARGS))
@pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
def test_run_rejects_blank_cli_arg(tmp_path, monkeypatch, capsys, arg, blank):
    _forbid_prompts(monkeypatch)
    command_context = SimpleNamespace(topsrcdir=str(tmp_path))

    result = auth.run(command_context, verify=False, **{**_CLI_ARGS, arg: blank})

    assert result == 1
    assert not (tmp_path / common.YEET_CONFIG_FILENAME).exists()
    assert "ERROR!" in capsys.readouterr().out


if __name__ == "__main__":
    mozunit.main()
