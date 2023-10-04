/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AboutAddonsHTMLElement,
  formatUTMParams,
  getOptionsType,
  getUpdateInstall,
  hasPermission,
  isAddonOptionsUIAllowed,
  isAllowedInPrivateBrowsing,
  nl2br,
} from "../aboutaddons-utils.mjs";
import { gViewController } from "../view-controller.mjs";

const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
);

const { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionCommon: "resource://gre/modules/ExtensionCommon.sys.mjs",
});
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "DATA_COLLECTION_PERMISSIONS_ENABLED",
  "extensions.dataCollectionPermissions.enabled",
  false
);

const HIDE_NO_SCRIPT_PREF = "extensions.hideNoScript";

export class AddonDetails extends AboutAddonsHTMLElement {
  static get markup() {
    return `
      <template>
        <button-group class="tab-group">
          <button
            is="named-deck-button"
            deck="details-deck"
            name="details"
            data-l10n-id="details-addon-button"
            class="tab-button ghost-button"
          ></button>
          <button
            is="named-deck-button"
            deck="details-deck"
            name="preferences"
            data-l10n-id="preferences-addon-button"
            class="tab-button ghost-button"
          ></button>
          <button
            is="named-deck-button"
            deck="details-deck"
            name="permissions"
            data-l10n-id="permissions-addon-button"
            class="tab-button ghost-button"
          ></button>
          <button
            is="named-deck-button"
            deck="details-deck"
            name="release-notes"
            data-l10n-id="release-notes-addon-button"
            class="tab-button ghost-button"
          ></button>
        </button-group>
        <named-deck id="details-deck" is-tabbed>
          <section name="details">
            <div class="addon-detail-description-wrapper">
              <div class="addon-detail-description"></div>
              <button
                class="button-link addon-detail-description-toggle"
                data-l10n-id="addon-detail-description-expand"
                hidden
              ></button>
            </div>
            <div class="addon-detail-contribute">
              <label data-l10n-id="detail-contributions-description"></label>
              <button
                class="addon-detail-contribute-button"
                action="contribute"
                data-l10n-id="detail-contributions-button"
                data-l10n-attrs="accesskey"
              ></button>
            </div>
            <div class="addon-detail-sitepermissions">
              <addon-sitepermissions-list></addon-sitepermissions-list>
            </div>
            <div class="addon-detail-mlmodel">
              <addon-mlmodel-details></addon-mlmodel-details>
            </div>
            <!-- Add an option to show the NoScript toolbar button, if this is the
               - NoScript addon. See tor-browser#41581. -->
            <div
              class="addon-detail-row addon-detail-row-noscript-visibility"
              role="radiogroup"
              hidden="hidden"
            >
              <span
                class="addon-noscript-visibility-label"
                data-l10n-id="basebrowser-addon-noscript-visibility-label"
              ></span>
              <div class="addon-detail-actions">
                <label class="radio-container-with-text">
                  <input type="radio" name="noscript-visibility" value="show" />
                  <span
                    data-l10n-id="basebrowser-addon-noscript-visibility-show"
                  ></span>
                </label>
                <label class="radio-container-with-text">
                  <input type="radio" name="noscript-visibility" value="hide" />
                  <span
                    data-l10n-id="basebrowser-addon-noscript-visibility-hide"
                  ></span>
                </label>
              </div>
            </div>
            <div
              class="addon-detail-row addon-detail-row-updates"
              role="group"
              data-l10n-id="addon-detail-group-label-updates"
            >
              <span data-l10n-id="addon-detail-updates-label"></span>
              <div class="addon-detail-actions">
                <button
                  class="button-link"
                  data-l10n-id="addon-detail-update-check-label"
                  action="update-check"
                  hidden
                ></button>
                <label class="radio-container-with-text">
                  <input type="radio" name="autoupdate" value="1" />
                  <span
                    data-l10n-id="addon-detail-updates-radio-default"
                  ></span>
                </label>
                <label class="radio-container-with-text">
                  <input type="radio" name="autoupdate" value="2" />
                  <span data-l10n-id="addon-detail-updates-radio-on"></span>
                </label>
                <label class="radio-container-with-text">
                  <input type="radio" name="autoupdate" value="0" />
                  <span data-l10n-id="addon-detail-updates-radio-off"></span>
                </label>
              </div>
            </div>
            <div
              class="addon-detail-row addon-detail-row-has-help addon-detail-row-private-browsing"
              role="group"
              data-l10n-id="addon-detail-group-label-private-browsing"
              hidden
            >
              <span data-l10n-id="detail-private-browsing-label"></span>
              <div class="addon-detail-actions">
                <label class="radio-container-with-text">
                  <input type="radio" name="private-browsing" value="1" />
                  <span
                    data-l10n-id="addon-detail-private-browsing-allow"
                  ></span>
                </label>
                <label class="radio-container-with-text">
                  <input type="radio" name="private-browsing" value="0" />
                  <span
                    data-l10n-id="addon-detail-private-browsing-disallow"
                  ></span>
                </label>
              </div>
            </div>
            <div
              class="addon-detail-row addon-detail-help-row"
              data-l10n-id="addon-detail-private-browsing-help"
              hidden
            >
              <a
                is="moz-support-link"
                support-page="extensions-pb"
                data-l10n-name="learn-more"
              ></a>
            </div>
            <div
              class="addon-detail-row addon-detail-row-has-help addon-detail-row-private-browsing-disallowed"
              hidden
            >
              <label
                data-l10n-id="detail-private-disallowed-label"
              ></label>
            </div>
            <div
              class="addon-detail-row addon-detail-help-row"
              data-l10n-id="detail-private-disallowed-description2"
              hidden
            >
              <a
                is="moz-support-link"
                data-l10n-name="learn-more"
                support-page="extensions-pb"
              ></a>
            </div>
            <div
              class="addon-detail-row addon-detail-row-has-help addon-detail-row-private-browsing-required"
              hidden
            >
              <label
                class="learn-more-label-link"
                data-l10n-id="detail-private-required-label"
              ></label>
            </div>
            <div
              class="addon-detail-row addon-detail-help-row"
              data-l10n-id="detail-private-required-description2"
              hidden
            >
              <a
                is="moz-support-link"
                data-l10n-name="learn-more"
                support-page="extensions-pb"
              ></a>
            </div>
            <div
              class="addon-detail-row addon-detail-row-has-help addon-detail-row-quarantined-domains"
              role="group"
              data-l10n-id="addon-detail-group-label-quarantined-domains"
              hidden
            >
              <span
                data-l10n-id="addon-detail-quarantined-domains-label"
              ></span>
              <div class="addon-detail-actions">
                <label class="radio-container-with-text">
                  <input
                    type="radio"
                    name="quarantined-domains-user-allowed"
                    value="1"
                  />
                  <span
                    data-l10n-id="addon-detail-quarantined-domains-allow"
                  ></span>
                </label>
                <label class="radio-container-with-text">
                  <input
                    type="radio"
                    name="quarantined-domains-user-allowed"
                    value="0"
                  />
                  <span
                    data-l10n-id="addon-detail-quarantined-domains-disallow"
                  ></span>
                </label>
              </div>
            </div>
            <div class="addon-detail-row addon-detail-help-row" hidden>
              <span
                data-l10n-id="addon-detail-quarantined-domains-help"
              ></span>
              <a
                is="moz-support-link"
                support-page="quarantined-domains"
              ></a>
            </div>
            <div class="addon-detail-row addon-detail-row-author">
              <label data-l10n-id="addon-detail-author-label"></label>
              <a target="_blank"></a>
            </div>
            <div class="addon-detail-row addon-detail-row-version">
              <label data-l10n-id="addon-detail-version-label"></label>
            </div>
            <div class="addon-detail-row addon-detail-row-lastUpdated">
              <label data-l10n-id="addon-detail-last-updated-label"></label>
            </div>
            <div class="addon-detail-row addon-detail-row-homepage">
              <label data-l10n-id="addon-detail-homepage-label"></label>
              <!-- URLs should always be displayed as LTR. -->
              <a target="_blank" dir="ltr"></a>
            </div>
            <div class="addon-detail-row addon-detail-row-rating">
              <label data-l10n-id="addon-detail-rating-label"></label>
              <div class="addon-detail-rating">
                <moz-five-star></moz-five-star>
                <a target="_blank"></a>
              </div>
            </div>
          </section>
          <inline-options-browser name="preferences"></inline-options-browser>
          <addon-permissions-list name="permissions"></addon-permissions-list>
          <update-release-notes name="release-notes"></update-release-notes>
        </named-deck>
      </template>
    `;
  }

