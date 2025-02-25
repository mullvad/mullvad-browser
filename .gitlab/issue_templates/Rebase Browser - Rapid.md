**NOTE**: All examples in this template reference the rebase from Firefox 129.0a1 to 130.0a1, see the tor-browser `Rebase Browser - Rapid.md` template for further info

<details>
  <summary>Explanation of Variables</summary>

- `$(NIGHTLY_VERSION)`: the Mozilla defined nightly version, used in various places for building tor-browser tags, labels, etc
  - **Example**: `130.0a1`
- `$(NIGHTLY_TAG)`: the Mozilla defined hg (Mercurial) tag associated with `$(NIGHTLY_VERSION)`
  - **Example**: `FIREFOX_NIGHTLY_130_END`
- `$(NIGHTLY_TAG_PREV)`: the Mozilla defined hg (Mercurial) tag associated with the previous nightly version when rebasing (ie, the nightly version we are rebasing from)
  - **Example**: `FIREFOX_NIGHTLY_129_END`
- `$(BROWSER_VERSION)`: the browser version which will first be based on the next major ESR version this *Firefox* Nightly series is leading up to
  - **Example**: `15`
- `$(BASE_BROWSER_BRANCH)`: the full name of the current `base-browser` branch based off of the Firefox Nightly channel
  - **Example**: `base-browser-130.0a1-15.0-2`
- `$(BASE_BROWSER_BRANCH_TAG)`: the `base-browser` build tag used as base commit for `mullvad-browser`
  - **Example**: `base-browser-130.0a1-15.0-2-build1`
- `$(BASE_BROWSER_BRANCH_PREV)`: the full name of the previous `base-browser` branch based off of the Firefox Nightly channel
  - **Example**: `base-browser-129.0a1-15.0-2`
- `$(BASE_BROWSER_BRANCH_PREV_TAG)`: the `base-browser` build tag used as base commit for the previous `mullvad-browser`
  - **Example**: `base-browser-129.0a1-15.0-2-build1`
- `$(MULLVAD_BROWSER_BRANCH)`: the full name of the current `mullvad-browser` branch
  - **Example**: `mullvad-browser-130.0a1-15.0-2`
- `$(MULLVAD_BROWSER_BRANCH_PREV)`: the full name of the previous `mullvad-browser` branch
  - **Example**: `mullvad-browser-129.0a1-15.0-2`
</details>

**NOTE**: It is presuemd the equivalent Tor Browser rapid-release rebase has been completed, as this rebase depends on a rebased `base-browser` branch

### Update Branch Protection Rules

- [ ] In [Repository Settings](https://gitlab.torproject.org/tpo/applications/mullvad-browser/-/settings/repository):
  - [ ] Remove previous nightly `mullvad-browser` branch protection rules (this will prevent pushing new changes to the branches being rebased)
  - [ ] Create new `mullvad-browser` branch protection rule:
    - **Branch**: `mullvad-browser-$(NIGHTLY_VERSION)-$(BROWSER_VERSION)-*`
      - **Example**: `mullvad-browser-130.0a1-15.0-*`
    - **Allowed to merge**: `Maintainers`
    - **Allowed to push and merge**: `Maintainers`
    - **Allowed to force push**: `false`
    - ⚠️ **IMPORTANT**: If you copied and pasted from old rules, double check you didn't add spaces at the end, as GitLab will not trim them!

### **Create and Push New Branch**

- [ ] Create new alpha `mullvad-browser` branch from this ESR's rapid `base-browser` tag
  - Branch name in the form: `mullvad-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1`
  - **Example**: `git branch mullvad-browser-130.0a1-15.0-2 base-browser-130.0a1-15.0-2-build1`
- [ ] Push new `mullvad-browser` branch to `upstream`
- [ ] Push the `base-browser` tag to `upstream`

### **Rebase mullvad-browser**

- [ ] Checkout a new local branch for the `mullvad-browser` rebase
  - **Example**: `git branch mullvad-browser-rebase upstream/mullvad-browser-130.0a1-15.0-2`
- [ ] `mullvad-browser` rebase
  - [ ] Cherry-pick the previous `mullvad-browser` rapid branch's commit range
    - **Example**: `git cherry-pick base-browser-129.0a1-15.0-2-build1..mullvad-browser-129.0a1-15.0-2`
  - [ ] Rebase and autosquash these newly cherry-picked commits
    - **Example**: `git rebase --autosquash --interactive upstream/mullvad-browser-130.0a1-15.0-2`
  - [ ] Cherry-pick the new `mullvad-browser` alpha commits (i.e. the new dangling commits which did not appear in the previous Mullvad Browser rapid channel):
    - **Example** `git cherry-pick mullvad-browser-128.1.0esr-14.5-1-build1..upstream/mullvad-browser-128.1.0esr-14.5-1`
  - [ ] Rebase and autosquash again, this time replacing all `fixup` and `squash` commands with `pick`. The goal here is to have all of the `fixup` and `squash` commits beside the commit which they modify, but kept un-squashed for easy debugging/bisecting.
    - **Example**: `git rebase --autosquash --interactive upstream/mullvad-browser-130.0a1-15.0-2`
- [ ] Compare patch sets to ensure nothing *weird* happened during conflict resolution:
  - [ ] diff of diffs:
    -  Do the diff between `current_patchset.diff` and `rebased_patchset.diff` with your preferred difftool and look at differences on lines that starts with + or -
    - `git diff $(BASE_BROWSER_BRANCH_PREV_TAG)..$(MULLVAD_BROWSER_BRANCH_PREV) > current_patchset.diff`
    - `git diff $(BASE_BROWSER_BRANCH_TAG)..HEAD > rebased_patchset.diff`
    - diff `current_patchset.diff` and `rebased_patchset.diff`
      - If everything went correctly, the only lines which should differ should be the lines starting with `index abc123...def456` (unless the previous `base-browser` branch includes changes not included in the previous `mullvad-browser` branch)
  - [ ] rangediff: `git range-diff $(BASE_BROWSER_BRANCH_PREV_TAG)..$(MULLVAD_BROWSER_BRANCH_PREV) $(BASE_BROWSER_BRANCH_TAG)..HEAD`
    - **Example**: `git range-diff base-browser-129.0a1-15.0-2-build1..upstream/mullvad-browser-129.0a1-15.0-2 base-browser-130.0a1-15.0-2-build1..HEAD`
- [ ] Open MR for the `mullvad-browser` rebase
- [ ] Merge

### **Sign and Tag**

- [ ] Sign/Tag `HEAD` of the merged `mullvad-browser` branch:
  - In **mullvad-browser.git**, checkout the new rapid `mullvad-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.mullvadbrowser rapid build1
    ```
  - [ ] Push tag to `upstream`

/label ~"Apps::Type::Rebase"
