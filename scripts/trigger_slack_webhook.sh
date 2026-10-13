#!/usr/bin/env bash

set -euo pipefail

error_var_unset() {
    echo "Environment variable \"$1\" needs to be set."
    echo "Exiting."
    exit 1
}

required_arguments=(VERSION WEBHOOK)
for argument in "${required_arguments[@]}"; do
    if [ -z "${!argument:-}" ]; then
        error_var_unset "$argument"
    fi
done

is_error() {
    if [ "$(echo "$1" | jq '.["ok"]')" = false ]; then
        return 0
    fi
    return 1
}

error_reason() {
    echo "$1" | jq '.["error"]'
}

url="https://dist.torproject.org/mullvadbrowser/$VERSION"

# send a message to a channel and tag the user in that message
update_response_commit_hash=$(
    curl 'https://gitlab.torproject.org/tpo/applications/mullvad-browser-update-responses/-/refs/main/logs_tree/?format=json&offset=0' 2>/dev/null |
        jq -r '.[0] | .commit .id'
)

payload=$(
    jq -n \
        --arg commit_hash "$update_response_commit_hash" \
        --arg version "$VERSION" \
        --arg url "$url" \
        --arg release_channel "${RELEASE_CHANNEL:-}" \
        '{
            update_response_commit: $commit_hash,
            version: $version,
            url: $url,
            release_channel: (if $release_channel then $release_channel else null end)
        }'
)

msg=$(
    curl -X POST --json "$payload" "$WEBHOOK"
)

if is_error "$msg"; then
    echo "Could not post message. Reason: $(error_reason "$msg")"
    exit 1
fi