  connectedCallback() {
    if (!this.children.length) {
      this.render();
    }
    this.deck.addEventListener("view-changed", this);
    this.descriptionShowMoreButton.addEventListener("click", this);

    // If this is for the NoScript extension, we listen for changes in the
    // visibility of its toolbar button.
    // See tor-browser#41581.
    // NOTE: The addon should be set before being connected, so isNoScript will
    // return a correct value.
    if (this.isNoScript && !this._noScriptVisibilityObserver) {
      this._noScriptVisibilityObserver = () => this.updateNoScriptVisibility();
      Services.prefs.addObserver(
        HIDE_NO_SCRIPT_PREF,
        this._noScriptVisibilityObserver
      );
    }
  }

  disconnectedCallback() {
    this.inlineOptions.destroyBrowser();
    this.deck.removeEventListener("view-changed", this);
    this.descriptionShowMoreButton.removeEventListener("click", this);

    if (this._noScriptVisibilityObserver) {
      Services.prefs.removeObserver(
        HIDE_NO_SCRIPT_PREF,
        this._noScriptVisibilityObserver
      );
      // Clear in case this is called again, or if connectedCallback is called.
      delete this._noScriptVisibilityObserver;
    }
  }

  /**
   * Whether this is a description for the NoScript extension.
   *
   * @type {boolean}
   */
  get isNoScript() {
    return this.addon?.id === "{73a6fe31-595d-460b-a920-fcc0f8843232}";
  }

