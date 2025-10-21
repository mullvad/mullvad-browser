/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { UrlbarUtils } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";

import {
  ActionsProvider,
  ActionsResult,
} from "moz-src:///browser/components/urlbar/ActionsProvider.sys.mjs";

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  OpenSearchEngine:
    "moz-src:///toolkit/components/search/OpenSearchEngine.sys.mjs",
  OpenSearchManager:
    "moz-src:///browser/components/search/OpenSearchManager.sys.mjs",
  loadAndParseOpenSearchEngine:
    "moz-src:///toolkit/components/search/OpenSearchLoader.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  UrlbarPrefs: "moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs",
  UrlbarSearchUtils:
    "moz-src:///browser/components/urlbar/UrlbarSearchUtils.sys.mjs",
});

const ENABLED_PREF = "contextualSearch.enabled";

const INSTALLED_ENGINE = "installed-engine";
const OPEN_SEARCH_ENGINE = "opensearch-engine";
const CONTEXTUAL_SEARCH_ENGINE = "contextual-search-engine";

const DEFAULT_ICON = "chrome://browser/skin/search-engine-placeholder@2x.png";

/**
 * A provider that returns an option for using the search engine provided
 * by the active view if it utilizes OpenSearch.
 */
class ProviderContextualSearch extends ActionsProvider {
  // Cache the results of engines looked up by host, these can be
  // expensive lookups and we don't want to redo the query every time
  // the user types when the result will not change.
  #hostEngines = new Map();
  // Cache the result of the query that checks whether an engines domain
  // has been visited recently. We only want to show engines the user
  // is using.
  #visitedEngineDomains = new Map();

  // Store the engine returned to the user in case they select it.
  #resultEngine = null;

  #placesObserver = null;

  constructor() {
    super();

    this.#placesObserver = new PlacesWeakCallbackWrapper(
      this.handlePlacesEvents.bind(this)
    );

    PlacesObservers.addListener(["history-cleared"], this.#placesObserver);
  }

  get name() {
    return "ActionsProviderContextualSearch";
  }

  isActive(queryContext) {
    return (
      queryContext.trimmedSearchString &&
      lazy.UrlbarPrefs.getScotchBonnetPref(ENABLED_PREF) &&
      !queryContext.searchMode &&
      lazy.UrlbarPrefs.get("suggest.engines")
    );
  }

  async queryActions(queryContext) {
    this.#resultEngine = await this.matchEngine(queryContext);
    if (this.#resultEngine) {
      return [await this.#createActionResult(this.#resultEngine)];
    }
    return null;
  }

  onSearchSessionEnd() {
    // We cache the results for a host while the user is typing, clear
    // when the search session ends as the results for the host may
    // change by the next search session.
    this.#hostEngines.clear();
  }

  async #createActionResult({ type, engine, key = "contextual-search" }) {
    let icon = engine?.icon || (await engine?.getIconURL?.()) || DEFAULT_ICON;
    let result = {
      key,
      l10nId: "urlbar-result-search-with",
      l10nArgs: { engine: engine.name || engine.title },
      icon,
    };

    if (type == INSTALLED_ENGINE) {
      result.engine = engine.name;
      result.dataset = { providesSearchMode: true };
      if (key != "matched-contextual-search") {
        result.dataset.immediateSearch = true;
      }
    }

    return new ActionsResult(result);
  }

