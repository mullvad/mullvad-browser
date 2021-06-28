Manual QA test check-list for major android releases. Please copy/paste form into your own comment, fill out relevant info and run through the checklist!
<details>
    <summary>Tor Browser Android QA Checklist</summary>
```markdown
# System Information

- Version: Tor Browser XXX
- OS: Android YYY
- Device + CPU Architecture: ZZZ

# Features

## Base functionality
- [ ] Tor Browser launches successfully
- [ ] Connects to the Tor network
- [ ] Localisation (Browser chrome)
  - [ ] Check especially the recently added strings
- [ ] Toolbars and menus work
- [ ] Fingerprinting resistance: https://arkenfox.github.io/TZP/tzp.html
- [ ] Security level (Standard, Safer, Safest)
    - **TODO**: test pages verifying correct behaviour

## Proxy safety
- [ ] Tor exit test: https://check.torproject.org
- [ ] Circuit isolation
    - Following websites should all report different IP addresses
    - https://ifconfig.io
    - https://myip.wtf
    - https://wtfismyip.com
- [ ] DNS leaks: https://dnsleaktest.com

## Connectivity + Anti-Censorship
- [ ] Bridges:
    - Bootstrap
    - Browse: https://check.torproject.org
    - [ ] Default bridges:
        - [ ] obfs4
        - [ ] meek
        - [ ] snowflake
    - [ ] User provided bridges:
        - [ ] obfs4 from https://bridges.torproject.org
        - [ ] webtunnel from https://bridges.torproject.org
        - [ ] conjure from [gitlab](https://gitlab.torproject.org/tpo/anti-censorship/pluggable-transports/conjure/-/blob/main/client/torrc?ref_type=heads#L6)

## Web Browsing
- [ ] HTTPS-Only: http://http.badssl.com
- [ ] .onion:
    - [ ] torproject.org onion: http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/
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