  /**
   * Update the shown visibility value for the NoScript extension's toolbar
   * button.
   */
  updateNoScriptVisibility() {
    if (!this.isNoScript) {
      return;
    }
    const visibility = Services.prefs.getBoolPref(HIDE_NO_SCRIPT_PREF, true)
      ? "hide"
      : "show";
    for (const input of this.querySelectorAll(
      ".addon-detail-row-noscript-visibility input"
    )) {
      input.checked = input.value === visibility;
    }
  }

  handleEvent(e) {
    if (e.type == "view-changed" && e.target == this.deck) {
      switch (this.deck.selectedViewName) {
        case "release-notes": {
          let releaseNotes = this.querySelector("update-release-notes");
          let uri = this.releaseNotesUri;
          if (uri) {
            releaseNotes.loadForUri(uri);
          }
          break;
        }
        case "preferences":
          if (getOptionsType(this.addon) == "inline") {
            this.inlineOptions.ensureBrowserCreated();
          }
          break;
      }

      // When a details view is rendered again, the default details view is
      // unconditionally shown. So if any other tab is selected, do not save
      // the current scroll offset, but start at the top of the page instead.
      gViewController.scrollOffsets.canRestore =
        this.deck.selectedViewName === "details";
    } else if (
      e.type == "click" &&
      e.target == this.descriptionShowMoreButton
    ) {
      this.toggleDescription();
    }
  }

  onInstalled() {
    let policy = WebExtensionPolicy.getByID(this.addon.id);
    let extension = policy && policy.extension;
    if (extension && extension.startupReason === "ADDON_UPGRADE") {
      // Ensure the options browser is recreated when a new version starts.
      this.extensionShutdown();
      this.extensionStartup();
    }
  }

  onDisabled() {
    this.extensionShutdown();
  }

  onEnabled() {
    this.extensionStartup();
  }

  extensionShutdown() {
    this.inlineOptions.destroyBrowser();
  }

  extensionStartup() {
    if (this.deck.selectedViewName === "preferences") {
      this.inlineOptions.ensureBrowserCreated();
    }
  }

  toggleDescription() {
    this.descriptionCollapsed = !this.descriptionCollapsed;

    this.descriptionWrapper.classList.toggle(
      "addon-detail-description-collapse",
      this.descriptionCollapsed
    );

    this.descriptionShowMoreButton.hidden = false;
    document.l10n.setAttributes(
      this.descriptionShowMoreButton,
      this.descriptionCollapsed
        ? "addon-detail-description-expand"
        : "addon-detail-description-collapse"
    );
  }

  get releaseNotesUri() {
    let { releaseNotesURI } = getUpdateInstall(this.addon) || this.addon;
    return releaseNotesURI;
  }

  setAddon(addon) {
    this.addon = addon;
  }

