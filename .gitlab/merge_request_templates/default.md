## Merge Info

<!-- Bookkeeping information for release management -->

### Related Issues
- tor-browser#xxxxx
- mullvad-browser#xxxxx
- tor-browser-build#xxxxx

### Backporting

#### Timeline
- [ ] **Immediate**: patchset needed as soon as possible
- [ ] **Next Minor Stable Release**: patchset that needs to be verified in nightly before backport
- [ ] **Eventually**: patchset that needs to be verified in alpha before backport
- [ ] **No Backport (preferred)**: patchset for the next major stable

#### (Optional) Justification
- [ ] **Emergency security update**: patchset fixes CVEs, 0-days, etc
- [ ] **Censorship event**: patchset enables censorship circumvention
- [ ] **Critical bug-fix**: patchset fixes a bug in core-functionality
- [ ] **Consistency**: patchset which would make development easier if it were in both the alpha and release branches; developer tools, build system changes, etc
- [ ] **Sponsor required**: patchset required for sponsor
- [ ] **Localization**: typos and other localization changes that should be also in the release branch
- [ ] **Other**: please explain

### Merging
- [ ] Merge to `tor-browser` - `!fixups` to `tor-browser`-specific commits, new features, security backports
- [ ] Merge to `base-browser` - `!fixups` to `base-browser`-specific commits, new features to be shared with `mullvad-browser`, and security backports
  - **NOTE**: if your changeset includes patches to both `base-browser` and `tor-browser` please clearly label in the change description which commits should be cherry-picked to `base-browser` after merging

### Issue Tracking
- [ ] Link resolved issues with appropriate [Release Prep issue](https://gitlab.torproject.org/groups/tpo/applications/-/issues/?sort=updated_desc&state=opened&label_name%5B%5D=Release%20Prep&first_page_size=20) for changelog generation

### Review

#### Request Reviewer

- [ ] Request review from an applications developer depending on modified system:
  - **NOTE**: if the MR modifies multiple areas, please `/cc` all the relevant reviewers (since gitlab only allows 1 reviewer)
  - **accessibility** : henry
  - **android** : clairehurst, dan
  - **build system** : boklm
  - **extensions** : ma1
  - **firefox internals (XUL/JS/XPCOM)** : jwilde, ma1
  - **fonts** : pierov
  - **frontend (implementation)** : henry
  - **frontend (review)** : donuts, richard
  - **localization** : henry, pierov
  - **macOS** : clairehurst, dan
  - **nightly builds** : boklm
  - **rebases/release-prep** : dan, ma1, pierov, richard
  - **security** : jwilde, ma1
  - **signing** : boklm, richard
  - **updater** : pierov
  - **windows** : jwilde, richard
  - **misc/other** : pierov, richard

#### Change Description

<!-- Whatever context the reviewer needs to effectively review the patchset; if the patch includes UX updates be sure to include screenshots/video of how any new behaviour -->

#### How Tested

<!-- Description of steps taken to verify the change -->
