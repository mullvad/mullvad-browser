# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## About Mullvad browser dialog.

mullvad-about-desc = { -brand-short-name }  is a privacy-focused web browser developed in collaboration between <label data-l10n-name="mullvad-about-mullvadLink">Mullvad VPN</label> and the <label data-l10n-name="mullvad-about-torProjectLink">Tor Project</label>. It’s produced to minimize tracking and fingerprinting.
mullvad-about-readMore = Read more
# Variables
#   $emailAddress (String) - The email address of Mullvad's support
mullvad-about-feedback2 = Help & feedback: { $emailAddress }
mullvad-about-telemetryLink = Telemetry
mullvad-about-privacy-policy = Privacy Policy

## Mullvad browser home page.

about-mullvad-browser-developed-by = Developed in collaboration between the <a data-l10n-name="tor-project-link">Tor Project</a> and <a data-l10n-name="mullvad-vpn-link">Mullvad VPN</a>
about-mullvad-browser-use-vpn = Get more privacy by using the browser <a data-l10n-name="with-vpn-link">with Mullvad VPN</a>.
about-mullvad-browser-learn-more2 = Curious to learn more about the browser? <a data-l10n-name="learn-more-link">Read more on our website</a>.

# Update message.
# <a data-l10n-name="update-link"> should contain the link text and close with </a>.
# $version (String) - The new browser version.
about-mullvad-browser-update-message =  { -brand-short-name } has been updated to { $version }. <a data-l10n-name="update-link">See what’s new</a>

## Home preferences.

home-mode-choice-mullvad =
    .label = { -brand-product-name } Home

## about:telemetry page.

telemetry-title = Telemetry Information
telemetry-description = Telemetry is disabled in { -brand-short-name }.

## DNS over HTTPS settings customization.

mullvad-preferences-doh-overview-always-on =
    .label = Always on
    .description = Always use secure DNS.
mullvad-preferences-doh-overview-off =
    .label = Off
    .description = Use your default DNS resolver.
mullvad-preferences-doh-radio-always-on =
    .label = Always on
    .description = Always use secure DNS
mullvad-preferences-doh-radio-off =
    .label = Off (recommended when using a VPN)
    .description = Use your default DNS resolver

## DNS over HTTPS provider changed notification.

# The first sentence should be wrapped in '<strong>' and '</strong>'.
# "Mullvad" is an organization name.
mullvad-doh-notification-body = <strong>Your default DNS Over HTTPS settings have been changed.</strong> Mullvad secure DNS service is being discontinued.
mullvad-doh-notification-settings-button =
    .label = Review settings
