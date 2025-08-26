import re
from urllib.request import Request, urlopen


def list_files_http(url):
    try:
        req = Request(url, method="GET")
        with urlopen(req) as response:
            if response.status != 200:
                return []
            html = response.read().decode()
    except Exception:
        return []

    links = []
    for href in re.findall(r'<a href="([^"]+)"', html):
        if href == "../":
            continue

        links.append(href)

    return links


TOR_BROWSER_BUILD_ARTIFACTS = [
    # Tor Browser Build-only artifacts, these artifacts are not common with Firefox.
    "noscript",
    "fonts",
]

# Mapping of artifacts from taskcluster to tor-browser-build.
ARTIFACT_NAME_MAP = {
    "cbindgen": "cbindgen",
    # FIXME (tor-browser-build#41471): nasm is more or less ready to go, but it needs to have the
    # executable in the root of the artifact folder instead of nasm/bin.
    # "nasm": "nasm",
    # FIXME (tor-browser-build#41421): the clang project as is, is not ready to use. It needs
    # to be repackaged with a bunch of things that differ per platform. Fun stuff.
    # "clang": "clang",
    "node": "node",
}


def get_artifact_name(original_artifact_name, host):
    # These are not build artifacts, they are pre-built artifacts to be added to the final build,
    # therefore this check can come before the host check.
    if original_artifact_name in TOR_BROWSER_BUILD_ARTIFACTS:
        return original_artifact_name

    if host != "linux64":
        # Tor browser build only has development artifacts for linux64 host systems.
        return None

    return ARTIFACT_NAME_MAP.get(original_artifact_name)


def get_artifact_path(url, artifact, target, prefix=""):
    if prefix:
        path = prefix
    else:
        path = artifact

    # The `?C=M;O=D` parameters make it so links are ordered by
    # the last modified date. This here to make us get the latest
    # version of file in the case there are multiple and we just
    # grab the first one.
    files = list_files_http(f"{url}/{path}?C=M;O=D")

    if not files:
        return None

    def filter_files(files, keyword):
        return [file for file in files if keyword in file]

    artifact_files = [file for file in files if file.startswith(artifact)]

    if len(artifact_files) == 1:
        return f"{url}/{path}/{artifact_files[0]}"

    files_per_os = filter_files(artifact_files, target.tor_browser_build_alias)

    # If there are files in the folder, but they don't have the OS in the name
    # it probably means we can get any of them because they can be used to build
    # for any OS. So let's just get the first one.
    #
    # Note: It could be the case that the artifact _is_ OS dependant, but there
    # just are no files for the OS we are looking for. In that case, this will
    # return an incorrect artifact. This should not happen often though and is
    # something we cannot address until artifact names are standardized on tbb.
    if len(files_per_os) == 0:
        return f"{url}/{artifact}/{artifact_files[0]}"

    elif len(files_per_os) == 1:
        return f"{url}/{artifact}/{files_per_os[0]}"

    matches = filter_files(files_per_os, target.cpu)

    return f"{url}/{artifact}/{matches[0]}" if matches else None
