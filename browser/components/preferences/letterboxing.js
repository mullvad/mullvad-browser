/* import-globals-from /browser/components/preferences/preferences.js */
/* import-globals-from /browser/components/preferences/findInPage.js */
/* import-globals-from /toolkit/content/preferencesBindings.js */

Preferences.addAll([
  {
    id: "privacy.resistFingerprinting.letterboxing.rememberSize",
    type: "bool",
  },
]);

{
  const lbEnabledPref = "privacy.resistFingerprinting.letterboxing";
  const visibilityPrefs = ["privacy.resistFingerprinting", lbEnabledPref];
  const alignMiddlePref = "privacy.resistFingerprinting.letterboxing.vcenter";

  const hideFromSearchIf = (mustHide, ...elements) => {
    for (const element of elements) {
      if (mustHide) {
        element.setAttribute("data-hidden-from-search", "true");
      } else {
        element.removeAttribute("data-hidden-from-search");
      }
    }
  };

  const syncVisibility = () => {
    const [rfpEnabled, letterboxingEnabled] = visibilityPrefs.map(pref =>
      Services.prefs.getBoolPref(pref, false)
    );
    const categoryElement = document.getElementById("letterboxingCategory");
    const { classList } = categoryElement;

    // Show the letterboxing section only if resistFingerprinting is enabled
    classList.toggle("rfp-enabled", rfpEnabled);
    classList.toggle("letterboxing-enabled", letterboxingEnabled);

    // To ensure the hidden parts do not contribute to search results, we need
    // to add "data-hidden-from-search".
    hideFromSearchIf(
      !rfpEnabled || !letterboxingEnabled,
      ...document.querySelectorAll(".letterboxing-category")
    );
    hideFromSearchIf(
      !rfpEnabled || letterboxingEnabled,
      document.getElementById("letterboxingDisabled")
    );
  };

  const onVisibilityPrefChange = () => {
    syncVisibility();
    // NOTE: Firefox does not expect "data-hidden-from-search" to change
    // dynamically after page initialization. So we need to manually recall the
    // methods that use "data-hidden-from-search". I.e. the "search" method,
    // using the currently shown category.
    // NOTE: We skip this if we are just initializing on page load.
    // NOTE: data-hidden-from-search is also used when the user has entered a
    // search term. We do not update the results in this case. Instead, it will
    // update when the search term changes or is cleared.
    if (!gSearchResultsPane.query) {
      search(gLastCategory.category, "data-category");
    }
  };

  const alignerId = "letterboxingAligner";
  const syncAligner = () => {
    const value = Services.prefs.getBoolPref(alignMiddlePref)
      ? "middle"
      : "top";
    document.querySelector(
      `#${alignerId} input[value="${value}"]`
    ).checked = true;
  };

  var gLetterboxingPrefs = {
    init() {
      syncVisibility();
      document
        .getElementById("letterboxingEnableButton")
        .addEventListener("command", () => {
          Services.prefs.setBoolPref(lbEnabledPref, true);
          // Button should have focus when activated but will be hidden now,
          // so re-assign focus to the newly revealed options.
          Services.focus.moveFocus(
            window,
            document.querySelector(".letterboxing-category"),
            Services.focus.MOVEFOCUS_FIRST,
            0
          );
        });
      for (const pref of visibilityPrefs) {
        Services.prefs.addObserver(pref, onVisibilityPrefChange);
      }

      syncAligner();
      document.getElementById(alignerId).addEventListener("change", e => {
        // NOTE: the "change" event is only fired on the checked input.
        Services.prefs.setBoolPref(
          alignMiddlePref,
          e.target.value === "middle"
        );
      });
      Services.prefs.addObserver(alignMiddlePref, syncAligner);
    },

    destroy() {
      for (const pref of visibilityPrefs) {
        Services.prefs.removeObserver(pref, onVisibilityPrefChange);
      }
      Services.prefs.removeObserver(alignMiddlePref, syncAligner);
    },
  };
}
