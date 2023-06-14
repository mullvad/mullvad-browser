## Merge Info

<!-- Bookkeeping information for release management -->

### Related Issues
- mullvad-browser#xxxxx
- tor-browser#xxxxx
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
- [ ] **Other**: please explain

### Merging
- [ ] Merge to `mullvad-browser` - `!fixups` to `tor-browser`-specific commits, new features, security backports
- [ ] Merge to `base-browser` -`!fixups` to `base-browser`-specific commits, new features to be shared with `mullvad-browser`, and security backports
  - **NOTE**: if your changeset includes patches to both `base-browser` and `mullvad-browser` please clearly label in the change description which commits should be cherry-picked to `base-browser` after merging

### Issue Tracking
- [ ] Link resolved issues with appropriate [Release Prep issue](https://gitlab.torproject.org/groups/tpo/applications/-/issues/?sort=updated_desc&state=opened&label_name%5B%5D=Release%20Prep&first_page_size=20) for changelog generation

## Change Description

<!-- Whatever context the reviewer needs to effectively review the patchset -->
