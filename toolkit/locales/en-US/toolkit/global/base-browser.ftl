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

## Letterboxing size indicator.

# Shows the current tab's Letterboxing dimensions in the bottom corner when resizing the window.
# The word "Letterboxing" is the proper noun for the Tor Browser feature, and is therefore capitalised.
# "Letterboxing" should be treated as a feature/product name, and likely not changed in other languages.
# The "×" symbol is a unicode (U+00D7) symbol for multiply.
# $width (Number) - The window width. The "NUMBER" function will format this number to the same locale, and the "useGrouping" option will remove grouping symbols, like thousand separators.
# $height (Number) - The window height.
letterboxing-size-status = Letterboxing size: { NUMBER($width, useGrouping: "false") } × { NUMBER($height, useGrouping: "false") }

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

## New identity: blocked home page notification.

# '-brand-short-name' is the localized browser name, like "Tor Browser".
# $url (String) - The URL of the home page, possibly shortened.
new-identity-blocked-home-notification = { -brand-short-name } blocked your homepage ({ $url }) from loading because it might recognize your previous session.
# Button to continue loading the home page, despite the warning message.
new-identity-blocked-home-ignore-button = Load it anyway

## Preferences - Letterboxing.

# The word "Letterboxing" is the proper noun for the Tor Browser feature, and is therefore capitalised.
# "Letterboxing" should be treated as a feature/product name, and likely not changed in other languages.
letterboxing-header = Letterboxing
# The word "Letterboxing" is the proper noun for the Tor Browser feature, and is therefore capitalised.
# "Letterboxing" should be treated as a feature/product name, and likely not changed in other languages.
letterboxing-overview = { -brand-short-name }'s Letterboxing feature restricts websites to display at specific sizes, making it harder to single out users on the basis of their window or screen size.
letterboxing-learn-more = Learn more
letterboxing-window-size-header = Window size
letterboxing-remember-size =
    .label = Reuse last window size when opening a new window
    .accesskey = R
letterboxing-alignment-header = Content alignment
letterboxing-alignment-description = Choose where you want to align the website’s content.
letterboxing-alignment-top = Top
letterboxing-alignment-middle = Middle
# The word "Letterboxing" is the proper noun for the Tor Browser feature, and is therefore capitalised.
# "Letterboxing" should be treated as a feature/product name, and likely not changed in other languages.
letterboxing-disabled-description = Letterboxing is currently disabled.
# The word "Letterboxing" is the proper noun for the Tor Browser feature, and is therefore capitalised.
# "Letterboxing" should be treated as a feature/product name, and likely not changed in other languages.
letterboxing-enable-button =
    .label = Enable Letterboxing

## Security level toolbar button.
## Uses sentence case in English (US).
## ".label" is the accessible name, and shown in the overflow menu and when customizing the toolbar.

security-level-toolbar-button-standard =
    .label = Security level
    .tooltiptext = Security level: Standard
security-level-toolbar-button-safer =
    .label = Security level
    .tooltiptext = Security level: Safer
security-level-toolbar-button-safest =
    .label = Security level
    .tooltiptext = Security level: Safest
# Used when the user is in some custom configuration that does not match a security level.
security-level-toolbar-button-custom =
    .label = Security level
    .tooltiptext = Security level: Custom

## Security level popup panel.

# Uses sentence case in English (US).
security-level-panel-heading = Security level
security-level-panel-learn-more-link = Learn more
# Button to open security level settings.
security-level-panel-open-settings-button = Settings…

## Security level settings.

security-level-preferences-heading = Security Level
security-level-preferences-overview = Disable certain web features that can be used to attack your security and anonymity.
security-level-preferences-learn-more-link = Learn more
# Text for a badge that labels the currently active security level.
# The text in between '<span>' and '</span>' should contain some kind of bracket, like '(' and ')', or other punctuation used in your language to separate out text from its surrounding context. This will not be visible, but will be use for screen readers to make it clear that the text is not part of the same sentence. For example, in US English this would be read as "(Current level)", and the full line of text would be read as "Safest (Current level)".
security-level-preferences-current-badge = <span>(</span>Current level<span>)</span>
security-level-preferences-change-button = Change…

## Security level settings dialog.

security-level-dialog-window =
    .title = Change security level

# '-brand-short-name' is the localized browser name, like "Tor Browser".
security-level-dialog-restart-description = You will need to restart { -brand-short-name } to apply any changes. This will close all windows and tabs.

security-level-preferences-level-standard =
    .label = Standard
security-level-preferences-level-safer =
    .label = Safer
security-level-preferences-level-safest =
    .label = Safest

security-level-dialog-save-restart =
    .label = Save and restart

## Security level names shown in the security panel and settings.

security-level-panel-level-standard = Standard
security-level-panel-level-safer = Safer
security-level-panel-level-safest = Safest
security-level-panel-level-custom = Custom

## Security level summaries shown in security panel and settings.

security-level-summary-standard = All browser and website features are enabled.
security-level-summary-safer = Disables website features that are often dangerous, causing some sites to lose functionality.
security-level-summary-safest = Only allows website features required for static sites and basic services. These changes affect images, media, and scripts.

## Security level feature bullet points.
## Shown in the settings under the security level when it is selected.

security-level-preferences-bullet-https-only-javascript = JavaScript is disabled on non-HTTPS sites.
security-level-preferences-bullet-limit-font-and-symbols = Some fonts and math symbols are disabled.
security-level-preferences-bullet-limit-media = Audio and video (HTML5 media), and WebGL are click-to-play.
security-level-preferences-bullet-disabled-javascript = JavaScript is disabled by default on all sites.
security-level-preferences-bullet-limit-font-and-symbols-and-images = Some fonts, icons, math symbols, and images are disabled.

## Security level dialog warning the user about a restart.

# '-brand-short-name' is the localized browser name, like "Tor Browser".
security-level-restart-warning-dialog-title = Restart { -brand-short-name } to apply changes?
# '-brand-short-name' is the localized browser name, like "Tor Browser".
security-level-restart-warning-dialog-body = { -brand-short-name } needs to restart to apply your changes. This will close all your windows and tabs.

## Custom security level.
## Some custom preferences configuration has placed the user outside one of the standard three levels.

# Description of custom state and recommended action.
# Shown in the security level panel and settings.
security-level-summary-custom = Your custom browser preferences have resulted in unusual security settings. For security and privacy reasons, we recommend you choose one of the default security levels.

## Security level restart prompt.

security-level-restart-prompt-title = Your security level settings require a restart
security-level-restart-prompt-body = You must restart { -brand-short-name } for your security level settings to be applied. This will close all your windows and tabs.
security-level-restart-prompt-button-ignore = Ignore

## Part of the restart dialogs for security level and new identity.

# Checkbox to never show the restart warning dialog again.
restart-warning-dialog-do-not-warn-checkbox = Don’t show this warning again
# Button to restart the browser.
# '-brand-short-name' is the localized browser name, like "Tor Browser".
restart-warning-dialog-restart-button = Restart { -brand-short-name }