  update() {
    let { addon } = this;

    // Hide tab buttons that won't have any content.
    let getButtonByName = name =>
      this.tabGroup.querySelector(`[name="${name}"]`);
    let permsBtn = getButtonByName("permissions");
    permsBtn.hidden = addon.type != "extension";
    let notesBtn = getButtonByName("release-notes");
    notesBtn.hidden = !this.releaseNotesUri;
    let prefsBtn = getButtonByName("preferences");
    prefsBtn.hidden = getOptionsType(addon) !== "inline";
    if (prefsBtn.hidden) {
      if (this.deck.selectedViewName === "preferences") {
        this.deck.selectedViewName = "details";
      }
    } else {
      isAddonOptionsUIAllowed(addon).then(allowed => {
        prefsBtn.hidden = !allowed;
      });
    }

    // Override the deck button string when the feature is enabled, which isn't
    // the case by default for now.
    if (lazy.DATA_COLLECTION_PERMISSIONS_ENABLED) {
      permsBtn.setAttribute("data-l10n-id", "permissions-data-addon-button");
    }

    // Hide the tab group if "details" is the only visible button.
    let tabGroupButtons = this.tabGroup.querySelectorAll(".tab-button");
    this.tabGroup.hidden = Array.from(tabGroupButtons).every(button => {
      return button.name == "details" || button.hidden;
    });

    // Show the update check button if necessary. The button might not exist if
    // the add-on doesn't support updates.
    let updateButton = this.querySelector('[action="update-check"]');
    if (updateButton) {
      updateButton.hidden =
        this.addon.updateInstall || AddonManager.shouldAutoUpdate(this.addon);
    }

    // Set the value for auto updates.
    let inputs = this.querySelectorAll(".addon-detail-row-updates input");
    for (let input of inputs) {
      input.checked = input.value == addon.applyBackgroundUpdates;
    }
  }

