/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AboutAddonsHTMLElement } from "../aboutaddons-utils.mjs";
import { AddonCard } from "./addon-card.mjs";

const { XPCOMUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/XPCOMUtils.sys.mjs"
);

const lazy = XPCOMUtils.declareLazy({
  Extension: "resource://gre/modules/Extension.sys.mjs",
  ExtensionPermissions: "resource://gre/modules/ExtensionPermissions.sys.mjs",

  fileSchemeAccessRequiresOptIn: {
    pref: "extensions.webextensions.fileSchemeAccess.requireOptIn",
  },
});

function createPolicyPermissionsBanner() {
  let banner = document.createElement("moz-message-bar");
  banner.classList.add("addon-permissions-policy-banner");
  banner.setAttribute("type", "info");
  banner.messageL10nId = "addon-permissions-managed-by-policy";
  banner.supportPage =
    "managed-browser-firefox#w_why-some-features-may-be-disabled";
  return banner;
}

class AddonPermissionsList extends AboutAddonsHTMLElement {
  static get markup() {
    return `
      <template>
        <div class="addon-permissions-list-wrapper">
          <h2 class="permission-header"></h2>
          <em class="permission-subheader" hidden></em>
          <div class="addon-permissions-required" hidden>
            <div
              class="permission-subsection"
              data-l10n-id="addon-permissions-required-label"
            ></div>
            <ul class="addon-permissions-list"></ul>
          </div>
          <div class="addon-permissions-optional" hidden>
            <div
              class="permission-subsection"
              data-l10n-id="addon-permissions-optional-label"
            ></div>
            <ul class="addon-permissions-list"></ul>
          </div>
          <div class="addon-permissions-empty" hidden></div>
          <div class="addon-permissions-footer"></div>
        </div>
      </template>
    `;
  }

  setAddon(addon) {
    this.addon = addon;
    this.render();
  }

