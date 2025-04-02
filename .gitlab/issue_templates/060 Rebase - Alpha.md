# ⤵️ Rebase Alpha

**NOTE:** All examples in this template reference the rebase from 102.7.0esr to 102.8.0esr

<details>
  <summary>Explanation of Variables</summary>

- `$(ESR_VERSION)`: the Mozilla defined ESR version, used in various places for building tor-browser tags, labels, etc
  - **Example**: `102.8.0`
- `$(ESR_TAG)`: the Mozilla defined hg (Mercurial) tag associated with `$(ESR_VERSION)`
  - **Example**: `FIREFOX_102_8_0esr_RELEASE`
- `$(ESR_TAG_PREV)`: the Mozilla defined hg (Mercurial) tag associated with the previous ESR version when rebasing (ie, the ESR version we are rebasing from)
  - **Example**: `FIREFOX_102_7_0esr_BUILD1`
- `$(BROWSER_MAJOR)`: the browser major version
  - **Example**: `12`
- `$(BROWSER_MINOR)`: the browser minor version
  - **Example**: either `0` or `5`; Alpha's is always `(Stable + 5) % 10`
- `$(BASE_BROWSER_BRANCH)`: the full name of the current `base-browser` branch
  - **Example**: `base-browser-102.8.0esr-12.5-1`
- `$(BASE_BROWSER_BRANCH_PREV)`: the full name of the previous `base-browser` branch
  - **Example**: `base-browser-102.7.0esr-12.5-1`
- `$(TOR_BROWSER_BRANCH)`: the full name of the current `tor-browser` branch
  - **Example**: `tor-browser-102.8.0esr-12.5-1`
- `$(TOR_BROWSER_BRANCH_PREV)`: the full name of the previous `tor-browser` branch
  - **Example**: `tor-browser-102.7.0esr-12.5-1`
</details>

**NOTE:** It is assumed that we've already identified the new ESR branch during the tor-browser stable rebase

### **Bookkeeping**

