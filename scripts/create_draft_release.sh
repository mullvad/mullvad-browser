#!/usr/bin/env bash

set -e

error_var_unset() {
    echo "Environment variable \"$1\" needs to be set."
    echo "Exiting."
    exit 1
}

required_arguments=( GITHUB_TOKEN VERSION )
for argument in "${required_arguments[@]}"; do
    if [ -z "${!argument}" ]; then
        error_var_unset "$argument"
    fi
done


### Get the latest tag associated with VERSION from Tor repo
tags=$(curl https://gitlab.torproject.org/api/v4/projects/473/repository/tags?search=^mb-"$VERSION" | jq '.[].name' | tr -d \")

# Copy end number to front temporarily, sort by numeric value, then remove it
# This avoids string4 coming after string20
latest_tag=$(echo "$tags"  | sed -E 's/(.*[^0-9])([0-9]+)$/\2 \1\2/' | sort -n | cut -d' ' -f2- | tail -n1)

echo "[INFO] Tags related to $VERSION:"
while IFS= read -r tag; do
  echo "[INFO] $tag"
done <<< "$tags"

echo "[INFO] Using documentation from tag: $latest_tag"

### Get the changelog from above tag
git clone --branch "$latest_tag" --depth=1 https://gitlab.torproject.org/tpo/applications/tor-browser-build.git

# Create the changelog in 3 steps:
# 1. Just keep the first paragraph of the file, which concerns the latest
# release (of the commit)
# 2. Remove the first line: "Mullvad Browser <version> - <date>"
# 3. Change the line ' * Build System' into '## Build System' for a markdown
# heading 2
changelog=$(grep -B 1000 -m1 '^$' ./tor-browser-build/ChangeLog-MB.txt | sed -e '1d' -e 's/^\s*\* Build System\s*$/## Build System/')

payload=$(jq -n \
  --arg tag_name "$VERSION" \
  --arg name "$VERSION" \
  --arg body "$changelog" \
  --argjson draft true \
  --argjson prerelease false \
  --argjson generate_release_notes false \
  '{
    tag_name: $tag_name,
    name: $name,
    body: $body,
    draft: $draft,
    prerelease: $prerelease,
    generate_release_notes: $generate_release_notes
  }')

curl -L \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/mullvad/mullvad-browser/releases \
  -d "$payload"
