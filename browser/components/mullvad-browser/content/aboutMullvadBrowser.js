"use strict";

window.addEventListener("UpdateData", event => {
  const detail = event.detail;
  if (detail) {
    const { url, version } = detail;

    const text = document.getElementById("mullvad-browser-update");
    document.l10n.setAttributes(
      text.querySelector("span"),
      "about-mullvad-browser-update-message",
      { version }
    );
    text.querySelector("a").href = url;
  }
  // Before the first call, neither the intro nor update text are shown, this
  // prevents the intro text from flashing in and out when we have an update.
  document.body.classList.toggle("no-update", !detail);
  document.body.classList.toggle("has-update", !!detail);
});
