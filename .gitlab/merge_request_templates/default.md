## Merge Info

<!-- Bookkeeping information for release management -->

### Issues

#### Resolves
- tor-browser#xxxxx
- mullvad-browser#xxxxx
- tor-browser-build#xxxxx

#### Related

- tor-browser#xxxxx
- mullvad-browser#xxxxx
- tor-browser-build#xxxxx

### Merging

<!-- This block tells the merger where commits need to be merged and future code archaeologists where commits were *supposed* to be merged -->

#### Target Branches

- [ ] **`tor-browser`** - `!fixups` to `tor-browser`-specific commits, new features, security backports
- [ ] **`base-browser`** *and* **`mullvad-browser`** - `!fixups` to `base-browser`-specific commits, new features to be shared with `mullvad-browser`, and security backports
  - ⚠️ **IMPORTANT**: Please list the `base-browser`-specific commits which need to be cherry-picked to the `base-browser` and `mullvad-browser` branches here

#### Target Channels

- [ ] **Alpha**: esr128-14.5
- [ ] **Stable**: esr128-14.0
- [ ] **Legacy**: esr115-13.5

### Backporting

#### Timeline
- [ ] **No Backport (preferred)**: patchset for the next major stable
- [ ] **Immediate**: patchset needed as soon as possible (fixes CVEs, 0-days, etc)
- [ ] **Next Minor Stable Release**: patchset that needs to be verified in nightly before backport
- [ ] **Eventually**: patchset that needs to be verified in alpha before backport

#### (Optional) Justification
- [ ] **Security update**: patchset contains a security fix (be sure to select the correct item in _Timeline_)
- [ ] **Censorship event**: patchset enables censorship circumvention
- [ ] **Critical bug-fix**: patchset fixes a bug in core-functionality
- [ ] **Consistency**: patchset which would make development easier if it were in both the alpha and release branches; developer tools, build system changes, etc
- [ ] **Sponsor required**: patchset required for sponsor
- [ ] **Localization**: typos and other localization changes that should be also in the release branch
- [ ] **Other**: please explain

### Uplifting
- [ ] Patchset is a candidate for uplift to Firefox

### Issue Tracking
- [ ] Link resolved issues with appropriate [Release Prep issue](https://gitlab.torproject.org/groups/tpo/applications/-/issues/?sort=updated_desc&state=opened&label_name%5B%5D=Apps%3A%3AType%3A%3AReleasePreparation&first_page_size=100) for changelog generation

### Review

#### Request Reviewer

- [ ] Request review from an applications developer depending on modified system:
  - **NOTE**: if the MR modifies multiple areas, please `/cc` all the relevant reviewers (since Gitlab only allows 1 reviewer)
  - **accessibility** : henry
  - **android** : clairehurst, dan
  - **build system** : boklm
  - **extensions** : ma1
  - **firefox internals (XUL/JS/XPCOM)** : jwilde, ma1
  - **fonts** : pierov
  - **frontend (implementation)** : henry
  - **frontend (review)** : donuts, morgan
  - **localization** : henry, pierov
  - **macOS** : clairehurst, dan
  - **nightly builds** : boklm
  - **rebases/release-prep** : dan, ma1, pierov, morgan
  - **security** : jwilde, ma1
  - **signing** : boklm, morgan
  - **updater** : pierov
  - **windows** : jwilde, morgan
  - **misc/other** : pierov, morgan

#### Change Description

<!-- Whatever context the reviewer needs to effectively review the patchset; if the patch includes UX updates be sure to include screenshots/video of how any new behaviour -->


#### How Tested

<!-- Description of steps taken to verify the change -->
