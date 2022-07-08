/**
 * Common methods for the desktop security level components.
 */
export const SecurityLevelUIUtils = {
  /**
   * Create an element that gives a description of the security level. To be
   * used in the settings.
   *
   * @param {string} level - The security level to describe.
   * @param {Document} doc - The document where the element will be inserted.
   *
   * @returns {Element} - The newly created element.
   */
  createDescriptionElement(level, doc) {
    const el = doc.createElement("div");
    el.classList.add("security-level-description");

    let l10nIdSummary;
    let bullets;
    switch (level) {
      case "standard":
        l10nIdSummary = "security-level-summary-standard";
        break;
      case "safer":
        l10nIdSummary = "security-level-summary-safer";
        bullets = [
          "security-level-preferences-bullet-https-only-javascript",
          "security-level-preferences-bullet-limit-font-and-symbols",
          "security-level-preferences-bullet-limit-media",
        ];
        break;
      case "safest":
        l10nIdSummary = "security-level-summary-safest";
        bullets = [
          "security-level-preferences-bullet-disabled-javascript",
          "security-level-preferences-bullet-limit-font-and-symbols-and-images",
          "security-level-preferences-bullet-limit-media",
        ];
        break;
      case "custom":
        l10nIdSummary = "security-level-summary-custom";
        break;
      default:
        throw Error(`Unhandled level: ${level}`);
    }

    const summaryEl = doc.createElement("div");
    summaryEl.classList.add("security-level-summary");
    doc.l10n.setAttributes(summaryEl, l10nIdSummary);

    el.append(summaryEl);

    if (!bullets) {
      return el;
    }

    const listEl = doc.createElement("ul");
    listEl.classList.add("security-level-description-extra");
    // Add a mozilla styling class as well:
    listEl.classList.add("privacy-extra-information");
    for (const l10nId of bullets) {
      const bulletEl = doc.createElement("li");
      bulletEl.classList.add("security-level-description-bullet");

      doc.l10n.setAttributes(bulletEl, l10nId);

      listEl.append(bulletEl);
    }

    el.append(listEl);
    return el;
  },
};
