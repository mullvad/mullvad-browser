import argparse
import json
import logging
import os
import re
import subprocess

from combine import combine_files

arg_parser = argparse.ArgumentParser(
    description="Combine a translation file across two different versions"
)

arg_parser.add_argument(
    "current_branch", metavar="<current-branch>", help="branch for the newest version"
)
arg_parser.add_argument(
    "files", metavar="<files>", help="JSON specifying the translation files"
)
arg_parser.add_argument("outname", metavar="<json>", help="name of the json output")

args = arg_parser.parse_args()

logging.basicConfig()
logger = logging.getLogger("combine-translation-versions")
logger.setLevel(logging.INFO)


def in_pink(msg: str) -> str:
    """Present a message as pink in the terminal output.

    :param msg: The message to wrap in pink.
    :returns: The message to print to terminal.
    """
    # Pink and bold.
    return f"\x1b[1;38;5;212m{msg}\x1b[0m"


def git_run(git_args: list[str]) -> None:
    """Run a git command.

    :param git_args: The arguments that should follow "git".
    """
    # Add some text to give context to git's stderr appearing in log.
    logger.info("Running: " + in_pink("git " + " ".join(git_args)))
    subprocess.run(["git", *git_args], check=True)


def git_text(git_args: list[str]) -> str:
    """Get the text output for a git command.

    :param git_args: The arguments that should follow "git".
    :returns: The stdout of the command.
    """
    logger.info("Running: " + in_pink("git " + " ".join(git_args)))
    return subprocess.run(
        ["git", *git_args], text=True, check=True, stdout=subprocess.PIPE
    ).stdout


def git_lines(git_args: list[str]) -> list[str]:
    """Get the lines from a git command.

    :param git_args: The arguments that should follow "git".
    :returns: The non-empty lines from stdout of the command.
    """
    return [line for line in git_text(git_args).split("\n") if line]


class TranslationFile:
    """Represents a translation file."""

    def __init__(self, path: str, content: str) -> None:
        self.path = path
        self.content = content


class BrowserBranch:
    """Represents a browser git branch."""

    def __init__(self, branch_name: str, is_head: bool = False) -> None:
        """Create a new instance.

        :param branch_name: The branch's git name.
        :param is_head: Whether the branch matches "HEAD".
        """
        version_match = re.match(
            r"(?P<prefix>[a-z]+\-browser)\-"
            r"(?P<firefox>[0-9]+(?:\.[0-9]+){1,2})esr\-"
            r"(?P<browser>[0-9]+\.[05])\-"
            r"(?P<number>[0-9]+)$",
            branch_name,
        )

        if not version_match:
            raise ValueError(f"Unable to parse the version from the ref {branch_name}")

        self.name = branch_name
        self.prefix = version_match.group("prefix")
        self.browser_version = version_match.group("browser")
        # Convert tor-browser to "Tor Browser", and similar.
        browser_name = self.prefix.replace("-", " ").title()
        self.browser_version_name = f"{browser_name} {self.browser_version}"

        self._is_head = is_head
        self._ref = "HEAD" if is_head else f"origin/{branch_name}"

        firefox_nums = [int(n) for n in version_match.group("firefox").split(".")]
        if len(firefox_nums) == 2:
            firefox_nums.append(0)
        browser_nums = [int(n) for n in self.browser_version.split(".")]
        branch_number = int(version_match.group("number"))
        # Prioritise the firefox ESR version, then the browser version then the
        # branch number.
        self._ordered = (
            firefox_nums[0],
            firefox_nums[1],
            firefox_nums[2],
            browser_nums[0],
            browser_nums[1],
            branch_number,
        )

        # Minor version for browser is only ever "0" or "5", so we can convert
        # the version to an integer.
        self._browser_int_version = int(2 * float(self.browser_version))

        self._file_paths: list[str] | None = None

    def release_below(self, other: "BrowserBranch", num: int) -> bool:
        """Determine whether another branch is within range of a previous
        browser release.

        The browser versions are expected to increment by "0.5", and a previous
        release branch's version is expected to be `num * 0.5` behind the
        current one.

        :param other: The branch to compare.
        :param num: The number of "0.5" releases behind to test with.
        """
        return other._browser_int_version == self._browser_int_version - num

    def __lt__(self, other: "BrowserBranch") -> bool:
        return self._ordered < other._ordered

    def __gt__(self, other: "BrowserBranch") -> bool:
        return self._ordered > other._ordered

    def _matching_dirs(self, path: str, dir_list: list[str]) -> bool:
        """Test that a path is contained in the list of dirs.

        :param path: The path to check.
        :param dir_list: The list of directories to check against.
        :returns: Whether the path matches.
        """
        for dir_path in dir_list:
            if os.path.commonpath([dir_path, path]) == dir_path:
                return True
        return False

    def get_file(
        self, filename: str, search_dirs: list[str] | None
    ) -> TranslationFile | None:
        """Fetch the file content for the named file in this branch.

        :param filename: The name of the file to fetch the content for.
        :param search_dirs: The directories to restrict the search to, or None
          to search for the file anywhere.
        :returns: The file, or `None` if no file could be found.
        """
        if self._file_paths is None:
            if not self._is_head:
                # Minimal fetch of non-HEAD branch to get the file paths.
                # Individual file blobs will be downloaded as needed.
                git_run(
                    ["fetch", "--depth=1", "--filter=blob:none", "origin", self.name]
                )
            self._file_paths = git_lines(
                ["ls-tree", "-r", "--format=%(path)", self._ref]
            )

        matching = [
            path
            for path in self._file_paths
            if os.path.basename(path) == filename
            and (search_dirs is None or self._matching_dirs(path, search_dirs))
        ]
        if not matching:
            return None
        if len(matching) > 1:
            raise Exception(f"Multiple occurrences of {filename}")

        path = matching[0]

        return TranslationFile(
            path=path, content=git_text(["cat-file", "blob", f"{self._ref}:{path}"])
        )