  renderDescription(addon) {
    this.descriptionWrapper = this.querySelector(
      ".addon-detail-description-wrapper"
    );
    this.descriptionContents = this.querySelector(".addon-detail-description");
    this.descriptionShowMoreButton = this.querySelector(
      ".addon-detail-description-toggle"
    );

    if (addon.getFullDescription) {
      this.descriptionContents.appendChild(addon.getFullDescription(document));
    } else if (addon.fullDescription) {
      this.descriptionContents.appendChild(nl2br(addon.fullDescription));
    }

    this.descriptionCollapsed = false;

    requestAnimationFrame(() => {
      const remSize = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      );
      const { height } = this.descriptionContents.getBoundingClientRect();

      // collapse description if there are too many lines,i.e. height > (20 rem)
      if (height > 20 * remSize) {
        this.toggleDescription();
      }
    });
  }

  updateQuarantinedDomainsUserAllowed() {
    const { addon } = this;
    let quarantinedDomainsUserAllowedRow = this.querySelector(
      ".addon-detail-row-quarantined-domains"
    );
    if (addon.canChangeQuarantineIgnored) {
      quarantinedDomainsUserAllowedRow.hidden = false;
      quarantinedDomainsUserAllowedRow.nextElementSibling.hidden = false;
      quarantinedDomainsUserAllowedRow.querySelector(
        `[value="${addon.quarantineIgnoredByUser ? 1 : 0}"]`
      ).checked = true;
    } else {
      quarantinedDomainsUserAllowedRow.hidden = true;
      quarantinedDomainsUserAllowedRow.nextElementSibling.hidden = true;
    }
  }

  async render() {
    let { addon } = this;
    if (!addon) {
      throw new Error("addon-details must be initialized by setAddon");
    }

    this.textContent = "";
    this.appendChild(AddonDetails.fragment);

    this.deck = this.querySelector("named-deck");
    this.tabGroup = this.querySelector(".tab-group");

    // Set the add-on for the permissions section.
    this.permissionsList = this.querySelector("addon-permissions-list");
    this.permissionsList.setAddon(addon);

    // Set the add-on for the sitepermissions section.
    this.sitePermissionsList = this.querySelector("addon-sitepermissions-list");
    if (addon.type == "sitepermission") {
      this.sitePermissionsList.setAddon(addon);
    }
    this.querySelector(".addon-detail-sitepermissions").hidden =
      addon.type !== "sitepermission";

    // Set the add-on for the mlmodel details.
    if (addon.type == "mlmodel") {
      this.mlModelDetails = this.querySelector("addon-mlmodel-details");
      this.mlModelDetails.setAddon(addon);
      this.querySelector(".addon-detail-mlmodel").hidden = false;
    }

    // Set the add-on for the preferences section.
    this.inlineOptions = this.querySelector("inline-options-browser");
    this.inlineOptions.setAddon(addon);

    // Full description.
    this.renderDescription(addon);
    this.querySelector(".addon-detail-contribute").hidden =
      !addon.contributionURL;
    this.querySelector(".addon-detail-row-updates").hidden =
      !hasPermission(addon, "upgrade") ||
      addon.isApplyBackgroundUpdatesControlledByPolicies;

    // If this is the NoScript extension, we want to show an option to change
    // the visibility of its toolbar button.
    // See tor-browser#41581.
    const visibilityRow = this.querySelector(
      ".addon-detail-row-noscript-visibility"
    );
    visibilityRow.hidden = !this.isNoScript;
    if (this.isNoScript) {
      // Set up the aria-label for the role="radiogroup".
      const visibilityLabel = visibilityRow.querySelector(
        ".addon-noscript-visibility-label"
      );
      visibilityLabel.id = lazy.ExtensionCommon.makeWidgetId(
        `${addon.id}-noscript-visibility-label`
      );
      visibilityRow.setAttribute("aria-labelledby", visibilityLabel.id);

      // Set the initial displayed value.
      this.updateNoScriptVisibility();
    }

    if (addon.type != "extension") {
      // Don't show any private browsing related section for non-extension
      // addon types, because not relevant or they are either always allowed
      // (e.g. static themes).
      //
      // TODO(Bug 1799090): introduce ad-hoc UI for "sitepermission" addon type.
    } else if (addon.incognito == "not_allowed") {
      let pbRowNotAllowed = this.querySelector(
        ".addon-detail-row-private-browsing-disallowed"
      );
      pbRowNotAllowed.hidden = false;
      pbRowNotAllowed.nextElementSibling.hidden = false;
    } else if (!hasPermission(addon, "change-privatebrowsing")) {
      let pbRowRequired = this.querySelector(
        ".addon-detail-row-private-browsing-required"
      );
      pbRowRequired.hidden = false;
      pbRowRequired.nextElementSibling.hidden = false;
    } else {
      let pbRow = this.querySelector(".addon-detail-row-private-browsing");
      pbRow.hidden = false;
      pbRow.nextElementSibling.hidden = false;
      let isAllowed = await isAllowedInPrivateBrowsing(addon);
      pbRow.querySelector(`[value="${isAllowed ? 1 : 0}"]`).checked = true;
    }

    this.updateQuarantinedDomainsUserAllowed();

    // Author.
    let creatorRow = this.querySelector(".addon-detail-row-author");
    if (addon.creator) {
      let link = creatorRow.querySelector("a");
      link.hidden = !addon.creator.url;
      if (link.hidden) {
        creatorRow.appendChild(new Text(addon.creator.name));
      } else {
        link.href = formatUTMParams(
          "addons-manager-user-profile-link",
          addon.creator.url
        );
        link.target = "_blank";
        link.textContent = addon.creator.name;
      }
    } else {
      creatorRow.hidden = true;
    }

    // Version. Don't show a version for LWTs.
    let version = this.querySelector(".addon-detail-row-version");
    if (addon.version && !/@personas\.mozilla\.org/.test(addon.id)) {
      version.appendChild(new Text(addon.version));
    } else {
      version.hidden = true;
    }

    // Last updated.
    let updateDate = this.querySelector(".addon-detail-row-lastUpdated");
    if (addon.updateDate) {
      let lastUpdated = addon.updateDate.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      updateDate.appendChild(new Text(lastUpdated));
    } else {
      updateDate.hidden = true;
    }

    // Homepage.
    let homepageRow = this.querySelector(".addon-detail-row-homepage");
    if (addon.homepageURL) {
      let homepageURL = homepageRow.querySelector("a");
      homepageURL.href = addon.homepageURL;
      homepageURL.textContent = addon.homepageURL;
    } else {
      homepageRow.hidden = true;
    }

    // Rating.
    let ratingRow = this.querySelector(".addon-detail-row-rating");
    if (addon.reviewURL) {
      ratingRow.querySelector("moz-five-star").rating = addon.averageRating;
      let reviews = ratingRow.querySelector("a");
      reviews.href = formatUTMParams(
        "addons-manager-reviews-link",
        addon.reviewURL
      );
      document.l10n.setAttributes(reviews, "addon-detail-reviews-link", {
        numberOfReviews: addon.reviewCount,
      });
    } else {
      ratingRow.hidden = true;
    }

    this.update();
  }

  showPrefs() {
    if (getOptionsType(this.addon) == "inline") {
      this.deck.selectedViewName = "preferences";
      this.inlineOptions.ensureBrowserCreated();
    }
  }
}
customElements.define("addon-details", AddonDetails);
