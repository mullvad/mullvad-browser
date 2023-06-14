**NOTE:** All examples in this template reference the rebase from 102.7.0esr to 102.8.0esr

<details>
  <summary>Explanation of Variables</summary>

- `$(ESR_VERSION)`: the Mozilla defined ESR version, used in various places for building mullvad-browser tags, labels, etc
  - **Example**: `102.8.0`
- `$(ESR_TAG)`: the Mozilla defined hg (Mercurial) tag associated with `$(ESR_VERSION)`
  - **Example**: `FIREFOX_102_8_0esr_RELEASE`
- `$(BROWSER_MAJOR)`: the browser major version
  - **Example**: `12`
- `$(BROWSER_MINOR)`: the browser minor version
  - **Example**: either `0` or `5`; Alpha's is always `(Stable + 5) % 10`
- `$(BASE_BROWSER_BRANCH)`: the full name of the current `base-browser` branch
  - **Example**: `base-browser-102.8.0esr-12.0-1`
- `$(BASE_BROWSER_BRANCH_PREV)`: the full name of the previous `base-browser` branch
  - **Example**: `base-browser-102.7.0esr-12.0-1`
- `$(BASE_BROWSER_BRANCH_TAG)`: the `base-browser` build tag used as base commit for `mullvad-browser`
  - **Example**: `base-browser-102.8.0esr-12.0-1-build1`
- `$(BASE_BROWSER_BRANCH_PREV_TAG)`: the `base-browser` build tag used as base commit for the previous `mullvad-browser`
  - **Example**: `base-browser-102.7.0esr-12.0-1-build1`
- `$(MULLVAD_BROWSER_BRANCH)`: the full name of the current `mullvad-browser` branch
  - **Example**: `mullvad-browser-102.8.0esr-12.0-1`
- `$(MULLVAD_BROWSER_BRANCH_PREV)`: the full name of the previous `mullvad-browser` branch
  - **Example**: `mullvad-browser-102.7.0esr-12.0-1`
</details>

**NOTE:** It is assumed that we've already rebased and tagged `base-browser` stable

### **Bookkeeping**

- [ ] Link this issue to the appropriate [Release Prep](https://gitlab.torproject.org/tpo/applications/tor-browser-build/-/issues/?sort=updated_desc&state=opened&label_name%5B%5D=Release%20Prep) issue.

### Update Branch Protection Rules

- [ ] In [Repository Settings](https://gitlab.torproject.org/tpo/applications/mullvad-browser/-/settings/repository):
  - [ ] Remove previous stable `mullvad-browser` branch protection rules (this will prevent pushing new changes to the branches being rebased)
  - [ ] Create new `mullvad-browser` branch protection rule:
    - **Branch**: `mullvad-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1*`
      - **Example**: `mullvad-browser-102.8.0esr-12.0-1*`
    - **Allowed to merge**: `Maintainers`
    - **Allowed to push and merge**: `Maintainers`
    - **Allowed to force push**: `false`

### **Create and Push New Branch**

- [ ] Create new stable `mullvad-browser` branch from this ESR's stable `base-browser` tag
  - Branch name in the form: `mullvad-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1`
  - **Example**: `git branch mullvad-browser-102.8.0esr-12.0-1 base-browser-102.8.0esr-12.0-1-build1`
- [ ] Push new `mullvad-browser` branch to `upstream`
- [ ] Push `base-browser` tag to `upstream`
- [ ] Push `$(ESR_TAG)` to `upstream`

### **Rebase mullvad-browser**

- [ ] Checkout a new local branch for the `mullvad-browser` rebase
  - **Example**: `git branch mullvad-browser-rebase upstream/mullvad-browser-102.8.0esr-12.0-1`
- [ ] `mullvad-browser` rebase
  - [ ] Cherry-pick the previous `mullvad-browser` branch's commit range up to the last `mullvad-browser` `build1` tag
    - **Example**: `git cherry-pick base-browser-102.7.0esr-12.0-1-build1..mullvad-browser-102.7.0esr-12.0-1-build1`
  - [ ] Rebase and autosquash these newly cherry-picked commits
     - **Example**: `git rebase --autosquash --interactive upstream/mullvad-browser-102.8.0esr-12.0-1`
  - [ ] Cherry-pick remainder of patches after the last `mullvad-browser` `buildN` tag
    - **Example**: `git cherry-pick mullvad-browser-102.7.0esr-12.0-1-build1..upstream/mullvad-browser-102.7.0esr-12.0-1`
  - [ ] Rebase and autosquash again, this time replacing all `fixup` and `squash` commands with `pick`. The goal here is to have all of the `fixup` and `squash` commits beside the commit which they modify, but kept un-squashed for easy debugging/bisecting.
    - **Example**: `git rebase --autosquash --interactive upstream/mullvad-browser-102.8.0esr-12.0-1`
- [ ] Compare patch sets to ensure nothing *weird* happened during conflict resolution:
  - [ ] diff of diffs:
    -  Do the diff between `current_patchset.diff` and `rebased_patchset.diff` with your preferred difftool and look at differences on lines that starts with + or -
    - `git diff $(BASE_BROWSER_BRANCH_PREV_TAG)..$(MULLVAD_BROWSER_BRANCH_PREV) > current_patchset.diff`
    - `git diff $(BASE_BROWSER_BRANCH_TAG)..HEAD > rebased_patchset.diff`
    - diff `current_patchset.diff` and `rebased_patchset.diff`
      - If everything went correctly, the only lines which should differ should be the lines starting with `index abc123...def456` (unless the previous `base-browser` branch includes changes not included in the previous `mullvad-browser` branch)
  - [ ] rangediff: `git range-diff $(BASE_BROWSER_BRANCH_PREV_TAG)..$(MULLVAD_BROWSER_BRANCH_PREV) $(BASE_BROWSER_BRANCH_TAG)..HEAD`
    - **Example**: `git range-diff base-browser-102.7.0esr-12.0-1-build1..upstream/mullvad-browser-102.7.0esr-12.5-1 base-browser-102.8.0esr-12.5-1-build1..HEAD`
- [ ] Open MR for the `mullvad-browser` rebase
- [ ] Merge

### **Sign and Tag**

- [ ] Sign/Tag `HEAD` of the merged `mullvad-browser` branch:
  - **Tag**: `mullvad-browser-$(ESR_VERSION)esr-$(BROWSER_MAJOR).$(BROWSER_MINOR)-1-build1`
  - **Message**: `Tagging build1 for $(ESR_VERSION)esr-based stable`
  - [ ] Push tag to `upstream`