  /*
   * Searches for engines that we want to present to the user based on their
   * current host and the search query they have entered.
   */
  async matchEngine(queryContext) {
    // First find currently installed engines that match the current query
    // if the user has DuckDuckGo installed and types "duck", offer that.
    let engine = await this.#matchTabToSearchEngine(queryContext);
    if (engine) {
      return engine;
    }

    // Don't match the default engine for non-query-matches.
    let defaultEngine = queryContext.isPrivate
      ? lazy.SearchService.defaultPrivateEngine
      : lazy.SearchService.defaultEngine;

    let browser =
      lazy.BrowserWindowTracker.getTopWindow()?.gBrowser.selectedBrowser;
    if (!browser) {
      return null;
    }

    let host;
    try {
      host = UrlbarUtils.stripPrefixAndTrim(browser.currentURI.host, {
        stripWww: true,
      })[0];
    } catch (e) {
      // about: pages will throw when access currentURI.host, ignore.
    }

    // Find engines based on the current host.
    if (host && !this.#hostEngines.has(host)) {
      // Find currently installed engines that match the current host. If
      // the user is on wikipedia.com, offer that.
      let hostEngine = await this.#matchInstalledEngine(host);

      if (!hostEngine) {
        // Find engines in the search configuration but not installed that match
        // the current host. If the user is on ecosia.com and starts searching
        // offer ecosia's search.
        let contextualEngineConfig =
          await lazy.SearchService.findContextualSearchEngineByHost(host);
        if (contextualEngineConfig) {
          hostEngine = {
            type: CONTEXTUAL_SEARCH_ENGINE,
            engine: contextualEngineConfig,
          };
        }
      }
      // Cache the result against this host so we do not need to rerun
      // the same query every keystroke.
      this.#hostEngines.set(host, hostEngine);
      if (hostEngine && hostEngine.engine.name != defaultEngine.name) {
        return hostEngine;
      }
    } else if (host) {
      let cachedEngine = this.#hostEngines.get(host);
      if (cachedEngine && cachedEngine.engine.name != defaultEngine.name) {
        return cachedEngine;
      }
    }

    // Lastly match any openSearch
    if (browser) {
      let openSearchEngines = lazy.OpenSearchManager.getEngines(browser);
      // We don't need to check if the engine has the same name as the
      // default engine because OpenSearchManager already handles that.
      if (openSearchEngines.length) {
        return { type: OPEN_SEARCH_ENGINE, engine: openSearchEngines[0] };
      }
    }

    return null;
  }

  /**
   * Called from `onLocationChange` in browser.js. It is used to update
   * the cache for `visitedEngineDomains` so we can avoid expensive places
   * queries.
   *
   * @param {window} window
   *  The browser window where the location change happened.
   * @param {nsIURI} uri
   *  The URI being navigated to.
   * @param {nsIWebProgress} _webProgress
   *   The progress object, which can have event listeners added to it.
   * @param {number} _flags
   *   Load flags. See nsIWebProgressListener.idl for possible values.
   */
  async onLocationChange(window, uri, _webProgress, _flags) {
    if (!uri.scheme.startsWith("http")) {
      return;
    }
    try {
      if (this.#visitedEngineDomains.has(uri.host)) {
        this.#visitedEngineDomains.set(uri.host, true);
      }
    } catch (e) {}
  }