def get_stable_branch(
    compare_version: BrowserBranch,
) -> tuple[BrowserBranch, BrowserBranch | None]:
    """Find the most recent stable branch in the origin repository.

    :param compare_version: The development branch to compare against.
    :returns: The stable and legacy branches. If no legacy branch is found,
      `None` will be returned instead.
    """
    # We search for build1 tags. These are added *after* the rebase of browser
    # commits, so the corresponding branch should contain our strings.
    # Moreover, we *assume* that the branch with the most recent ESR version
    # with such a tag will be used in the *next* stable build in
    # tor-browser-build.
    tag_glob = f"{compare_version.prefix}-*-build1"

    # To speed up, only fetch the tags without blobs.
    git_run(
        ["fetch", "--depth=1", "--filter=object:type=tag", "origin", "tag", tag_glob]
    )
    stable_branches = []
    legacy_branches = []
    stable_annotation_regex = re.compile(r"\bstable\b")
    legacy_annotation_regex = re.compile(r"\blegacy\b")
    tag_pattern = re.compile(
        rf"^{re.escape(compare_version.prefix)}-[^-]+esr-[^-]+-[^-]+-build1$"
    )

    for build_tag, annotation in (
        line.split(" ", 1) for line in git_lines(["tag", "-n1", "--list", tag_glob])
    ):
        if not tag_pattern.match(build_tag):
            continue
        is_stable = bool(stable_annotation_regex.search(annotation))
        is_legacy = bool(legacy_annotation_regex.search(annotation))
        if not is_stable and not is_legacy:
            continue
        try:
            # Branch name is the same as the tag, minus "-build1".
            branch = BrowserBranch(re.sub(r"-build1$", "", build_tag))
        except ValueError:
            logger.warning(f"Could not read the version for {build_tag}")
            continue
        if branch.prefix != compare_version.prefix:
            continue
        if is_stable:
            # Stable can be one release version behind.
            # NOTE: In principle, when switching between versions there may be a
            # window of time where the development branch has not yet progressed
            # to the next "0.5" release, so has the same browser version as the
            # stable branch. So we also allow for matching browser versions.
            # NOTE:
            # 1. The "Will be unused in" message will not make sense, but we do
            #    not expect string differences in this scenario.
            # 2. We do not expect this scenario to last for long.
            if not (
                compare_version.release_below(branch, 1)
                or compare_version.release_below(branch, 0)
            ):
                continue
            stable_branches.append(branch)
        elif is_legacy:
            # Legacy can be two release versions behind.
            # We also allow for being just one version behind.
            if not (
                compare_version.release_below(branch, 2)
                or compare_version.release_below(branch, 1)
            ):
                continue
            legacy_branches.append(branch)

    if not stable_branches:
        raise Exception("No stable build1 branch found")

    return (
        # Return the stable branch with the highest version.
        max(stable_branches),
        max(legacy_branches) if legacy_branches else None,
    )


current_branch = BrowserBranch(args.current_branch, is_head=True)

stable_branch, legacy_branch = get_stable_branch(current_branch)

if os.environ.get("TRANSLATION_INCLUDE_LEGACY", "") != "true":
    legacy_branch = None

files_list = []

for file_dict in json.loads(args.files):
    name = file_dict["name"]
    where_dirs = file_dict.get("where", None)
    current_file = current_branch.get_file(name, where_dirs)
    stable_file = stable_branch.get_file(name, where_dirs)

    if current_file is None and stable_file is None:
        # No file in either branch.
        logger.warning(f"{name} does not exist in either the current or stable branch")
    elif current_file is None:
        logger.warning(f"{name} deleted in the current branch")
    elif stable_file is None:
        logger.warning(f"{name} does not exist in the stable branch")
    elif current_file.path != stable_file.path:
        logger.warning(
            f"{name} has different paths in the current and stable branch. "
            f"{current_file.path} : {stable_file.path}"
        )

    content = None if current_file is None else current_file.content

    # If we have a branding file, we want to also include strings from the other
    # branding directories that differ from the stable release.
    # The strings that *differ* per release should be specified in
    # file_dict["branding"]["ids"]. These strings will be copied from the other
    # release's branding directory, with an addition suffix added to their ID,
    # as specified in the version_dict["suffix"].
    branding = file_dict.get("branding", None)
    if branding:
        include_ids = branding["ids"]
        for version_dict in branding["versions"]:
            branding_dirs = version_dict.get("where", None)
            branding_file = current_branch.get_file(name, branding_dirs)
            if branding_file is None:
                raise Exception(f"{name} does not exist in {branding_dirs}")
            content = combine_files(
                name,
                content,
                branding_file.content,
                f'{version_dict["name"]} Release.',
                include_ids,
                version_dict["suffix"],
            )

    content = combine_files(
        name,
        content,
        None if stable_file is None else stable_file.content,
        f"Will be unused in {current_branch.browser_version_name}!",
    )

    if legacy_branch and not file_dict.get("exclude-legacy", False):
        legacy_file = legacy_branch.get_file(name, where_dirs)
        if legacy_file is not None and current_file is None and stable_file is None:
            logger.warning(f"{name} still exists in the legacy branch")
        elif legacy_file is None:
            logger.warning(f"{name} does not exist in the legacy branch")
        elif stable_file is not None and legacy_file.path != stable_file.path:
            logger.warning(
                f"{name} has different paths in the stable and legacy branch. "
                f"{stable_file.path} : {legacy_file.path}"
            )
        elif current_file is not None and legacy_file.path != current_file.path:
            logger.warning(
                f"{name} has different paths in the current and legacy branch. "
                f"{current_file.path} : {legacy_file.path}"
            )

        content = combine_files(
            name,
            content,
            legacy_file.content,
            f"Unused in {stable_branch.browser_version_name}!",
        )
    elif legacy_branch:
        logger.info(f"Excluding legacy branch for {name}")

    files_list.append(
        {
            "name": name,
            # If "directory" is unspecified, we place the file directly beneath
            # en-US/ in the translation repository. i.e. "".
            "directory": file_dict.get("directory", ""),
            "branch": file_dict["branch"],
            "content": content,
        }
    )


ci_commit = os.environ.get("CI_COMMIT_SHA", "")
ci_url_base = os.environ.get("CI_PROJECT_URL", "")

json_data = {
    "commit": ci_commit,
    "commit-url": f"{ci_url_base}/-/commit/{ci_commit}"
    if (ci_commit and ci_url_base)
    else "",
    "project-path": os.environ.get("CI_PROJECT_PATH", ""),
    "current-branch": current_branch.name,
    "stable-branch": stable_branch.name,
    "files": files_list,
}

if legacy_branch:
    json_data["legacy-branch"] = legacy_branch.name

with open(args.outname, "w") as file:
    json.dump(json_data, file)
