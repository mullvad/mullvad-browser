"""
Simple tool for checking for missing CSS declarations.

Should be run from the root directory and passed a single CSS file path to
check the variables for.

Missing variables will be printed to stdout, if any. Variables are considered
missing if they are not declared in the same file or in one of the expected
CSS files. CSS variables that are declared in javascript an unexpected CSS file
will not be found.

Exits with 0 if no variables are missing. Otherwise exits with 1.
"""

import re
import sys
from pathlib import Path

declare_dirs = [
    Path("browser/branding"),
    Path("browser/themes"),
    Path("toolkit/themes"),
]

var_dec_regex = re.compile(r"^\s*(?P<name>--[\w_-]+)\s*:")
var_use_regex = re.compile(r":.*(?P<name>--[\w_-]+)")


def remove_vars_in_file(var_set: set[str], file_path: Path) -> bool:
    """
    Checks the CSS file for declarations of the given variables and removes
    them.

    :param var_set: The set of CSS variables to check and remove.
    :param file_path: The path to a CSS file to check within.
    :returns: Whether the variable set is now empty.
    """
    with file_path.open() as file:
        for line in file:
            var_dec_match = var_dec_regex.match(line)
            if not var_dec_match:
                continue
            var_name = var_dec_match.group("name")
            if var_name in var_set:
                print(f"{var_name} declared in {file_path}", file=sys.stderr)
                var_set.remove(var_name)
                if not var_set:
                    return True
    return False


def find_missing(file_path: Path) -> set[str]:
    """
    Search for CSS variables in the CSS file and check whether any are missing
    known declarations.

    :param file_path: The path of the CSS file to check.
    :returns: The names of the missing variables.
    """
    used_vars: set[str] = set()

    with open(file_path) as file:
        for line in file:
            for match in var_use_regex.finditer(line):
                used_vars.add(match.group("name"))

    if not used_vars:
        print("No CSS variables found", file=sys.stderr)
        return used_vars

    # Remove any CSS variables that are declared within the same file.
    if remove_vars_in_file(used_vars, file_path):
        return used_vars

    # And remove any that are in the expected declaration files.
    for top_dir in declare_dirs:
        for css_file_path in top_dir.rglob("*.css"):
            if remove_vars_in_file(used_vars, css_file_path):
                return used_vars

    return used_vars


missing_vars = find_missing(Path(sys.argv[1]))
for var_name in missing_vars:
    print(var_name)

sys.exit(1 if missing_vars else 0)
