# 🐞 Bug Report
<!--
Use this template to report problems with the browser which are unrelated to
website functionality (please use the Web Compatibility template for such issues).
The issue's title MUST provide a succinct description of the problem.

Some good (hypothetical) titles:
- Browser crashes when visiting example.com in Safer mode
- Letterboxing appears even when disabled when using tiling window-manager
- All fonts in browser-chrome have serifs

Please DO NOT include information about platform in the title, it is redundant
with our labeling system!
-->

## Reproduction steps
<!--
Provide specific steps developers can follow to reproduce your issue.
-->

## Expected behaviour
<!--
Provide a description of the browser feature or scenario which does not appear
to be working.
-->

## Actual behaviour
<!--
Provide a description of what actually occurs.
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

### Browser UI language
<!--
Found in `about:preferences#general`.
Feel free to omit this if you like, but sometimes bugs can be language specific so having
this info may make it easier for developers to reproduce your problem.
-->

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
/label ~"Apps::Type::Bug"
