Manual QA test check-list for major desktop releases. Please copy/paste form into your own comment, fill out relevant info and run through the checklist!

<details>
    <summary>Tor Browser Desktop QA Checklist</summary>

```markdown
# System Information

- Version: Tor Browser XXX
- OS: Windows|macOS|Linux YYY
- CPU Architecture:
- Profile: New|Old

# Features

## Base functionality
- [ ] Tor Browser launches successfully
- [ ] Connects to the Tor network
    - [ ] Homepage loads:
        - [ ] about:tor
        - [ ] about:blank
        - [ ] custom
- [ ] Tor Browser loads URLs passed by command-line after bootstrapped
- [ ] Localisation (Browser chrome)
  - [ ] Language notification/message bar
  - [ ] Spoof English
  - [ ] Check especially the recently added strings
- [ ] UI Customisations:
    - [ ] New Identity
        - [ ] Toolbar icon
        - [ ] Hamburger menu
        - [ ] File menu
    - [ ] New circuit for this site
        - [ ] Circuit display
        - [ ] Hamburger menu
        - [ ] File menu
    - [ ] No Firefox extras (Sync, Pocket, Report broken site, Tracking protection, etc)
    - [ ] No unified extensions button (puzzle piece)
    - [ ] NoScript button hidden
    - [ ] Context Menu Populated
- [ ] Fingerprinting resistance: https://arkenfox.github.io/TZP/tzp.html
- [ ] Security level (Standard, Safer, Safest)
    - Displays in:
        - toolbar icon
        - toolbar panel
        - about:preferences#privacy
    - [ ] On switch, each UI element is updated
    - [ ] On custom config (toggle `svg.disabled`)
        - [ ] each UI element displays warning
        - [ ] `Restore defaults` reverts custom prefs
    - **TODO**: test pages verifying correct behaviour
- [ ] New identity
- [ ] Betterboxing
    - [ ] Reuse last window size
    - [ ] Content alignment
    - [ ] No letterboxing:
        - [ ]empty tabs or privileged pages (eg: about:blank, about:about)
        - [ ] full-screen video
        - [ ] pdf viewer
        - [ ] reader-mode
- [ ] Downloads Warning
    - [ ] Downloads toolbar panel
    - [ ] about:downloads
    - [ ] Library window (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>o</kbd>)
- [ ] Drag and Drop protections:
    - [ ] Dragging a link from a tab to another tab in the same window works
    - [ ] Dragging a link from a tab to another tab in a separate window works
    - [ ] Dragging a link into the library creates a bookmark
    - [ ] Dragging a link from Tor Browser to Firefox doesn't work
    - [ ] Dragging a link from Firefox to Tor Browser works
    - [ ] Dragging a link from Tor Browser to another app (e.g., text editor) doesn't work
    - [ ] Repeat with page favicon

## Proxy safety
- [ ] Tor exit test: https://check.torproject.org
- [ ] Circuit isolation
    - Following websites should all report different IP addresses
    - https://ifconfig.io
    - https://myip.wtf
    - https://wtfismyip.com
- [ ] DNS leaks: https://dnsleaktest.com
- [ ] Circuit Display
    - [ ] Website => circuit
    - [ ] Remote PDF => circuit
    - [ ] Remote image => circuit
    - [ ] .onion Website => circuit with onion-service relays
    - [ ] .tor.onion Website => circuit with onion-service relays, link to true onion address
        - http://ft.securedrop.tor.onion
    - [ ] Website in reader mode => circuit (same as w/o reader mode)
    - [ ] Local image => no circuit
    - [ ] Local SVG with remote content => catch-all circuit, but not shown
    - [ ] Local PDF => no circuit
    - [ ] Local HTML `file://` with local resources  => no circuit
    - [ ] Local HTML `file://` with remote resources => catch-all circuit, but not shown

## Connectivity + Anti-Censorship
- [ ] Tor daemon config by environment variables
    - https://gitlab.torproject.org/tpo/applications/team/-/wikis/Environment-variables-and-related-preferences
- [ ] Internet Test ( about:preferences#connection )
  - [ ] Fails when offline
  - [ ] Succeeds when online
- [ ] Bridges:
    - Bootstrap
    - Browse: https://check.torproject.org
    - Bridge node in circuit-display
    - Bridge cards
    - Disable
    - Remove
    - [ ] Default bridges:
        - [ ] Removable as a group, not editable
        - [ ] obfs4
        - [ ] meek
        - [ ] snowflake
    - [ ] User provided bridges:
        - [ ] Removable and editable individually
        - [ ] obfs4 from https://bridges.torproject.org
        - [ ] webtunnel from https://bridges.torproject.org
        - [ ] conjure from [gitlab](https://gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/conjure/-/blob/main/client/torrc?ref_type=heads#L6)
    - [ ] Request bridges...
        - [ ] Removable as a group, but not editable
        - [ ] Succeeds when bootstrapped
        - [ ] Succeeds when not bootstrapped
    - **TODO**: Lox
- [ ] Connect Assist
    - Useful pref: `torbrowser.debug.censorship_level`
    - [ ] Auto-bootstrap updates Tor connection settings on success
    - [ ] Auto-bootstrap restore previous Tor connection settings on failure

## Web Browsing
- [ ] HTTPS-Only: http://http.badssl.com
- [ ] Crypto-currency warning on http website
    - **TODO**: we should provide an example page
- [ ] .onion:
    - [ ] torproject.org onion: http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/
    - [ ] Onion-Location pill
    - [ ] Client authentication
        - You can create an ephemeral client-auth onion-service using [onion share](https://onionshare.org)
    - [ ] Onion service errors
        - [ ] invalid onion: http://invalid.onion
        - [ ] onion offline: http://wfdn32ds656ycma5gvrh7duvdvxbg2ygzr3no3ijsya25qm6nnko4iqd.onion/
        - [ ] onion baddssl: https://gitlab.torproject.org/tpo/applications/team/-/wikis/Development-Information/BadSSL-But-Onion
        - **TODO** all the identity block states
        - **TODO** client auth
- [ ] **TODO**: .securedrop.tor.onion
- [ ] **TODO**: onion-service alt-svc
- [ ] HTML5 Video: https://tekeye.uk/html/html5-video-test-page
    - [ ] MPEG4
    - [ ] WebM
    - [ ] Ogg
- [ ] WebSocket Test: https://websocketking.com/

## External Components
- [ ] NoScript
  - [ ] Latest Version: https://addons.mozilla.org/en-US/firefox/addon/noscript/
  - [ ] Not removable from about:addons
  - [ ] Tests: https://test-data.tbb.torproject.org/test-data/noscript/
    - **TODO**: fix test pages
```

</details>
