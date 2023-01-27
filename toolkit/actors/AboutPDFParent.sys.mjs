/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const PDF_HEADER = "%PDF-";

let ShellService = null;
try {
  ({ ShellService } = ChromeUtils.importESModule(
    // eslint-disable-next-line mozilla/no-browser-refs-in-toolkit
    "moz-src:///browser/components/shell/ShellService.sys.mjs"
  ));
} catch {}

const lazy = {};

ChromeUtils.defineLazyGetter(
  lazy,
  "l10n",
  () => new Localization(["toolkit/about/aboutPDF.ftl"])
);

export class AboutPDFParent extends JSWindowActorParent {
  #filePickerOpenPromise = null;

  receiveMessage(message) {
    switch (message.name) {
      case "AboutPDF:CanSetDefaultPDFHandler":
        return this.#canSetDefaultPDFHandler();
      case "AboutPDF:PickFile":
        return this.#pickFile();
      case "AboutPDF:SetDefaultPDFHandler":
        return this.#setDefaultPDFHandler();
    }

    return undefined;
  }

  #canSetDefaultPDFHandler() {
    const xreDirProvider = Cc[
      "@mozilla.org/xre/directory-provider;1"
    ].getService(Ci.nsIXREDirProvider);
    if (
      !ShellService ||
      AppConstants.platform != "win" ||
      xreDirProvider.isPortableMode
    ) {
      return false;
    }

    try {
      return !ShellService.isDefaultHandlerFor(".pdf");
    } catch {
      return false;
    }
  }

  // Never accept a path from content: this load uses the system principal.
  // Native drop handling separately verifies dropped links against the drag
  // session.
  // Returns "opened", "canceled", or "invalid".
  async #pickFile() {
    if (this.#filePickerOpenPromise) {
      return "canceled";
    }

    let browsingContext = this.browsingContext.top;
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(
      this.browsingContext,
      await lazy.l10n.formatValue("about-pdf-file-picker-title"),
      Ci.nsIFilePicker.modeOpen
    );
    fp.appendFilters(Ci.nsIFilePicker.filterPDF);
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    let result;
    const { promise, resolve } = Promise.withResolvers();
    this.#filePickerOpenPromise = promise;
    try {
      fp.open(resolve);
      result = await this.#filePickerOpenPromise;
    } finally {
      this.#filePickerOpenPromise = null;
    }

    if (result !== Ci.nsIFilePicker.returnOK) {
      return "canceled";
    }

    let file = fp.file;
    if (
      !file?.leafName.toLowerCase().endsWith(".pdf") ||
      !(await this.#looksLikePDF(file))
    ) {
      return "invalid";
    }

    if (browsingContext.isDiscarded) {
      return "canceled";
    }
    browsingContext.loadURI(fp.fileURL, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    return "opened";
  }

  async #setDefaultPDFHandler() {
    if (!this.#canSetDefaultPDFHandler()) {
      return;
    }

    await ShellService.setAsDefaultPDFHandler();
  }

  async #looksLikePDF(file) {
    try {
      let bytes = await IOUtils.read(file.path, {
        maxBytes: PDF_HEADER.length,
      });
      return new TextDecoder().decode(bytes) === PDF_HEADER;
    } catch {
      return false;
    }
  }
}
