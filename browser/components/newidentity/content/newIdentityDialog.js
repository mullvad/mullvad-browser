/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

document.addEventListener("dialogaccept", () => {
  const retvals = window.arguments[0];
  retvals.confirmed = true;
  retvals.neverAskAgain = document.querySelector("#neverAskAgain").checked;
});

document.addEventListener("DOMContentLoaded", () => {
  const { NewIdentityStrings } = window.arguments[0];
  const dialog = document.querySelector("#newIdentityDialog");

  dialog.querySelector("#infoTitle").textContent =
    NewIdentityStrings.new_identity_prompt_title;
  dialog.querySelector("#infoBody").textContent =
    NewIdentityStrings.new_identity_prompt;
  dialog.querySelector("#neverAskAgain").label =
    NewIdentityStrings.new_identity_ask_again;
  const accept = dialog.getButton("accept");
  accept.label = NewIdentityStrings.new_identity_restart;
  accept.classList.add("danger-button");
});
