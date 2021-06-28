**NOTE** This is an issue template to standardise our process for responding to and fixing critical security and privacy vulnerabilities, exploits, etc.

## Information

### Related Issue
- tor-browser#AAAAA
- mullvad-browser#BBBBB
- tor-browser-build#CCCCC

#### Affected Platforms

- [ ] Android
- [ ] Desktop
  - [ ] Windows
  - [ ] macOS
  - [ ] Linux

### Type of Issue: What are we dealing with?

- [ ] Security (sandbox escape, remote code execution, etc)
- [ ] Proxy Bypass (traffic contents becoming MITM'able)
- [ ] De-Anonymization (otherwise identifying which website a user is visiting)
- [ ] Cross-Site Linkability (correlating sessions across circuits and websites)
- [ ] Disk Leak (persisting session information to disk)
- [ ] Other (please explain)

### Involvement: Who needs to be consulted and or involved to fix this?

- [ ] Applications Developers
  - [ ] **boklm** : build, packaging, signing, release
  - [ ] **clairehurst** : Android, macOS
  - [ ] **dan** : Android, macOS
  - [ ] **henry** : accessibility, frontend, localisation
  - [ ] **ma1** : firefox internals
  - [ ] **pierov** : updater, fonts, localisation, general
  - [ ] **richard** : signing, release
  - [ ] **thorin** : fingerprinting
- [ ] Other Engineering Teams
  - [ ] Networking (**ahf**, **dgoulet**)
  - [ ] Anti-Censorship (**meskio**, **cohosh**)
  - [ ] UX (**donuts**)
  - [ ] TPA (**anarcat**, **lavamind**)
- [ ] External Tor Partners
  - [ ] Mozilla
  - [ ] Mullvad
  - [ ] Brave
  - [ ] Guardian Project (Orbot, Onion Browser)
  - [ ] Tails
  - [ ] Other (please list)

### Urgency: When do we need to act?

- [ ] **ASAP** :rotating_light: Emergency release :rotating_light:
- [ ] Next scheduled stable
- [ ] Next scheduled alpha, then backport to stable
- [ ] Next major release
- [ ] Other (please explain)

#### Justification

<!-- Provide some paragraph here justifying the logic behind our estimated urgency -->

### Side-Effects: Who will be affected by a fix for this?
Sometimes fixes have side-effects: users lose their data, roadmaps need to be adjusted, services have to be upgraded, etc. Please enumerate the known downstream consequences a fix to this issue will likely incur.
- [ ] End-Users (please list)
- [ ] Internal Partners (please list)
- [ ] External Partners (please list)

## Todo:

### Communications

- [ ] Start an initial email thread with the following people:
  - [ ] **bella**
  - [ ] Relevant Applications Developers
  - [ ] **(Optional)** **micah**
    - if there are considerations or asks outside the Applications Team
  - [ ] **(Optional)** Other Team Leads
    - if there are considerations or asks outside the Applications Team
  - [ ] **(Optional)** **gazebook**
    - if there are consequences to the organisation or partners beyond a browser update, then a communication plan may be needed

/cc @bella
/cc @ma1
/cc @micah
/cc @richard

/confidential

Godspeed! :pray:
