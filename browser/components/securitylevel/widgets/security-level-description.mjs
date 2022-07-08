/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { html, repeat } from "chrome://global/content/vendor/lit.all.mjs";

/**
 * Widget that displays the description for a given security level.
 *
 * @tagname security-level-description
 * @property {string} value - The security level to show the description for.
 * @property {boolean} hideBullets - Whether to hide the bullet points for the
 *   description.
 */
class SecurityLevelDescription extends MozLitElement {
  static properties = {
    value: { type: String },
    hideBullets: { type: Boolean, reflect: true, attribute: "hide-bullets" },
  };

  static #config = {
    standard: {
      summaryL10nId: "security-level-summary-standard",
    },
    safer: {
      summaryL10nId: "security-level-summary-safer",
      bullets: [
        "security-level-preferences-bullet-https-only-javascript",
        "security-level-preferences-bullet-limit-font-and-symbols",
        "security-level-preferences-bullet-limit-media",
      ],
    },
    safest: {
      summaryL10nId: "security-level-summary-safest",
      bullets: [
        "security-level-preferences-bullet-disabled-javascript",
        "security-level-preferences-bullet-limit-font-and-symbols-and-images",
        "security-level-preferences-bullet-limit-media",
      ],
    },
    custom: {
      summaryL10nId: "security-level-summary-custom",
    },
  };

  listTemplate() {
    const bullets = SecurityLevelDescription.#config[this.value]?.bullets;
    if (!bullets) {
      return "";
    }
    return html`
      <ul>
        ${repeat(
          bullets,
          l10nId => l10nId,
          l10nId => html`<li data-l10n-id=${l10nId}></li>`
        )}
      </ul>
    `;
  }

  render() {
    let l10nId = SecurityLevelDescription.#config[this.value]?.summaryL10nId;
    if (!l10nId) {
      return "";
    }

    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/securitylevel/widgets/security-level-description.css"
      />
      <p data-l10n-id=${l10nId}></p>
      ${this.listTemplate()}
    `;
  }
}
customElements.define("security-level-description", SecurityLevelDescription);