- [ ] Link this issue to the appropriate [Release Prep](https://gitlab.torproject.org/tpo/applications/tor-browser-build/-/issues/?sort=updated_desc&state=opened&label_name%5B%5D=Apps%3A%3AType%3A%3AReleasePreparation) issue.

### Update Branch Protection Rules

- [ ] In [Repository Settings](https://gitlab.torproject.org/tpo/applications/tor-browser/-/settings/repository):
  - [ ] Remove previous alpha `base-browser` and `tor-browser` branch protection rules (this will prevent pushing new changes to the branches being rebased)
  - [ ] Create new `base-browser` and `tor-browser` branch protection rule:
    - **Branch**: `*-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1*`
      - **Example**: `*-102.8.0esr-12.5-1*`
    - **Allowed to merge**: `Maintainers`
    - **Allowed to push and merge**: `Maintainers`
    - **Allowed to force push**: `false`
    - If you copied and pasted from old rules, double check you didn't add spaces at the end, as GitLab will not trim them!

### **Create New Branches**

- [ ] Find the Firefox mercurial tag `$(ESR_TAG)`
  - If `$(BROWSER_MINOR)` is 5, the tag should already exist from the stable release
  - Otherwise:
    - [ ] Go to `https://hg.mozilla.org/releases/mozilla-esr$(ESR_MAJOR)/tags`
    - [ ] Find and inspect the commit tagged with `$(ESR_TAG)`
      - Tags are in yellow in the Mercurial web UI
    - [ ] Find the equivalent commit in `https://github.com/mozilla/gecko-dev/commits/esr$(ESR_MAJOR)`
      - The tag should be very close to `HEAD` (usually the second, before a `No bug - Tagging $(HG_HASH) with $(ESR_TAG)`)
      - **Notice**: GitHub sorts commits by time, you might want to use `git log gecko-dev/esr$(ESR_MAJOR)` locally, instead
    - [ ] Sign/Tag the `gecko-dev` commit: `git tag -as $(ESR_TAG) $(GIT_HASH) -m "Hg tag $(ESR_TAG)"`
- [ ] Create new alpha `base-browser` branch from Firefox mercurial tag
  - Branch name in the form: `base-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1`
  - **Example**: `base-browser-102.8.0esr-12.5-1`
- [ ] Create new alpha `tor-browser` branch from Firefox mercurial tag
  - Branch name in the form: `tor-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1`
  - **Example**: `tor-browser-102.8.0esr-12.5-1`
- [ ] Push new `base-browser` branch to `upstream`
- [ ] Push new `tor-browser` branch to `upstream`

### **Rebase tor-browser**

- [ ] Checkout a new local branch for the `tor-browser` rebase
  - **Example**: `git branch tor-browser-rebase FIREFOX_102_8_0esr_BUILD1`
- [ ] **(Optional)** `base-browser` rebase and autosquash
  - **NOTE** This step may be skipped if the `HEAD` of the previous `base-browser` branch is a `-buildN` tag
  - [ ] Cherry-pick the previous `base-browser` commits up to `base-browser`'s `buildN` tag onto new `base-browser` rebase branch
    - **Example**: `git cherry-pick FIREFOX_102_7_0esr_BUILD1..base-browser-102.7.0esr-12.5-1-build1`
  - [ ] Rebase and autosquash these cherry-picked commits
    - **Example**: `git rebase --autosquash --interactive FIREFOX_102_8_0esr_BUILD1 HEAD`
  - [ ] Cherry-pick remainder of patches after the `buildN` tag
    - **Example**: `git cherry-pick base-browser-102.7.0esr-12.5-1-build1..upstream/base-browser-102.7.0esr-12.5-1`

- [ ] `tor-browser` rebase and autosquash
  - [ ] Note the current git hash of `HEAD` for `tor-browser` rebase+autosquash step: `git rev-parse HEAD`
  - [ ] Cherry-pick the appropriate previous `tor-browser` branch's commit range up to the last `tor-browser` `buildN` tag
    - **Example**: `git cherry-pick base-browser-102.7.0esr-12.5-1-build1..tor-browser-102.7.0esr-12.5-1-build1`
    - **Example (if separate base-browser rebase was skipped)**: `git cherry-pick FIREFOX_102_7_0esr_BUILD1..tor-browser-102.7.0esr-12.5-1-build1`
  - [ ] Rebase and autosquash  **ONLY** these newly cherry-picked commits using the commit noted previously: `git rebase --autosquash --interactive $(PREV_HEAD)`
     - **Example**: `git rebase --autosquash --interactive FIREFOX_102_8_0esr_RELEASE`
  - [ ] **(Optional)** Patch reordering
    - **NOTE**: We typically want to do this after new features or bug fix commits which are not !fixups to an existing commit have been merged and are just sitting at the end of the commit history
    - Relocate new `base-browser` patches in the patch-set to enforce this rough thematic ordering:
      - **MOZILLA BACKPORTS** - official Firefox patches we have backported to our ESR branch: Android-specific security updates, critical bug fixes, worthwhile features, etc
      - **MOZILLA REVERTS** - revert commits of official Firefox patches
      - **UPLIFT CANDIDATES** - patches which stand on their own and should be uplifted to `mozilla-central`
      - **BUILD CONFIGURATION** - tools/scripts, gitlab templates, etc
      - **BROWSER CONFIGURATION** - branding, mozconfigs, preference overrides, etc
      - **SECURITY PATCHES** - security improvements, hardening, etc
      - **PRIVACY PATCHES** - fingerprinting, linkability, proxy bypass, etc
      - **FEATURES** - new functionality: updater, UX, letterboxing, security level, add-on
    - Relocate new `tor-browser` patches in the patch-set to enforce this rough thematic ordering:
      - **BUILD CONFIGURATION** - tools/scripts, gitlab templates, etc
      - **BROWSER CONFIGURATION** - branding, mozconfigs, preference overrides, etc
      - **UPDATER PATCHES** - updater tweaks, signing keys, etc
      - **SECURITY PATCHES** - non tor-dependent security improvements, hardening, etc
      - **PRIVACY PATCHES** - non tor-dependent fingerprinting, linkability, proxy bypass, etc
      - **FEAURES** - non tor-dependent features
      - **TOR INTEGRATION** - legacy tor-launcher/torbutton, tor modules, bootstrapping, etc
      - **TOR SECURITY PATCHES** - tor-specific security improvements
      - **TOR PRIVACY PATCHES** - tor-specific privacy improvements
      - **TOR FEATURES** - new tor-specific functionality: manual, onion-location, onion service client auth, etc
  - [ ] Cherry-pick remainder of patches after the last `tor-browser` `buildN` tag
    - **Example**: `git cherry-pick tor-browser-102.7.0esr-12.5-1-build1..upstream/tor-browser-102.7.0esr-12.5-1`
  - [ ] Rebase and autosquash again, this time replacing all `fixup` and `squash` commands with `pick`. The goal here is to have all of the `fixup` and `squash` commits beside the commit which they modify, but kept un-squashed for easy debugging/bisecting.
    - **Example**: `git rebase --autosquash --interactive FIREFOX_102_8_0esr_RELEASE`
- [ ] Compare patch sets to ensure nothing *weird* happened during conflict resolution:
  - [ ] diff of diffs:
    -  Do the diff between `current_patchset.diff` and `rebased_patchset.diff` with your preferred difftool and look at differences on lines that starts with + or -
    - `git diff $(ESR_TAG_PREV)..$(BROWSER_BRANCH_PREV) > current_patchset.diff`
    - `git diff $(ESR_TAG)..$(BROWSER_BRANCH) > rebased_patchset.diff`
    - diff `current_patchset.diff` and `rebased_patchset.diff`
      - If everything went correctly, the only lines which should differ should be the lines starting with `index abc123...def456` (unless the previous `base-browser` branch includes changes not included in the previous `tor-browser` branch)
  - [ ] rangediff: `git range-diff $(ESR_TAG_PREV)..$(TOR_BROWSER_BRANCH_PREV) $(ESR_TAG)..HEAD`
    - **Example**: `git range-dif FIREFOX_102_7_0esr_BUILD1..upstream/tor-browser-102.7.0esr-12.5-1 FIREFOX_102_8_0esr_BUILD1..HEAD`
- [ ] Open MR for the `tor-browser` rebase
- [ ] Merge
- Update and push `base-browser` branch
  - [ ] Reset the new `base-browser` branch to the appropriate commit in this new `tor-browser` branch
  - [ ] Push these commits to `upstream`
- [ ] Set `$(TOR_BROWSER_BRANCH)` as the default GitLab branch
  - [ ] Go to [Repository Settings](https://gitlab.torproject.org/tpo/applications/tor-browser/-/settings/repository)
  - [ ] Expand `Branch defaults`
  - [ ] Set the branch and leave the `Auto-close` checkbox unchecked
  - [ ] Save changes

### **Sign and Tag**

- [ ] Sign/Tag `HEAD` of the merged `tor-browser` branch:
  - In **tor-browser.git**, checkout the new alpha `tor-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.torbrowser alpha build1
    ```
  - [ ] Push tag to `upstream`
- [ ] Sign/Tag HEAD of the merged `base-browser` branch:
  - In **tor-browser.git**, checkout the new alpha `base-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.basebrowser alpha build1
    ```
  - [ ] Push tag to `upstream`
- [ ] Update tor-browser-build's `main` branch (no MR required, you can just push it if you have the permissions)
  - [ ] Update `projects/firefox/config`
    - [ ] Update `firefox_platform_version`
    - [ ] Set `browser_build` to 1 (to prevent failures in alpha testbuilds)
  - [ ] Update `projects/geckoview/config`
    - [ ] Update `firefox_platform_version`
    - [ ] Set `browser_build` to 1 (to prevent failures in alpha testbuilds)

<!-- Do not edit beneath this line <3 -->

---

/label ~"Apps::Product::TorBrowser"
/label ~"Apps::Type::Rebase"
/label ~"Apps::Priority::Blocker"
