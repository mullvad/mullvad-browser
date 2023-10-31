/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

document.addEventListener("dialogaccept", () => {
  const retvals = window.arguments[0];
  retvals.confirmed = true;
  retvals.neverAskAgain = document.getElementById("neverAskAgain").checked;
});

document.addEventListener("DOMContentLoaded", () => {
  const dialog = document.getElementById("newIdentityDialog");

  const accept = dialog.getButton("accept");
  document.l10n.setAttributes(accept, "new-identity-dialog-confirm");
  accept.classList.add("danger-button");
});
