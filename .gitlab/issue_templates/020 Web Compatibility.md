# 🌍 Web Compatibility
<!--
Use this template to report websites which do not work properly in the browser.
The issue's title MUST provide a succinct description of the problem.

Some good (hypothetical) titles:
- Road signs do not render correctly on maps.foo.com
- Infinite CAPTCHA prompts on bar.nat
- Cannot login to baz.org
-->

## URL
<!-- Provide a link to the website -->

## Expected behaviour
<!--
Provide a description of the how the website is supposed to work
-->

## Actual behaviour
<!--
Provide a description of what actually occurs
-->

## Reproduction steps
<!--
Provide specific steps developers can follow to reproduce your issue
-->

## Bookkeeping
<!--
Please provide the following information:
-->

- Browser version:
- Browser channel:
  - [ ] Release
  - [ ] Alpha
  - [ ] Nightly
- Distribution method:
  - [ ] Installer/archive from mullvad.net
  - [ ] homebrew
  - [ ] other (please specify):
- Operating System:
  - [ ] Windows
  - [ ] macOS
  - [ ] Linux
  - [ ] Other (please specify):
- Operating System Version:

### Have you modified any of the settings in `about:preferences` or `about:config`? If yes, which ones?
<!--
If you changed any preference in about:config that aren't exposed in a UI,
could you try to see if you can reproduce without them? Generally speaking, such
changes are unsupported and bugs might be closed as invalid.
-->

### Do you have any extra extensions installed?
<!-- e.g. Firefox Multi-Account Containers, uBlock Origin, etc -->

## Troubleshooting
<!--
This is optional, but it will help to resolve your problem.
-->

### Does this bug occur in a fresh installation?

### Is this bug new? If it is a regression, in which version of the browser did this bug first appear?
<!--
Archived packages for past versions can be found here:
- https://archive.torproject.org/tor-package-archive
-->

### Does this bug occur in the Alpha release channel?
<!--
Sometimes bugs are fixed in the Alpha (development) channel but not in the Stable channel.
⚠️ However, the Alpha release channel is the development version and as such may be contain
critical bugs not present in the Stable release channel.

The latest Alpha can be found here:
- https://github.com/mullvad/mullvad-browser/releases?q=prerelease%3Atrue
-->

### Does this bug occur in Firefox ESR (Desktop only)?
<!--
Tor Browser is based on Firefox ESR, so any bugs present in this upstream project will likely
also be present in Tor Browser.
Firefox ESR is available for download here:
- https://www.mozilla.org/en-US/firefox/all/desktop-esr/
-->

### Does this bug occur in Firefox Rapid Release?
<!--
If the issue occurs in Firefox ESR, but does not occur in Firefox Rapid Release, we may be able
to identify and backport the patch which fixes it.

Firefox Rapid Release is available for download here:
- https://www.mozilla.org/en-US/firefox/new/

If the issue has been fixed in Firefox, do you know the Bugzilla issue number associated with the fix?
-->

<!-- Do not edit beneath this line <3 -->

---

/label ~"Apps::Product::MullvadBrowser"
/label ~"Apps::Type::WebCompatibility"
