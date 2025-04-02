- **NOTE**: All examples in this template reference the rebase from Firefox 129.0a1 to 130.0a1
- **TODO**:
  - Documentation step for any difficulties or noteworthy things for each rapid rebase

<details>
  <summary>Explanation of Channels</summary>

  There are unfortunately some collisions between how we and Mozilla name our release channels which can make things confusing:
  - **Firefox**:
    - **Nightly**: \_START and \_END tags, version in the format `$(MAJOR).$(MINOR)a1`
      - **Example**: Firefox Nightly 130 was `130.0a1`
      - **Note**: Nightly is 2 major versions ahead of the current Release
    - **Beta**: tagged each Monday, Wednesday, and Friday until release, version in the format `$(MAJOR).$(MINOR)b$(PATCH)`
      - **Example**: the first Firefox Beta 130 was `130.0b1`
      - **Note**: Beta is 1 major version ahead of the current Release, should be irrelevant to us
    - **Release**: tagged monthly, version in the format `$(MAJOR).$(MINOR)` or `$(MAJOR).$(MINOR).$(PATCH)`
      - **Example** Firefox Release 130 was `130.0`
    - **ESR**: tagged monthly, version in the format `$(ESR_MAJOR).$(ESR_MINOR).$(ESR_PATCH)esr`
      - **Example**: Firefox ESR 128.1 is `128.1.0esr`
  - **Tor+Mullvad Browser**:
    - **Rapid**: tagged monthly, based on the latest Firefox Nightly
    - **Nightly**: not tagged, built nightly from our current Alpha branch's `HEAD`
    - **Alpha**: tagged monthly, based on the latest Firefox ESR
    - **Stable**: tagged monthly, based on oldest supported Firefox ESR

</details>

<details>
  <summary>Branching Overview</summary>

  Rebasing Tor Browser Rapid onto the current Firefox Nightly is a bit more confusing/involved than rebasing Tor Browser Alpha or Stable from one minor ESR to the next minor ESR.

  The general process basically involves rebasing the previous Firefox Nightly-based Tor Browser Rapid onto the latest Firefox Nightly, and then cherry-picking all of the commits from the previous Firefox ESR-based Tor Browser Alpha after that channel's `build1` tag. This process presumes that the previous Tor Browser Alpha branch is locked and receiving no more changes.

  This diagram provides a high-level view of the overall code-flow for rebasing/cherry-picking commits from Tor Browser Alpha based on Firefox 128.1.0esr and Tor Browser Rapid based on Firefox 129.0a1 onto Firefox 130.0a1:

  ```mermaid
%%{init: { 'themeVariables': {'git0': '#0072b2', 'gitBranchLabel0': '#fff', 'git1': "#e69f00", 'gitBranchLabel1': '#fff', 'git2': '#009e73', 'gitBranchLabel2': '#fff', 'git3': '#cc79a7', 'gitBranchLabel3': '#fff'}, 'gitGraph': {'mainBranchName': 'tor-browser-128.1.0esr-14.5-1'}} }%%
gitGraph:
    branch tor-browser-129.0a1-15.0-2
    branch tor-browser-130.0a1-15.0-1
    branch tor-browser-130.0a1-15.0-2

    checkout tor-browser-128.1.0esr-14.5-1
    commit id: "FIREFOX_128_1_0esr_BUILD1"
    commit id: "base-browser-128.1.0esr-14.5-1-build1"
    commit id: "tor-browser-128.1.0esr-14.5-1-build1"
    commit id: "tor-browser-128.1.0esr-14.5-1-build2"

    checkout tor-browser-129.0a1-15.0-2
    commit id: "FIREFOX_NIGHTLY_129_END"
    %% commit id: "tor-browser-129.0a1-15.0-2-build1"

    checkout tor-browser-130.0a1-15.0-1
    commit id: "FIREFOX_NIGHTLY_130_END"

    checkout tor-browser-130.0a1-15.0-2
    commit id: "FIREFOX_NIGHTLY_130_END "

    checkout tor-browser-130.0a1-15.0-1
    merge tor-browser-129.0a1-15.0-2

    checkout tor-browser-130.0a1-15.0-2
    merge tor-browser-130.0a1-15.0-1


    checkout tor-browser-129.0a1-15.0-2
    commit id: "tor-browser-129.0a1-15.0-2-build1"

    checkout tor-browser-130.0a1-15.0-1
    merge tor-browser-129.0a1-15.0-2 id: "tor-browser-130.0a1-15.0-1-build1"

    checkout tor-browser-130.0a1-15.0-2
    merge tor-browser-130.0a1-15.0-1

    checkout tor-browser-130.0a1-15.0-1
    merge tor-browser-128.1.0esr-14.5-1

    checkout tor-browser-130.0a1-15.0-2
    merge tor-browser-130.0a1-15.0-1

    checkout tor-browser-128.1.0esr-14.5-1
    commit id: "tor-browser-128.1.0esr-14.5-1"

    checkout tor-browser-130.0a1-15.0-1
    merge tor-browser-128.1.0esr-14.5-1 id:"tor-browser-130.0a1-15.0-1-build2"

    checkout tor-browser-130.0a1-15.0-2

    merge tor-browser-130.0a1-15.0-1
    commit id: "tor-browser-130.0a1-15.0-2-build1"

  ```

  In this concrete example, the rebaser performs the following steps:
  - create new `tor-browser-130.0a1-15.0-1`, and `tor-browser-130.0a1-15.0-2` branches from the `FIREFOX_NIGHTLY_130_END` tag.
    - these will be the rebase review branches
  - onto `tor-browser-130.0a1-15.0-1`, cherry-pick the range `FIREFOX_NIGHTLY_129_END..tor-browser-129.0a1-15.0-2-build1` (i.e. the Firefox Nightly 129-based Tor Browser Rapid commits)
    - this updates the previous Tor Browser Rapid onto Firefox Nightly 130
  - cherry-pick the new alpha patches onto `tor-browser-130.0a1-15.0-1` (i.e. cherry-pick `tor-browser-128.1.0esr-14.5-1-build2..origin/tor-browser-128.1.0esr-14.5-1`)
  - onto `tor-browser-130.0a1-15.0-2`, rebase and autosquash the `FIREFOX_NIGHTLY_130_END..tor-browser-130.0a1-15.0-2-build1` commit range
  - onto `tor-browser-130.0a1-15.0-2`, cherry-pick the remaining commit range `tor-browser-130.0a1-15.0-2-build1..origin/tor-browser-130.0a1-15.0-2`
  - re-order any remaining fixup! commits to be adjacent to their parents (i.e. the same rebase command queue as one would get from `git rebase --autosquash`, but with the `fixup!` commands replaced with `pick!` commands).
    - this re-organises the branch in a nicely-bisectable way, and will ensure the rebase+autosquash step for the next release *should* succeed without any additional effort

