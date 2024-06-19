#!/usr/bin/env python3

import argparse
import os
import re
import shlex
import subprocess


def git(command):
    result = subprocess.run(
        ["git"] + shlex.split(command), check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def get_firefox_tag(reference):
    """Extracts the Firefox tag associated with a branch or tag name.

       The "firefox tag" is the tag that marks
       the end of the Mozilla commits and the start of the Tor Project commits.

       Know issue: If ever there is more than one tag per Firefox ESR version,
       this function may return the incorrect reference number.

    Args:
        reference: The branch or tag name to extract the Firefox tag from.
        Expected format is tor-browser-91.2.0esr-11.0-1,
        where 91.2.0esr is the Firefox version.

    Returns:
        The reference specifier of the matching Firefox tag.
        An exception will be raised if anything goes wrong.
    """

    # Extracts the version number from a branch or tag name.
    firefox_version = ""
    match = re.search(r"(?<=browser-)([^-]+)", reference)
    if match:
        # TODO: Validate that what we got is actually a valid semver string?
        firefox_version = match.group(1)
    else:
        raise ValueError(f"Failed to extract version from reference '{reference}'.")

    tag = f"FIREFOX_{firefox_version.replace('.', '_')}_"
    remote_tags = git("ls-remote --tags origin")

    # Each line looks like:
    # 9edd658bfd03a6b4743ecb75fd4a9ad968603715  refs/tags/FIREFOX_91_9_0esr_BUILD1
    pattern = rf"(.*){re.escape(tag)}(.*)$"
    match = re.search(pattern, remote_tags, flags=re.MULTILINE)
    if match:
        return match.group(0).split()[0]
    else:
        raise ValueError(
            f"Failed to find reference specifier for Firefox tag '{tag}' from '{reference}'."
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
        # For merge requests, the base_reference is the common ancestor between the MR and the target branch
        base_reference = os.getenv("CI_MERGE_REQUEST_DIFF_BASE_SHA")
    else:
        # When not in merge requests, the base reference is the Firefox tag
        base_reference = get_firefox_tag(os.getenv("CI_COMMIT_BRANCH"))

    if not base_reference:
        raise RuntimeError("No base reference found. There might be more errors above.")

    # Fetch the tag reference
    git(f"fetch origin {base_reference} --depth=1 --filter=blob:none")
    # Return but filter the issue_templates files because those file names have spaces which can cause issues
    return git("diff --diff-filter=d --name-only FETCH_HEAD HEAD").split("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="")

    parser.add_argument(
        "--get-firefox-tag",
        help="Get the Firefox tag related to a given (tor-mullvad-base)-browser tag or branch name.",
        type=str,
    )
    parser.add_argument(
        "--get-changed-files",
        help="Get list of changed files."
        "When running from a merge request get sthe list of changed files since the merge-base of the current branch."
        "When running from a protected branch i.e. any branch that starts with <something>-browser-, gets the list of files changed since the FIREFOX_ tag.",
        action="store_true",
    )

    args = parser.parse_args()

    if args.get_firefox_tag:
        print(get_firefox_tag(args.get_firefox_tag))
    elif args.get_changed_files:
        print("\n".join(get_list_of_changed_files()))
    else:
        print("No valid option provided.")
