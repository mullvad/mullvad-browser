# 👣 Fingerprinting
<!--
Use this template to track a browser fingerprinting vector. Such vectors
allow for stateless cross-site tracking (i.e. across somehow collaborating
but otherwise unrelated 1st party domains like foo.com and bar.com)

For the purposes of developing a fix, this template is meant to define all of the things
we want to think about and analyze before implementing a fix. It's totally fine to leave
parts of this template empty on initial report! The the issue description can be updated
and edited as we learn things.

This template is also meant to serve as documentation/explanation about how we think
about fingerprinting vectors and minimising their utility.
-->

## Problem Statement
<!--
Please give an overview of the problem you think we should address.
  e.g. system fonts (`font: caption`) might expose desktop
  environment/distribution/language/customization because Firefox uses OS
  settings.
-->

## Documentation
<!--
Please provide a links to the relevant standards or documentation for the affected web
platform features. Additionally, please provide links to relevant academic research,
upstream Bugzilla issues, etc (if available).
-->

## Repro Steps
<!--
Please provide any proof of concept which can help us under how this feature
can be used for fingerprinting and that we can use as a test for our patches.
-->

## Analysis

### Metric Distribution
<!--
- How many different possible buckets of values exist without fingerprinting
mitigations?
- How are users distributed between these buckets?
- Do any group of users stand-out by default?
- Do users in each of these buckets likely have different risk profiles?
-->

### Metric Stability
<!--
- How does the metric change during and between browsing sessions without mitigations?
  e.g. Window size may be mostly stable during a browsing session
  but may change between browsing sessions
  e.g. User-Agent string is stable during a browsing session, but may change
  between major browser updates
-->

## Mitigation Strategy
<!--
Outline (at least) one of the possible mitigation strategies for this metric
(normalisation, randomisation, or disabling)
-->

### Normalisation
<!--
Describe a strategy whereby all users report the same value for the metric, or the pros
and cons if there are multiple potential normalisation strategies.
  e.g. Standardising reported WebGL constants such as maximum framebuffer size
- After normalisation, would this metric be equivalent another normalised metric?
  e.g. fonts are usually equivalent to the OS, which is already exposed.
- Sometimes it is impossible to use the same value for all users, but reducing the
  number of user buckets is still a win.

✅ This is the preferred mitigation strategy.
-->

### Randomisation
<!--
Describe a strategy whereby users return randomised metrics
  e.g. when enumerating webcams, choose a number of devices from a `[1; 3]` uniform
  distribution
- How did you choose this distribution and its parameters?
- What strategies should we use to hide the randomization?
  e.g. randomize the value only once per session and per first-party
- Why is it not possible to use a normalized value, instead? Normalization is often
  better than randomization because it is often easier to conceal

A randomised metric should ideally be:
- Different per first party domain
  e.g. different websites measure a different value for the metric
- Stable per session per first party domain
  e.g. a website repeatedly measuring the metric will get back the same value
  during the same browsing session
- Different between sessions, regardless of first party domain
  e.g. a website measuring a metric between browsing sessions will get back a different
  value

⚠️ We should only resort to randomisation if providing normalised values completely
and utterly breaks web compatibility, usability, or accessibility.
-->

### Disabling
<!--
Describe a strategy whereby the fingerprintable metric is just outright disabled
  e.g. Disabling WebAuthN feature entirely
- Why is it not possible to spoof a (normalized) value instead? Disabling an API might
  break some sites.
  e.g. Rejecting the permission prompt request promise would be preferable to removing
  or disabling the relevant APIs
- Is this a temporary change?
  e.g. necessary on the ESR version of Firefox we use for Tor Browser, but fixed in a
  later version of Firefox.
-->

## Other Considerations

### Usability and Accessibility
<!--
- Would the proposed mitigation make websites unusable for non-technical/human reasons?
  e.g. Always requesting language as en-US makes websites usable for non English-reading
  users
- Would it make the browser unusable for some users?
  e.g. Forcing overlay scrollbars would make websites unusable for some users with motor
  issues
- Do we need to provide a user-accessible 'escape-hatch' to allow users to opt-out of the
  proposed mitigation?
  e.g. Providing an option in about:preferences
-->

### Web Compatibility
<!--
Would the proposed mitigation break websites for technical reasons?
  e.g. Disabling WebAuthN preventing YubiKey authentication
-->

### Plausibility
<!--
Would the proposed mitigation make the browser stand out as a potential bot or scraper or
some other non-standard browser configuration?
  e.g. Reporting only 2 CPU-cores is unlikely for modern PCs in the year 2025
-->

<!-- Do not edit beneath this line <3 -->

---

/confidential
/label ~"Apps::Product::BaseBrowser"
/label ~"Project 131"
/label ~"Fingerprinting"