  async #matchInstalledEngine(query) {
    let engines = await lazy.UrlbarSearchUtils.enginesForDomainPrefix(query, {
      matchAllDomainLevels: true,
    });
    if (engines.length) {
      return { type: INSTALLED_ENGINE, engine: engines[0] };
    }
    return null;
  }

  /*
   * Matches a users search query to the name of an installed engine.
   */
  async #matchTabToSearchEngine(queryContext) {
    let searchStr = queryContext.trimmedSearchString.toLocaleLowerCase();
    let defaultEngine = lazy.SearchService.defaultEngine;
    let matchedEngine = null;

    for (let engine of await lazy.SearchService.getVisibleEngines()) {
      let engineName = engine.name.toLocaleLowerCase();
      let engineAliases = engine.aliases.map(a => a.toLocaleLowerCase());

      const matches = (search, name) =>
        search.length < 3 ? name.startsWith(search) : name.includes(search);

      if (
        (matches(searchStr, engineName) ||
          engineAliases.some(alias => matches(searchStr, alias))) &&
        ((await this.#shouldskipRecentVisitCheck(searchStr)) ||
          (await this.#engineDomainHasRecentVisits(engine.searchUrlDomain)))
      ) {
        if (engine.name == defaultEngine.name) {
          return {
            type: INSTALLED_ENGINE,
            engine,
            key: "matched-contextual-search",
          };
        }

        if (!matchedEngine) {
          matchedEngine = engine;
        }
      }
    }

    if (!matchedEngine) {
      return null;
    }

    return {
      type: INSTALLED_ENGINE,
      engine: matchedEngine,
      key: "matched-contextual-search",
    };
  }

  /*
   * Check that an engines domain has been visited within the last 30 days
   * before providing as a match to the users query.
   */
  async #engineDomainHasRecentVisits(host) {
    if (this.#visitedEngineDomains.has(host)) {
      return this.#visitedEngineDomains.get(host);
    }

    let db = await lazy.PlacesUtils.promiseLargeCacheDBConnection();
    let rows = await db.executeCached(
      `
      SELECT 1 FROM moz_places
        WHERE rev_host BETWEEN get_unreversed_host(:host || '.') || '.' AND get_unreversed_host(:host || '.') || '/'
        AND (foreign_count > 0
          OR last_visit_date > strftime('%s','now','localtime','start of day','-30 days','utc') * 1000000)
      LIMIT 1;`,
      { host }
    );

    let visited = !!rows.length;
    this.#visitedEngineDomains.set(host, visited);
    return visited;
  }

  async #shouldskipRecentVisitCheck(query) {
    // If the user has entered enough characters they are very likely looking for
    // the engine, this avoids confusion for users searching for engines they have
    // not visited.
    if (query.length > 3) {
      return true;
    }
    // If we do not store history we cannot check whether an engine has been
    // visited, in that case we show the engines when matching.
    return (
      Services.prefs.getBoolPref("places.history.enabled", true) &&
      !(
        Services.prefs.getBoolPref("privacy.clearOnShutdown.history") ||
        lazy.PrivateBrowsingUtils.permanentPrivateBrowsing
      )
    );
  }

  onPick(queryContext, controller) {
    this.pickAction(queryContext, controller);
  }

  async pickAction(queryContext, controller, _element) {
    let { type, engine } = this.#resultEngine;

    if (type == OPEN_SEARCH_ENGINE) {
      let originAttributes;
      try {
        let currentURI = Services.io.newURI(queryContext.currentPage);
        originAttributes = {
          firstPartyDomain: Services.eTLD.getSchemelessSite(currentURI),
        };
      } catch {}
      let openSearchEngineData = await lazy.loadAndParseOpenSearchEngine(
        Services.io.newURI(engine.uri),
        null,
        originAttributes
      );
      engine = new lazy.OpenSearchEngine({
        engineData: openSearchEngineData,
        originAttributes,
      });
    }

    this.#performSearch(
      engine,
      queryContext.searchString,
      controller,
      this.#resultEngine.key == "matched-contextual-search"
    );

    if (
      // Do not show the install prompt in non-private windows to have
      // consistent behaviour with private windows and avoid linkability
      // concerns. tor-browser#44134.
      // Maybe re-enable as part of tor-browser#44117.
      !AppConstants.BASE_BROWSER_VERSION &&
      !queryContext.isPrivate &&
      type != INSTALLED_ENGINE &&
      (await lazy.SearchService.shouldShowInstallPrompt(engine))
    ) {
      this.#showInstallPrompt(controller, engine);
    }
  }

  handlePlacesEvents(_events) {
    this.#visitedEngineDomains.clear();
  }

  async #performSearch(engine, search, controller, enterSearchMode) {
    const [url] = UrlbarUtils.getSearchQueryUrl(engine, search);
    if (enterSearchMode) {
      controller.input.search(search, { searchEngine: engine });
    }
    controller.browserWindow.gBrowser.fixupAndLoadURIString(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    controller.browserWindow.gBrowser.selectedBrowser.focus();
  }

  #showInstallPrompt(controller, engineData) {
    let buttons = [
      {
        "l10n-id": "install-search-engine-add",
        callback() {
          lazy.SearchService.addSearchEngine(engineData);
        },
      },
      {
        "l10n-id": "install-search-engine-no",
        callback() {},
      },
    ];

    controller.browserWindow.gNotificationBox.appendNotification(
      "install-search-engine",
      {
        label: {
          "l10n-id": "install-search-engine",
          "l10n-args": { engineName: engineData.name },
        },
        image: "chrome://global/skin/icons/question-64.png",
        priority: controller.browserWindow.gNotificationBox.PRIORITY_INFO_LOW,
      },
      buttons
    );
  }

  QueryInterface = ChromeUtils.generateQI([Ci.nsISupportsWeakReference]);
}

export var ActionsProviderContextualSearch = new ProviderContextualSearch();
