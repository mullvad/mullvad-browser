/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { MozBoxBase } from "chrome://global/content/lit-utils.mjs";
import { html } from "chrome://global/content/vendor/lit.all.mjs";

/**
 * Widget for displaying the current security level.
 *
 * @tagname security-level-display
 * @property {string} value - The current security level.
 */
class SecurityLevelDisplay extends MozBoxBase {
  static properties = {
    value: { type: String },
    _nameL10nId: { type: String },
  };

  static #config = {
    standard: {
      nameL10nId: "security-level-panel-level-standard",
      iconSrc:
        "chrome://browser/content/securitylevel/security-level-standard.svg",
    },
    safer: {
      nameL10nId: "security-level-panel-level-safer",
      iconSrc:
        "chrome://browser/content/securitylevel/security-level-safer.svg",
    },
    safest: {
      nameL10nId: "security-level-panel-level-safest",
      iconSrc:
        "chrome://browser/content/securitylevel/security-level-safest.svg",
    },
    custom: {
      nameL10nId: "security-level-panel-level-custom",
      iconSrc:
        "chrome://browser/content/securitylevel/security-level-custom.svg",
    },
  };

  willUpdate() {
    const levelConfig = SecurityLevelDisplay.#config[this.value];
    this._nameL10nId = levelConfig?.nameL10nId ?? null;
    this.iconSrc = levelConfig?.iconSrc ?? null;
  }

  render() {
    if (!this._nameL10nId) {
      return "";
    }
    // NOTE: styleTemplate and iconTemplate come from MozBoxBase.
    return html`
      ${this.stylesTemplate()}
      <link
        rel="stylesheet"
        href="chrome://browser/content/securitylevel/widgets/security-level-display.css"
      />
      <div class="text-content has-icon has-description">
        ${this.iconTemplate()}
        <p class="label" data-l10n-id=${this._nameL10nId}></p>
        <security-level-description
          .value=${this.value}
          class="text-deemphasized"
        ></security-level-description>
      </div>
    `;
  }
}
customElements.define("security-level-display", SecurityLevelDisplay);
