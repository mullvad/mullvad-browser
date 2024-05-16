/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

window.MozXULElement?.insertFTLIfNeeded("toolkit/global/mozSupportLink.ftl");

/**
 * An extension of the anchor element that helps create links to Mozilla's
 * support documentation. This should be used for SUMO links only - other "Learn
 * more" links can use the regular anchor element.
 *
 * @tagname moz-support-link
 * @attribute {string} support-page - Short-hand string from SUMO to the specific support page.
 * @attribute {string} utm-content - UTM parameter for a URL, if it is an AMO URL.
 * @attribute {string} data-l10n-id - Fluent ID used to generate the text content.
 */
export default class MozSupportLink extends HTMLAnchorElement {
  static SUPPORT_URL = "https://www.mozilla.org/";
  static get observedAttributes() {
    // We add tor-manual-page for pages hosted at tor project. Also shared with
    // base-browser/mullvad-browser. See tor-browser#42583.
    return ["support-page", "utm-content", "tor-manual-page"];
  }

  /**
   * Handles setting up the SUPPORT_URL preference getter.
   * Without this, the tests for this component may not behave
   * as expected.
   * @private
   * @memberof MozSupportLink
   */
  #register() {
    if (window.document.nodePrincipal?.isSystemPrincipal) {
      ChromeUtils.defineESModuleGetters(MozSupportLink, {
        BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
      });

      // eslint-disable-next-line no-shadow
      let { XPCOMUtils } = window.XPCOMUtils
        ? window
        : ChromeUtils.importESModule(
            "resource://gre/modules/XPCOMUtils.sys.mjs"
          );
      XPCOMUtils.defineLazyPreferenceGetter(
        MozSupportLink,
        "SUPPORT_URL",
        "app.support.baseURL",
        "",
        null,
        val => Services.urlFormatter.formatURL(val)
      );
    } else if (!window.IS_STORYBOOK) {
      MozSupportLink.SUPPORT_URL = window.RPMGetFormatURLPref(
        "app.support.baseURL"
      );
    }
  }

  connectedCallback() {
    this.#register();
    this.#setHref();
    this.setAttribute("target", "_blank");
    this.addEventListener("click", this);
    if (
      !this.getAttribute("data-l10n-id") &&
      !this.getAttribute("data-l10n-name") &&
      !this.childElementCount
    ) {
      const fixupL10nId = this.getAttribute("data-basebrowser-l10n-fixup");
      if (fixupL10nId) {
        document.l10n.formatValue(fixupL10nId).then(title => {
          this.setAttribute("title", title);
          // NOTE: Mozilla adds identical aria-label and title attributes. This is
          // generally bad practice because this link has no text content, so the
          // title alone will already act as the accessible name.
          // Normally setting both aria-label and title will lead to the title being
          // used as the accessible description, but since they are identical
          // the LocalAccessible::Description method will make an exception and keep
          // the description empty.
          // Since this component is outside of our fork's control, we follow the
          // same practice just in case Mozilla ever adds some text content.
          this.setAttribute("aria-label", title);
        });
        return;
      }
      document.l10n.setAttributes(this, "moz-support-link-text");
    }
    document.l10n.translateFragment(this);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this);
  }

  handleEvent(e) {
    if (e.type == "click") {
      if (window.openTrustedLinkIn) {
        let where = MozSupportLink.BrowserUtils.whereToOpenLink(e, false, true);
        if (where == "current") {
          where = "tab";
        }
        e.preventDefault();
        openTrustedLinkIn(this.href, where);
      }
    }
  }

  attributeChangedCallback(attrName) {
    if (
      attrName === "support-page" ||
      attrName === "utm-content" ||
      attrName === "tor-manual-page"
    ) {
      this.#setHref();
    }
  }

  #setHref() {
    let torManualPage = this.getAttribute("tor-manual-page");
    if (torManualPage) {
      const [page, anchor] = torManualPage.split("_", 2);

      let locale = Services.locale.appLocaleAsBCP47;
      if (locale === "ja-JP-macos") {
        // Convert quirk-locale to the locale used for tor project.
        locale = "ja";
      }

      let href = `https://tb-manual.torproject.org/${locale}/${page}/`;
      if (anchor) {
        href = `${href}#${anchor}`;
      }
      this.href = href;
      return;
    }
    let supportPage = this.getAttribute("support-page") ?? "";
    let base = MozSupportLink.SUPPORT_URL + supportPage;
    this.href = this.hasAttribute("utm-content")
      ? formatUTMParams(this.getAttribute("utm-content"), base)
      : base;
  }
}
customElements.define("moz-support-link", MozSupportLink, { extends: "a" });

/**
 * Adds UTM parameters to a given URL, if it is an AMO URL.
 *
 * @param {string} contentAttribute
 *        Identifies the part of the UI with which the link is associated.
 * @param {string} url
 * @returns {string}
 *          The url with UTM parameters if it is an AMO URL.
 *          Otherwise the url in unmodified form.
 */
export function formatUTMParams(contentAttribute, url) {
  // Do not add utm parameters. See tor-browser#42583.
  // NOTE: This method is also present in about:addons.
  return url;
}
