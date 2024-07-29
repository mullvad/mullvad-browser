/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "console", () => {
  return console.createInstance({
    prefix: "FilesFilter",
  });
});

export class FilesFilterChild extends JSWindowActorChild {
  handleEvent(event) {
    if (!Services.prefs.getBoolPref("browser.filesfilter.enabled", true)) {
      return;
    }
    // drop or paste
    const { composedTarget } = event;
    const dt = event.clipboardData || event.dataTransfer;

    if ([...dt.files].some(f => f.mozFullPath)) {
      if (
        ["HTMLInputElement", "HTMLTextAreaElement"].includes(
          ChromeUtils.getClassName(composedTarget)
        )
      ) {
        event.preventDefault();
        lazy.console.log(
          `Preventing path leak on ${event.type} for ${[...dt.files]
            .map(f => `${f.name} (${f.mozFullPath})`)
            .join(", ")}.`
        );
      }
      return;
    }

    // "Paste Without Formatting" (ctrl+shift+V) in HTML editors coerces files into paths
    if (!(event.clipboardData && /[\/\\]/.test(dt.getData("text")))) {
      return;
    }

    // check wether the clipboard contains a file
    const { clipboard } = Services;
    if (
      [clipboard.kSelectionClipboard, clipboard.kGlobalClipboard].some(
        clipboardType =>
          clipboard.isClipboardTypeSupported(clipboardType) &&
          clipboard.hasDataMatchingFlavors(
            ["application/x-moz-file"],
            clipboardType
          )
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      lazy.console.log(
        `Preventing path leak on "Paste Without Formatting" for ${dt.getData(
          "text"
        )}.`
      );
    }
  }
}
