#! /bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

MOZ_APP_VENDOR=Mullvad

BROWSER_CHROME_URL=chrome://browser/content/browser.xhtml

# MOZ_APP_DISPLAYNAME will be set by branding/configure.sh
# MOZ_BRANDING_DIRECTORY is the default branding directory used when none is
# specified. It should never point to the "official" branding directory.
# For mozilla-beta, mozilla-release, or mozilla-central repositories, use
# "unofficial" branding.
# For the mozilla-aurora repository, use "aurora".
MOZ_BRANDING_DIRECTORY=browser/branding/unofficial
MOZ_OFFICIAL_BRANDING_DIRECTORY=browser/branding/official
MOZ_APP_ID={ec8030f7-c20a-464f-9b0e-13a3a9e97384}

# tor-browser#41577: Do not enable profile migration
# MOZ_PROFILE_MIGRATOR=1

# ACCEPTED_MAR_CHANNEL_IDS should usually be the same as the value MAR_CHANNEL_ID.
# If more than one ID is needed, then you should use a comma separated list
# of values.
# The MAR_CHANNEL_ID must not contain the following 3 characters: ",\t "
if test "$MOZ_UPDATE_CHANNEL" = "alpha"; then
  ACCEPTED_MAR_CHANNEL_IDS=mullvadbrowser-mullvad-alpha
  MAR_CHANNEL_ID=mullvadbrowser-mullvad-alpha
elif test "$MOZ_UPDATE_CHANNEL" = "nightly"; then
  ACCEPTED_MAR_CHANNEL_IDS=mullvadbrowser-mullvad-nightly
  MAR_CHANNEL_ID=mullvadbrowser-mullvad-nightly
else
  ACCEPTED_MAR_CHANNEL_IDS=mullvadbrowser-mullvad-release
  MAR_CHANNEL_ID=mullvadbrowser-mullvad-release
fi

# Include the DevTools client, not just the server (which is the default)
MOZ_DEVTOOLS=all