  async render() {
    let empty = { origins: [], permissions: [], data_collection: [] };
    let requiredPerms = { ...(this.addon.userPermissions ?? empty) };
    let optionalPerms = { ...(this.addon.optionalPermissions ?? empty) };
    let grantedPerms = await lazy.ExtensionPermissions.get(this.addon.id);
    let fileSchemeAllowed = grantedPerms.permissions.includes(
      "internal:fileSchemeAllowed"
    );

    // If optional permissions include <all_urls>, extension can request and
    // be granted permission for individual sites not listed in the manifest.
    // Include them as well in the optional origins list.
    let origins = [
      ...(this.addon.optionalOriginsNormalized ?? []),
      ...grantedPerms.origins.filter(o => !requiredPerms.origins.includes(o)),
    ];
    optionalPerms.origins = [...new Set(origins)];

    let permissions = lazy.Extension.formatPermissionStrings(
      {
        permissions: requiredPerms,
        optionalPermissions: optionalPerms,
        fileSchemeAllowed,
      },
      {
        buildOptionalOrigins: true,
        // tor-browser#45157: prevent "access local files" from being accidentally
        // toggled off in NoScript, causing Safer and Safest security levels to
        // fail on file:// URLs.
        includeFileSchemeAccess:
          lazy.fileSchemeAccessRequiresOptIn &&
          !(
            fileSchemeAllowed &&
            this.addon.id == "{73a6fe31-595d-460b-a920-fcc0f8843232}"
          ),
      }
    );
    let optionalEntries = [
      ...Object.entries(permissions.optionalPermissions),
      ...Object.entries(permissions.optionalOrigins),
      ...Object.entries(permissions.optionalDataCollectionPermissions),
    ];

    this.textContent = "";
    let permissionsFrag = AddonPermissionsList.fragment;
    let dataCollectionFrag = AddonPermissionsList.fragment;

    if (permissions.msgs.length) {
      let section = permissionsFrag.querySelector(
        ".addon-permissions-required"
      );
      section.hidden = false;
      let list = section.querySelector(".addon-permissions-list");
      for (const msg of permissions.msgs) {
        let item = document.createElement("li");
        item.classList.add("permission-info", "permission-checked");
        item.appendChild(document.createTextNode(msg));
        list.appendChild(item);
      }
    }

    if (
      permissions.dataCollectionPermissions?.msg &&
      !permissions.dataCollectionPermissions.hasNone
    ) {
      let section = dataCollectionFrag.querySelector(
        ".addon-permissions-required"
      );
      section.hidden = false;
      let list = section.querySelector(".addon-permissions-list");
      let item = document.createElement("li");
      item.classList.add("permission-info", "permission-checked");
      item.appendChild(
        document.createTextNode(permissions.dataCollectionPermissions.msg)
      );
      list.appendChild(item);
    }

    let isPolicyManaged = Services.policies?.isAddonRequiredByPolicy(
      this.addon.id
    );
    let policyLockedOrigins = new Set(
      isPolicyManaged
        ? (this.addon.requestedPermissions?.origins ?? []).map(
            o => new MatchPattern(o, { ignorePath: true }).pattern
          )
        : []
    );

    // getExtensionSettings returns the effective blocked list, which already
    // accounts for allowed_permissions.
    let policyBlockedPerms =
      Services.policies?.getExtensionSettings(this.addon.id)
        ?.blocked_permissions ?? [];

    if (optionalEntries.length) {
      let section = permissionsFrag.querySelector(
        ".addon-permissions-optional"
      );
      let dataCollectionSection = dataCollectionFrag.querySelector(
        ".addon-permissions-optional"
      );

      let list = section.querySelector(".addon-permissions-list");
      let dataCollectionList = dataCollectionSection.querySelector(
        ".addon-permissions-list"
      );

      let anyPolicyBlockedPerm = false;
      let anyPolicyLockedHost = false;
      for (let id = 0; id < optionalEntries.length; id++) {
        let [perm, msg] = optionalEntries[id];

        let type = "permission";
        if (permissions.optionalOrigins[perm]) {
          if (perm === "internal:fileSchemeAllowed") {
            type = "file_scheme_access";
          } else {
            type = "origin";
          }
        } else if (permissions.optionalDataCollectionPermissions[perm]) {
          type = "data_collection";
        }
        let item = document.createElement("li");
        item.classList.add("permission-info");

        let toggle = document.createElement("moz-toggle");
        toggle.setAttribute("label", msg);
        toggle.id = `permission-${id}`;
        toggle.setAttribute("permission-type", type);

        if (type === "permission" && policyBlockedPerms.includes(perm)) {
          toggle.setAttribute("disabled", "true");
          anyPolicyBlockedPerm = true;
        }

        let checked =
          grantedPerms.permissions.includes(perm) ||
          grantedPerms.origins.includes(perm) ||
          grantedPerms.data_collection.includes(perm);

        // If this is one of the "all sites" permissions
        if (lazy.Extension.isAllSitesPermission(perm)) {
          // mark it as checked if ANY of the "all sites" permission is granted.
          checked = await AddonCard.optionalAllSitesGranted(this.addon.id);
          toggle.toggleAttribute("permission-all-sites", true);
        }

        toggle.pressed = checked;

        if (type === "origin" && policyLockedOrigins.has(perm)) {
          toggle.setAttribute("disabled", "true");
          anyPolicyLockedHost = true;
        }

        toggle.setAttribute("permission-key", perm);
        toggle.setAttribute("action", "toggle-permission");

        if (perm === "userScripts") {
          let mb = document.createElement("moz-message-bar");
          mb.setAttribute("type", "warning");
          mb.messageL10nId = "webext-perms-extra-warning-userScripts-long";
          mb.slot = "nested";
          toggle.append(mb);
        }
        item.appendChild(toggle);

        if (type === "data_collection") {
          dataCollectionSection.hidden = false;
          dataCollectionList.appendChild(item);
        } else {
          section.hidden = false;
          list.appendChild(item);
        }
      }

      if (anyPolicyLockedHost || anyPolicyBlockedPerm) {
        let wrapper = permissionsFrag.querySelector(
          ".addon-permissions-list-wrapper"
        );
        let requiredSection = wrapper.querySelector(
          ".addon-permissions-required"
        );
        wrapper.insertBefore(createPolicyPermissionsBanner(), requiredSection);
      }
    }

    let configureSection = ({
      fragment,
      headerL10n,
      subheaderL10n,
      emptyL10n,
      supportPage,
      supportL10n,
    }) => {
      let header = fragment.querySelector(".permission-header");
      let subheader = fragment.querySelector(".permission-subheader");
      let footer = fragment.querySelector(".addon-permissions-footer");
      let requiredSection = fragment.querySelector(
        ".addon-permissions-required"
      );
      let optionalSection = fragment.querySelector(
        ".addon-permissions-optional"
      );
      let emptySection = fragment.querySelector(".addon-permissions-empty");
      let isPopulated = !(requiredSection.hidden && optionalSection.hidden);

      header.setAttribute("data-l10n-id", headerL10n);

      let supportUrl = document.createElement("a", {
        is: "moz-support-link",
      });
      supportUrl.setAttribute("support-page", supportPage);
      supportUrl.setAttribute("data-l10n-id", supportL10n);
      footer.append(supportUrl);

      if (subheaderL10n) {
        subheader.setAttribute("data-l10n-id", subheaderL10n);
        subheader.hidden = !isPopulated;
      }

      if (isPopulated) {
        emptySection.hidden = true;
        emptySection.removeAttribute("data-l10n-id");
      } else {
        emptySection.setAttribute("data-l10n-id", emptyL10n);
        emptySection.hidden = false;
      }
    };

    configureSection({
      fragment: permissionsFrag,
      headerL10n: "addon-permissions-heading",
      emptyL10n: "addon-permissions-empty2",
      supportPage: "extension-permissions",
      supportL10n: "addon-permissions-learnmore",
    });

    configureSection({
      fragment: dataCollectionFrag,
      headerL10n: "addon-permissions-data-collection-heading",
      subheaderL10n: "addon-data-collection-provided",
      emptyL10n: "addon-permissions-data-collection-empty",
      supportPage: "extension-data-collection",
      supportL10n: "addon-data-collection-learnmore",
    });

    this.appendChild(permissionsFrag);
    if (this.addon.hasDataCollectionPermissions) {
      this.appendChild(dataCollectionFrag);
    }
  }
}
customElements.define("addon-permissions-list", AddonPermissionsList);
