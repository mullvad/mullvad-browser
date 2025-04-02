# ⤵️ Rebase Stable

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
  - **Example**: `base-browser-102.8.0esr-12.0-1`
- `$(BASE_BROWSER_BRANCH_PREV)`: the full name of the previous `base-browser` branch
  - **Example**: `base-browser-102.7.0esr-12.0-1`
- `$(TOR_BROWSER_BRANCH)`: the full name of the current `tor-browser` branch
  - **Example**: `tor-browser-102.8.0esr-12.0-1`
- `$(TOR_BROWSER_BRANCH_PREV)`: the full name of the previous `tor-browser` branch
  - **Example**: `tor-browser-102.7.0esr-12.0-1`
</details>

### **Bookkeeping**

- [ ] Link this issue to the appropriate [Release Prep](https://gitlab.torproject.org/tpo/applications/tor-browser-build/-/issues/?sort=updated_desc&state=opened&label_name%5B%5D=Apps%3A%3AType%3A%3AReleasePreparation) issue.

### Update Branch Protection Rules

- [ ] In [Repository Settings](https://gitlab.torproject.org/tpo/applications/tor-browser/-/settings/repository):
  - [ ] Remove previous stable `base-browser` and `tor-browser` branch protection rules (this will prevent pushing new changes to the branches being rebased)
  - [ ] Create new `base-browser` and `tor-browser` branch protection rule:
    - **Branch**: `*-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1*`
      - **Example**: `*-102.8.0esr-12.0-1*`
    - **Allowed to merge**: `Maintainers`
    - **Allowed to push and merge**: `Maintainers`
    - **Allowed to force push**: `false`

### **Identify the Firefox Tagged Commit and Create New Branches**

- [ ] Find the Firefox mercurial tag here: https://hg.mozilla.org/releases/mozilla-esr102/tags
   - **Example**: `FIREFOX_102_8_0esr_BUILD1`
- [ ] Find the analogous `gecko-dev` commit: https://github.com/mozilla/gecko-dev
  - **Tip**: Search for unique string (like the Differential Revision ID) found in the mercurial commit in the `gecko-dev/esr102` branch to find the equivalent commit
  - **Example**: `3a3a96c9eedd02296d6652dd50314fccbc5c4845`
- [ ] Sign and Tag `gecko-dev` commit
  - Sign/Tag `gecko-dev` commit :
    - **Tag**: `$(ESR_TAG)`
    - **Message**: `Hg tag $(ESR_TAG)`
- [ ] Create new stable `base-browser` branch from tag
  - Branch name in the form: `base-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1`
  - **Example**: `base-browser-102.8.0esr-12.0-1`
- [ ] Create new stable `tor-browser` branch from
  - Branch name in the form: `tor-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1`
  - **Example**: `tor-browser-102.8.0esr-12.0-1`
- [ ] Push new `base-browser` branch to `upstream`
- [ ] Push new `tor-browser` branch to `upstream`
- [ ] Push new `$(ESR_TAG)` to `upstream`

### **Rebase tor-browser**

- [ ] Checkout a new local branch for the `tor-browser` rebase
  - **Example**: `git branch tor-browser-rebase FIREFOX_102_8_0esr_BUILD1`
- [ ] **(Optional)** `base-browser` rebase
  - **NOTE** This step may be skipped if the `HEAD` of the previous `base-browser` branch is a `-buildN` tag
  - [ ] Cherry-pick the previous `base-browser` commits up to `base-browser`'s `buildN` tag onto new `base-browser` rebase branch
    - **Example**: `git cherry-pick FIREFOX_102_7_0esr_BUILD1..base-browser-102.7.0esr-12.0-1-build1`
  - [ ] Rebase and autosquash these cherry-picked commits
    - **Example**: `git rebase --autosquash --interactive FIREFOX_102_8_0esr_BUILD1 HEAD`
  - [ ] Cherry-pick remainder of patches after the `buildN` tag
    - **Example**: `git cherry-pick base-browser-102.7.0esr-12.0-1-build1..upstream/base-browser-102.7.0esr-12.0-1`
- [ ] `tor-browser` rebase
  - [ ] Note the current git hash of `HEAD` for `tor-browser` rebase+autosquash step: `git rev-parse HEAD`
  - [ ] Cherry-pick the appropriate previous `tor-browser` branch's commit range up to the last `tor-browser` `buildN` tag
    - **Example**: `git cherry-pick base-browser-102.7.0esr-12.0-1-build1..tor-browser-102.7.0esr-12.0-1-build1`
    - **Example (if separate base-browser rebase was skipped)**: `git cherry-pick FIREFOX_102_7_0esr_BUILD1..tor-browser-102.7.0esr-12.0-1-build1`
  - [ ] Rebase and autosquash these newly cherry-picked commits: `git rebase --autosquash --interactive $(PREV_HEAD)`
     - **Example**: `git rebase --autosquash --interactive FIREFOX_102_8_0esr_RELEASE`
  - [ ] Cherry-pick remainder of patches after the last `tor-browser` `buildN` tag
    - **Example**: `git cherry-pick tor-browser-102.7.0esr-12.0-1-build1..upstream/tor-browser-102.7.0esr-12.0-1`
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
    - **Example**: `git range-dif FIREFOX_102_7_0esr_BUILD1..upstream/tor-browser-102.7.0esr-12.0-1 FIREFOX_102_8_0esr_BUILD1..HEAD`
- [ ] Open MR for the `tor-browser` rebase
- [ ] Merge
- Update and push `base-browser` branch
  - [ ] Reset the new `base-browser` branch to the appropriate commit in this new `tor-browser` branch
  - [ ] Push these commits to `upstream`

### **Sign and Tag**

- [ ] Sign/Tag `HEAD` of the merged `tor-browser` branch:
  - In **tor-browser.git**, checkout the new stable `tor-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.torbrowser stable build1
    ```
  - [ ] Push tag to `upstream`
- [ ] Sign/Tag HEAD of the merged `base-browser` branch:
  - In **tor-browser.git**, checkout the new stable `base-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.basebrowser stable build1
    ```
  - [ ] Push tag to `upstream`

<!-- Do not edit beneath this line <3 -->

---

/label ~"Apps::Product::TorBrowser"
/label ~"Apps::Type::Rebase"
/label ~"Apps::Priority::Blocker"
