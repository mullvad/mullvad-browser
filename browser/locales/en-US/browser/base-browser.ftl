# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Language notification

# $language (String) - The language Tor Browser is displayed in (already translated).
language-notification-label-system = { -brand-short-name } has set your display language to { $language } based on your system’s language.
# This is shown when the system language is not supported, so we fall back to another language instead.
# $language (String) - The language Tor Browser is displayed in (already translated).
language-notification-label = { -brand-short-name } has set your display language to { $language }.
language-notification-button = Change Language…

## Fullscreen/maximization notification shown when letterboxing is disabled

basebrowser-rfp-maximize-warning-message = Maximizing the browser window can allow websites to determine your monitor size, which can be used to track you. We recommend that you leave browser windows in their original default size.
basebrowser-rfp-restore-window-size-button-label = Restore
basebrowser-rfp-restore-window-size-button-ak = R

## Tooltip for the about:addons recommended badge

basebrowser-addon-badge-recommended = Mozilla only recommends extensions that meet their standards for security and performance
basebrowser-addon-badge-verified = Mozilla has reviewed this extension to meet their standards for security and performance

## Option to show or hide the NoScript extension button/item.

basebrowser-addon-noscript-visibility-label = Toolbar button
basebrowser-addon-noscript-visibility-show = Show
basebrowser-addon-noscript-visibility-hide = Hide

## About dialog

# "Mozilla Firefox" should be treated like a brand and it should be neither translated nor transliterated.
# $version (String) - The current browser version. E.g. "12.5.3".
# $firefoxVersion (String) - The version number of Firefox the current browser is based on. E.g. "102.15.0esr".
basebrowser-about-dialog-version = { $version } (based on Mozilla Firefox { $firefoxVersion })

## New identity.

# File menu items use title case for English (US).
menu-new-identity =
    .label = New Identity
    .accesskey = I

# App menu (hamburger menu) items use sentence case for English (US).
appmenuitem-new-identity =
    .label = New identity

# Uses sentence case for English (US).
# ".label" is the accessible name, and is visible in the overflow menu and when
# customizing the toolbar.
# ".tooltiptext" will be identical to the label.
toolbar-new-identity =
    .label = New identity
    .tooltiptext = { toolbar-new-identity.label }

## New identity dialog.

new-identity-dialog-title = Reset your identity?
new-identity-dialog-description = { -brand-short-name } will close all windows and tabs. All website sessions will be lost.
new-identity-dialog-never-ask-checkbox =
    .label = Never ask me again
new-identity-dialog-confirm =
    .label = Restart { -brand-short-name }

## New identity: blocked home page notification.

# '-brand-short-name' is the localized browser name, like "Tor Browser".
# $url (String) - The URL of the home page, possibly shortened.
new-identity-blocked-home-notification = { -brand-short-name } blocked your homepage ({ $url }) from loading because it might recognize your previous session.
# Button to continue loading the home page, despite the warning message.
new-identity-blocked-home-ignore-button = Load it anyway
