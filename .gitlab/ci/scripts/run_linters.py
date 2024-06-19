#!/usr/bin/env python3

import argparse
import os
import re
import shlex
import subprocess
import sys


def git(command):
    result = subprocess.run(
        ["git"] + shlex.split(command), check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def get_firefox_tag_from_branch_name(branch_name):
    """Extracts the Firefox tag associated with a branch name.

       The "firefox tag" is the tag that marks
       the end of the Mozilla commits and the start of the Tor Project commits.

       Know issue: If ever there is more than one tag per Firefox ESR version,
       this function may return the incorrect reference number.

    Args:
        branch_name: The branch name to extract the tag from.
        Expected format is tor-browser-91.2.0esr-11.0-1,
        where 91.2.0esr is the Firefox version.

    Returns:
        The reference specifier of the matching Firefox tag.
        An exception wil be raised if anything goes wrong.
    """

    # Extracts the version number from a branch name.
    firefox_version = ""
    match = re.search(r"(?<=browser-)([^-]+)", branch_name)
    if match:
        # TODO: Validate that what we got is actually a valid semver string?
        firefox_version = match.group(1)
    else:
        raise ValueError(f"Failed to extract version from branch name '{branch_name}'.")

    tag = f"FIREFOX_{firefox_version.replace('.', '_')}_"
    remote_tags = git("ls-remote --tags")

    # Each line looks like:
    # 9edd658bfd03a6b4743ecb75fd4a9ad968603715  refs/tags/FIREFOX_91_9_0esr_BUILD1
    pattern = rf"(.*){re.escape(tag)}(.*)$"
    match = re.search(pattern, remote_tags, flags=re.MULTILINE)
    if match:
        return match.group(0).split()[0]
    else:
        raise ValueError(
            f"Failed to find reference specifier for Firefox tag in branch '{branch_name}'."
        )


def get_list_of_changed_files():
    """Gets a list of files changed in the working directory.

       This function is meant to be run inside the Gitlab CI environment.

       When running in a default branch, get the list of changed files since the last Firefox tag.
       When running for a new MR commit, get a list of changed files in the current MR.

    Returns:
        A list of filenames of changed files (excluding deleted files).
        An exception wil be raised if anything goes wrong.
    """

    base_reference = ""

    if os.getenv("CI_PIPELINE_SOURCE") == "merge_request_event":
        # For merge requests, the base_reference is the common ancestor between the MR and the target branch.
        base_reference = os.getenv("CI_MERGE_REQUEST_DIFF_BASE_SHA")
    else:
        # When not in merge requests, the base reference is the Firefox tag
        base_reference = get_firefox_tag_from_branch_name(os.getenv("CI_COMMIT_BRANCH"))

    if not base_reference:
        raise RuntimeError("No base reference found. There might be more errors above.")

    # Fetch the tag reference
    git(f"fetch origin {base_reference} --depth=1 --filter=blob:none")
    # Return the list of changed files
    return git(f"diff --diff-filter=d --name-only {base_reference} HEAD").split("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run ./mach linters in CI. Warning: if you run this in your local environment it might mess up your git history."
    )
    parser.add_argument(
        "linters", metavar="L", type=str, nargs="+", help="A list of linters to run."
    )
    args = parser.parse_args()

    command = [
        "./mach",
        "lint",
        "-v",
        *(s for l in args.linters for s in ("-l", l)),
        *get_list_of_changed_files(),
    ]
    result = subprocess.run(command, text=True)

    sys.exit(result.returncode)