</details>

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
- `$(TOR_BROWSER_BRANCH)`: the full name of the current `tor-browser` branch based off of the Firefox Nightly channel
  - **Example**: `tor-browser-130.0a1-15.0-1`
- `$(TOR_BROWSER_BRANCH_PREV)`: the full name of the previous `tor-browser` branch based off of the Firefox Nightly channel
  - **Example**: `tor-browser-129.0a1-15.0-1`
</details>

### Update Branch Protection Rules

- [ ] In [Repository Settings](https://gitlab.torproject.org/tpo/applications/tor-browser/-/settings/repository):
  - [ ] Remove previous nightly `tor-browser` branch protection rules (this will prevent pushing new changes to the branches being rebased)
  - [ ] Create new `tor-browser` branch protection rule:
    - **Branch**: `tor-browser-$(NIGHTLY_VERSION)-$(BROWSER_VERSION)-*`
      - **Example**: `tor-browser-130.0a1-15.0-*`
    - **Allowed to merge**: `Maintainers`
    - **Allowed to push and merge**: `Maintainers`
    - **Allowed to force push**: `false`
    - ⚠️ **IMPORTANT**: If you copied and pasted from old rules, double check you didn't add spaces at the end, as GitLab will not trim them!

### **Create New Branches**

- [ ] Find the Firefox mercurial tag `$(NIGHTLY_TAG)`
  - Go to https://hg.mozilla.org/mozilla-central/tags
  - Find and inspect the commit tagged with `$(NIGHTLY_TAG)`
    - Tags are in yellow in the Mercurial web UI
  - Find the equivalent commit in https://github.com/mozilla/gecko-dev/commits/master
    - **Notice**: GitHub sorts commits by time, you might want to use `git log gecko-dev/master` locally, instead
    - Using the differential revision link is useful to quickly find the git commit
  - Sign/Tag the `gecko-dev` commit: `git tag -as $(NIGHTLY_TAG) $(GIT_HASH) -m "Hg tag $(NIGHTLY_TAG)"`
- [ ] Create two new rapid `tor-browser` branches from Firefox mercurial tag
  - Branch name in the form: `tor-browser-$(NIGHTLY_VERSION)-$(BROWSER_VERSION)-${BRANCH_NUM}`
  - **Example**: `tor-browser-130.0a1-15.0-1` and `tor-browser-130.0a1-15.0-2`
- [ ] Push new `tor-browser` branches and the `firefox` tag to `upstream`

### **Rebase previous `-2` rapid branch's HEAD onto current `-1` rapid branch**

- **Desired outcome**:
  - An easy to review branch with the previous rapid branch rebased onto the latest Firefox Nighty tag
  - It must be possible to run `git range-diff` between the previous `-2` and the new branch
    - We want to see only the effects of the rebase
    - No autosquash should happen at this point
  - **Expected difficulties**:
    - Conflicts with upstream developments
    - Sometimes it will be hard to keep a feature working. It's fine to drop it, and create an issue to restore it after a deeper investigation.
- [ ] Checkout a new local branch for the first part of the `-1` rebase
  - **Example**: `git checkout -b rapid-rebase-part1 origin/tor-browser-130.0a1-15.0-1`
- [ ] Firefox Nightly-based `tor-browser` rebase:
  - [ ] cherry-pick previous Tor Browser Rapid `-2` branch to new `-1` rebase branch
    - **Example**: `git cherry-pick FIREFOX_NIGHTLY_129_END..origin/tor-browser-129.0a1-15.0-2`
- [ ] Rebase Verification:
    - [ ] Clean range-diff between the previous rapid branch and current rebase branch
      - **Example**:
        ```bash
        git range-diff FIREFOX_NIGHTLY_129_END..origin/tor-browser-129.0a1-15.0-2 FIREFOX_NIGHTLY_130_END..rapid-rebase-part1
        ```
    - [ ] Optional: clean diff of diffs between previous rapid branch and current rebase branch
      - **Example**:
        ```bash
        git diff FIREFOX_NIGHTLY_129_END origin/tor-browser-129.0a1-15.0-2 > 129.diff
        git diff FIREFOX_NIGHTLY_130_END HEAD > 130.diff
        # A two-column diff tool is suggested rather than plain-diff, e.g., meld on Linux.
        meld 129.diff 130.diff
        ```
      - **Note**: Only differences should be due to resolving merge conflicts with upstream changes from Firefox Nightly
- [ ] Open MR
- [ ] Merge
- [ ] Sign/Tag `HEAD` of the merged `tor-browser` branch:
  - In **tor-browser.git**, checkout the `-1` rapid `tor-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.torbrowser rapid build1
    ```
  - [ ] Push tag to `upstream`

### **Port new alpha patches to `-1`**

- **Desired outcome**:
  - The previous release-cycle's new alpha patches cherry-picked to the end of the current nightly
  - It must be possible to run `git range-diff ESR-build1..ESR NIGHTLY-build1..`
  - **Expected difficulties**:
    - Conflicts with upstream developments (similar to the previous part)
    - The range might contain cherry-picked upstream commits, which will result in empty commits: it's fine to skip them
  - **Note**: The Tor Browser Alpha branch should be closed at this point and not receiving any more MRs
- [ ] Checkout a new local branch for the second part of the `-1` rebase
  - **Example**: `git checkout -b rapid-rebase-part2 origin/tor-browser-130.0a1-15.0-1`
- [ ] Cherry-pick the new `tor-browser` alpha commits (i.e. the new dangling commits which did not appear in the previous Tor Browser Alpha release):
  - **Example** `git cherry-pick tor-browser-128.1.0esr-14.5-1-build1..origin/tor-browser-128.1.0esr-14.5-1`
- [ ] Rebase Verification
  - [ ] Clean range-diff between the alpha patch set ranges
    - **Example**:
      ```bash
      git range-diff tor-browser-128.1.0esr-14.5-1-build1..origin/tor-browser-128.1.0esr-14.5-1 origin/tor-browser-130.0a1-15.0-1..HEAD
      ```
  - [ ] Clean diff of diffs between the alpha patch set ranges
    - **Example**:
      ```bash
      git diff tor-browser-128.1.0esr-14.5-1-build1 origin/tor-browser-128.1.0esr-14.5-1 > 128.1.0esr.diff
      git diff origin/tor-browser-130.0a1-15.0-1 HEAD > 130.diff
      # A two-column diff tool is suggested rather than plain-diff, e.g., meld on Linux.
      meld 128.1.0esr.diff 130.diff
      ```
    - **Note**: Only differences should be due to resolving merge conflicts with upstream changes from Firefox Nightly
- [ ] Open MR
- [ ] Merge
- [ ] Sign/Tag `HEAD` of the merged `tor-browser` branch:
  - In **tor-browser.git**, checkout the `-1` rapid `tor-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.torbrowser rapid build2
    ```
  - [ ] Push tag to `upstream`

### **Squash and Reorder tor-browser `-1` branch to new `-2` branch**
- **Desired outcome**:
  - The rapid branch from the previous step prepared for the next nightly
  - **Rationale**:
    - We squash a lot of commits. We want to keep them a little bit longer rather than squashing them immediately for troubleshooting and documentation purposes.
    - Doing this as a separate pass helps to separate errors due to upstream changes from errors due to processes created by our workflow.
  - **Expected difficulties**:
    - our patches aren't disjoint, therefore we might have conflicts when shuffling them around.
- [ ] Checkout a new local branch for the `-2` rebase, aligned to -1-build1
  - **Example**: `git checkout -b rapid-rebase-part3 tor-browser-130.0a1-15.0-1-build1`
- [ ] Rebase with autosquash. This step should be trivial and not involve any conflicts.
  - **Example**: `git rebase -i --autosquash FIREFOX_NIGHTLY_130_END`
- [ ] Cherry-pick the remaining commits
  - **Example**: `git cherry-pick tor-browser-130.0a1-15.0-1-build1..upstream/tor-browser-130.0a1-15.0-1`
- [ ] Create a branch for self-reviewing purposes, or take note of the current commit hash somewhere
  - **Example**: `git branch rapid-rebase-part3-review`
  - You do not need to publish this, and you can delete it at the end of the process (`git branch -D rapid-rebase-part3-review`)
  - When you are a reviewer, it might be useful to repeat these steps locally. They should not involve mental overhead (and PieroV has a script to automate this)
- [ ] Rebase and reorder commits (i.e. replace `fixup `, `fixup -C ` and `squash ` with `pick ` commands)
  - Notice the space at the end, to avoid replacing `fixup!` with `pick!` in the commit subject, even though git will probably not care of such changes
- [ ] Rebase Verification
  - [ ] Clean range-diff between the temporary review branch and the final branch
    - **Example**:
      ```bash
      git range-diff FIREFOX_NIGHTLY_130_END..rapid-rebase-part3-review FIREFOX_NIGHTLY_130_END..rapid-rebase-part3
      ```
    - If you are the reviewer, it should be trivial to create such a branch on your own, as no shuffling is involved
  - [ ] Clean diff of diffs between rapid branches
    - **Example**:
      ```bash
      git diff FIREFOX_NIGHTLY_130_END tor-browser-130.0a1-15.0-1-build2 > 130-1.diff
      git diff FIREFOX_NIGHTLY_130_END HEAD > 130-2.diff
      ```
  - [ ] Understandable range-diff (i.e. `fixup!` patches are distributed from end of branch next to their parent)
    - **Example**:
      ```bash
      git range-diff FIREFOX_NIGHTLY_130_END..tor-browser-130.0a1-15.0-1-build2 FIREFOX_NIGHTLY_130_END..HEAD
      ```
- [ ] Open MR
- [ ] Merge
- [ ] Sign/Tag `HEAD` of the merged `tor-browser` branch:
  - In **tor-browser.git**, checkout the `-2` rapid `tor-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.torbrowser rapid build1
    ```
  - [ ] Push tag to `upstream`

### **Create and Tag base-browser `-2` branch**
- [ ] Find the last commit in the merged `-2` `tor-browser` branch with a `BB XXXXX...` subject
- [ ] Create new branch from this commit
  - Branch name in the form: `base-browser-$(NIGHTLY_VERSION)-$(BROWSER_VERSION)-2`
  - **Example**: `base-browser-130.0a1-15.0-2`
- [ ] Push branch to `upstream`
- [ ] Sign/Tag latest `HEAD` of the merged `base-browser` branch:
  - In **tor-browser.git**, checkout the `-2` rapid `tor-browser` branch
  - In **tor-browser-build.git**, run signing script:
    ```bash
    ./tools/browser/sign-tag.basebrowser rapid build1 ${COMMIT}
    ```
  - [ ] Push tag to `upstream`

/label ~"Apps::Type::Rebase"
