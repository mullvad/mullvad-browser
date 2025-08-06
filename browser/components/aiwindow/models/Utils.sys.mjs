/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * This module defines utility functions and classes needed for invoking LLMs such as:
 * - Creating and running OpenAI engine instances
 * - Rendering prompts from files
 */

import {
  OAUTH_CLIENT_ID,
  SCOPE_PROFILE_UID,
  SCOPE_SMART_WINDOW,
} from "resource://gre/modules/FxAccountsCommon.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const APIKEY_PREF = "browser.smartwindow.apiKey";
export const MODEL_PREF = "browser.smartwindow.model";
const ENDPOINT_PREF = "browser.smartwindow.endpoint";
const CUSTOM_ENDPOINT_PREF = "browser.smartwindow.customEndpoint";
const CUSTOM_MODEL_CHOICE_ID = "0";
const GENERIC_MODEL_NAME = "generic";
const MODEL_CHOICE_PREF = "browser.smartwindow.firstrun.modelChoice";

const lazy = XPCOMUtils.declareLazy({
  RemoteSettings: "resource://services-settings/remote-settings.sys.mjs",
  getFxAccountsSingleton: "resource://gre/modules/FxAccounts.sys.mjs",
});

/**
 * The default endpoint used for preset models
 */
const DEFAULT_ENDPOINT =
  "https://mlpa-prod-prod-mozilla.global.ssl.fastly.net/v1";

/**
 * Default engine ID used for all AI Window features
 */
export const DEFAULT_ENGINE_ID = "smart-openai";

function createEngine() {
  return null;
}

/**
 * Observer for model preference changes.
 * Invalidates the Remote Settings client cache when user changes their model preference.
 */
const modelPrefObserver = {
  observe(_subject, topic, data) {
    if (topic === "nsPref:changed" && data === MODEL_PREF) {
      console.warn(
        "Model preference changed, invalidating Remote Settings cache"
      );
      openAIEngine._remoteClient = null;
    }
  },
};
Services.prefs.addObserver(MODEL_PREF, modelPrefObserver);

/**
 * Feature identifiers for AI Window model, configurations and prompts.
 * These are used to look up model configs, prompts, and inference parameters
 * from Remote Settings or local defaults.
 */
export const MODEL_FEATURES = Object.freeze({
  CHAT: "chat",
  TITLE_GENERATION: "title-generation",
  CONVERSATION_STARTERS_SIDEBAR_SYSTEM: "conversation-starters-sidebar-system",
  CONVERSATION_SUGGESTIONS_SIDEBAR_STARTER:
    "conversation-suggestions-sidebar-starter",
  CONVERSATION_SUGGESTIONS_FOLLOWUP: "conversation-suggestions-followup",
  CONVERSATION_SUGGESTIONS_ASSISTANT_LIMITATIONS:
    "conversation-suggestions-assistant-limitations",
  CONVERSATION_SUGGESTIONS_MEMORIES: "conversation-suggestions-memories",
  // memories generation features
  MEMORIES_INITIAL_GENERATION_SYSTEM: "memories-initial-generation-system",
  MEMORIES_INITIAL_GENERATION_USER: "memories-initial-generation-user",
  MEMORIES_QUALITY_AND_SENSITIVITY_FILTER_SYSTEM:
    "memories-quality-and-sensitivity-filter-system",
  MEMORIES_QUALITY_AND_SENSITIVITY_FILTER_USER:
    "memories-quality-and-sensitivity-filter-user",
  MEMORIES_DEDUPLICATION_SYSTEM: "memories-deduplication-system",
  MEMORIES_DEDUPLICATION_USER: "memories-deduplication-user",
  // memories usage features
  MEMORIES_MESSAGE_CLASSIFICATION_SYSTEM:
    "memories-message-classification-system",
  MEMORIES_MESSAGE_CLASSIFICATION_USER: "memories-message-classification-user",
  // real time context
  REAL_TIME_CONTEXT_DATE: "real-time-context-date",
  REAL_TIME_CONTEXT_TAB: "real-time-context-tab",
  REAL_TIME_CONTEXT_MENTIONS: "real-time-context-mentions",
  MEMORIES_RELEVANT_CONTEXT: "memories-relevant-context",
});

/** @typedef {(typeof MODEL_FEATURES)[keyof typeof MODEL_FEATURES]} ModelFeature */

/**
 * Service types for different AI Window features
 */
export const SERVICE_TYPES = Object.freeze({
  AI: "ai",
  MEMORIES: "memories",
});

/**
 * Purposes for different AI Window features, used to track usage and performance in telemetry
 */
export const PURPOSES = Object.freeze({
  CHAT: "chat",
  TITLE_GENERATION: "title-generation",
  CONVERSATION_STARTERS_SIDEBAR: "convo-starters-sidebar",
  MEMORY_GENERATION: "memory-generation",
});

/**
 * Major version compatibility requirements for each feature.
 * When incrementing a feature's major version:
 * - Update this constant
 * - Ensure Remote Settings has configs for the new major version
 * - Old clients will continue using old major version
 *
 * Keep ui/test/browser/head.js MOCK_RS_RECORDS aligned with this table.
 */
export const FEATURE_MAJOR_VERSIONS = Object.freeze({
  [MODEL_FEATURES.CHAT]: 7,
  [MODEL_FEATURES.TITLE_GENERATION]: 1,
  [MODEL_FEATURES.CONVERSATION_STARTERS_SIDEBAR_SYSTEM]: 1,
  [MODEL_FEATURES.CONVERSATION_SUGGESTIONS_SIDEBAR_STARTER]: 2,
  [MODEL_FEATURES.CONVERSATION_SUGGESTIONS_FOLLOWUP]: 1,
  [MODEL_FEATURES.CONVERSATION_SUGGESTIONS_ASSISTANT_LIMITATIONS]: 1,
  [MODEL_FEATURES.CONVERSATION_SUGGESTIONS_MEMORIES]: 1,
  // memories generation feature versions
  [MODEL_FEATURES.MEMORIES_INITIAL_GENERATION_SYSTEM]: 3,
  [MODEL_FEATURES.MEMORIES_INITIAL_GENERATION_USER]: 3,
  [MODEL_FEATURES.MEMORIES_DEDUPLICATION_SYSTEM]: 1,
  [MODEL_FEATURES.MEMORIES_DEDUPLICATION_USER]: 1,
  [MODEL_FEATURES.MEMORIES_QUALITY_AND_SENSITIVITY_FILTER_SYSTEM]: 1,
  [MODEL_FEATURES.MEMORIES_QUALITY_AND_SENSITIVITY_FILTER_USER]: 1,
  // memories usage feature versions
  [MODEL_FEATURES.MEMORIES_MESSAGE_CLASSIFICATION_SYSTEM]: 1,
  [MODEL_FEATURES.MEMORIES_MESSAGE_CLASSIFICATION_USER]: 1,
  [MODEL_FEATURES.MEMORIES_RELEVANT_CONTEXT]: 2,
  // real-time-context fragments
  [MODEL_FEATURES.REAL_TIME_CONTEXT_DATE]: 1,
  [MODEL_FEATURES.REAL_TIME_CONTEXT_TAB]: 1,
  [MODEL_FEATURES.REAL_TIME_CONTEXT_MENTIONS]: 1,
});

/**
 * Remote Settings configuration record structure
 *
 * @typedef {object} RemoteSettingsConfig
 * @property {string} feature - Feature identifier
 * @property {string} model - Model identifier for LLM inference
 * @property {string} prompts - Prompt template content
 * @property {string} version - Version string in "v{major}.{minor}" format
 * @property {boolean} [is_default] - Whether this is the default config for the feature
 * @property {object} [parameters] - Optional inference parameters (e.g., temperature)
 * @property {string[]} [additional_components] - Optional list of dependent feature configs
 */

/**
 * @typedef {object} RemoteSettingsClient
 * @property {() => Promise<object[]>} get - Function to get records from remote settings
 */

/**
 * Parses a version string in the format "{major}.{minor}".
 *
 * @param {string} versionString - Version string to parse (e.g., "1.2")
 * @returns {object|null} Parsed version with major and minor numbers, or null if invalid
 */
export function parseVersion(versionString) {
  const match = /^v?(\d+)\.(\d+)$/.exec(versionString || "");
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    original: versionString,
  };
}

/**
 * Verifies that the RS record matches the current Fx build
 *
 * @param {string} recordVersion {majorVersion}.{minorVersion}
 * @param {string} comparisonVersion major version supported by this build
 * @returns {boolean} whether or not major version in recordVersion matches comparisonVersion
 */
export function checkMajorVersion(recordVersion, comparisonVersion) {
  const parsed = parseVersion(recordVersion);
  return parsed && parsed.major == comparisonVersion;
}

/*
 * Fallback model data - matches Remote Settings shape
 * Used when Remote Settings lookup fails
 */
export const FALLBACK_MODELS = {
  0: { model: "custom-model", ownerName: "", labelId: "custom" },
  1: {
    model: "gemini-3.1-flash-lite",
    ownerName: "Google",
    labelId: "fast",
  },
  2: {
    model: "qwen3-235b-a22b-instruct-2507-maas",
    ownerName: "Alibaba",
    labelId: "allpurpose",
  },
  3: {
    model: "gpt-oss-120b",
    ownerName: "OpenAI",
    labelId: "personal",
  },
};

/**
 * Selects the main configuration for a feature based on version and model preferences.
 *
 * Remote Settings maintains only the latest minor version for each (feature, model, major_version) combination.
 *
 * Selection logic:
 * 1. Filter to configs matching the required major version
 * 2. If user has model preference, find that model's config
 * 3. Otherwise, find the default config (is_default: true)
 *
 * @param {Array} featureConfigs - All configs for the feature from Remote Settings
 * @param {object} options - Selection options
 * @param {number} options.majorVersion - Required major version for the feature
 * @param {string} options.userModel - User's preferred model (empty string if none)
 * @param {string} options.modelChoiceId
 * @param {string} options.feature
 * @returns {object|null} Selected config or null if no match
 */
export function selectMainConfig(
  featureConfigs,
  { majorVersion, userModel, modelChoiceId, feature }
) {
  // Filter to configs matching the required major version
  const sameMajor = featureConfigs.filter(config =>
    checkMajorVersion(config.version, majorVersion)
  );

  if (sameMajor.length === 0) {
    console.warn(`Missing featureConfigs for major version ${majorVersion}`);
    return null;
  }

  // We only allow customization of main assistant model ("chat" feature)
  // We figure out which model the user wants and load prompts for that model
  // If we can't find a config for the user selection, we load the generic one
  if (feature === MODEL_FEATURES.CHAT) {
    if (modelChoiceId !== "0") {
      // First check the choice ID. If it's not 0, use the model associated with that ID

      // Look for config based on model choice ID
      const userModelConfig = sameMajor.find(
        config => config.model_choice_id == modelChoiceId
      );
      // Return if we found it
      if (userModelConfig) {
        return userModelConfig;
      }
      // Config for user's model choice ID not found in this major version - fall through to generic
      console.warn(
        `User model choice "${modelChoiceId}" not found for major version ${majorVersion} for feature '${feature}', using generic`
      );
    } else {
      // If the choice ID is 0 or null, check the provided model name

      // Look for config based on the user-provided model name
      // This is the case where the user provides a model name for which we have a fine-tuned prompt
      const userModelConfig = sameMajor.find(
        config => config.model === userModel
      );
      // Return if we found it
      if (userModelConfig) {
        return userModelConfig;
      }
      // Config for user-provided model name not found in this major version - fall through to generic
      console.warn(
        `User model "${userModel}" not found for major version ${majorVersion} for feature '${feature}', using generic`
      );
    }

    // If both cases above failed, load the generic config
    const genericConfig = sameMajor.find(
      config => config.model === GENERIC_MODEL_NAME
    );
    // Inject the user model if one was provided
    // If one wasn't, we return the generic config plain, which will intentionally break inference
    if (userModel) {
      genericConfig.model = userModel;
    }
    return genericConfig;
  }

  // **For all features other than "chat"**
  // If no user model pref OR user's model not found: use default
  const defaultConfig = sameMajor.find(config => config.is_default === true);
  if (defaultConfig) {
    return defaultConfig;
  }

  // No default found - this shouldn't happen with proper Remote Settings data
  console.warn(`No default config found for major version ${majorVersion}`);
  return null;
}

/**
 * openAIEngine class
 *
 * Contains methods to create engine instances and estimate token usage.
 */
export class openAIEngine {
  /**
   * Exposing createEngine for testing purposes.
   */
  static _createEngine = createEngine;

  /**
   *  The Remote Settings collection name for AI window prompt configurations
   */
  static RS_AI_WINDOW_COLLECTION = "ai-window-prompts";

  /**
   * Cached Remote Settings client
   * Cache is invalidated when user changes MODEL_PREF pref via modelPrefObserver
   *
   * @type {RemoteSettingsClient | null}
   */
  static _remoteClient = null;

  /**
   * Main feature name. Retained on the instance so _recreateEngine() can
   * rebuild after 401 retry without the caller re-supplying it.
   *
   * @type {string | null}
   */
  feature = null;

  /**
   * Resolved model name for LLM inference. Retained on the instance for
   * _recreateEngine() (same reason as `feature`).
   *
   * @type {string | null}
   */
  model = null;

  /**
   * Engine ID used for creating the engine instance
   *
   * @type {string | null}
   */
  #engineId = null;

  /**
   * Service type used for creating the engine instance
   *
   * @type {string | null}
   */
  #serviceType = null;

  /**
   * Purpose used for creating the engine instance
   *
   * @type {string | null}
   */
  #purpose = null;

  /**
   * Flow ID for correlating frontend and backend telemetry.
   *
   * @type {string | null}
   */
  #flowId = null;

  /**
   * Base URL for this engine instance. Resolved during build time from
   * the selected model choice.
   *
   * @type {string | null}
   */
  #baseURL = null;

  /**
   * Resolved API key for this engine instance.
   *
   * @type {string | null}
   */
  #apiKey = null;

  /**
   * Gets the Remote Settings client for AI window configurations.
   *
   * @returns {RemoteSettingsClient}
   */
  static getRemoteClient() {
    if (openAIEngine._remoteClient) {
      return openAIEngine._remoteClient;
    }

    const client = lazy.RemoteSettings(openAIEngine.RS_AI_WINDOW_COLLECTION, {
      bucketName: "main",
    });
    client.on("sync", async () => {
      try {
        await refreshModelsDataCache();
      } catch (e) {
        console.error("Failed to refresh models cache on sync", e);
      }
    });

    openAIEngine._remoteClient = client;
    return client;
  }

  /**
   * Checks whether a custom endpoint is configured via pref.
   *
   * @returns {boolean} True if the endpoint pref has a user-set value.
   */
  static hasCustomEndpoint() {
    return Services.prefs.prefHasUserValue(CUSTOM_ENDPOINT_PREF);
  }

  /**
   * Whether the current engine instance uses a custom model endpoint.
   *
   * @returns {boolean}
   */
  get isCustomEndpoint() {
    return this.#baseURL !== null && this.#baseURL !== openAIEngine.endpoint;
  }

  /**
   * Returns the endpoint and API key for a model choice.
   *
   * @param {string} [modelChoiceId] - Selected model choice id
   * @returns {{baseURL: string, apiKey: string}}
   * @throws {Error} If the custom model choice is selected but not configured.
   */
  static resolveEndpointConfig(modelChoiceId) {
    if (modelChoiceId === CUSTOM_MODEL_CHOICE_ID) {
      const baseURL = Services.prefs.getStringPref(CUSTOM_ENDPOINT_PREF, "");
      if (!baseURL) {
        throw new Error("Custom model choice selected but not configured");
      }
      return {
        baseURL,
        apiKey: Services.prefs.getStringPref(APIKEY_PREF, ""),
      };
    }
    return { baseURL: openAIEngine.endpoint, apiKey: "" };
  }

  /**
   * Builds an openAIEngine instance.
   *
   * @param {object} options
   * @param {string} options.model
   * @param {string} options.serviceType
   * @param {string} options.purpose
   * @param {string|null} [options.flowId]
   * @param {string} options.feature
   * @param {string} [options.baseURL] - Endpoint base URL
   * @param {string} [options.apiKey] - API key for the endpoint
   * @returns {Promise<openAIEngine>}
   */
  static async build({
    model,
    serviceType,
    purpose,
    flowId,
    feature,
    baseURL = openAIEngine.endpoint,
    apiKey = "",
  }) {
    const engine = new openAIEngine();
    const engineId = `${DEFAULT_ENGINE_ID}-${feature}-${model}`;
    engine.#engineId = engineId;
    engine.feature = feature;
    engine.model = model;
    engine.#serviceType = serviceType;
    engine.#purpose = purpose;
    engine.#flowId = flowId;
    engine.#baseURL = baseURL;
    engine.#apiKey = apiKey;
    engine.engineInstance = await openAIEngine.#createOpenAIEngine(
      engineId,
      serviceType,
      purpose,
      model,
      flowId,
      feature,
      baseURL,
      apiKey
    );
    return engine;
  }

  /**
   * Retrieves the Firefox account token
   *
   * @returns {Promise<string|null>}   The Firefox account token (string) or null
   */
  static async getFxAccountToken() {
    try {
      const fxAccounts = lazy.getFxAccountsSingleton();
      return await fxAccounts.getOAuthToken({
        scope: [SCOPE_SMART_WINDOW, SCOPE_PROFILE_UID],
        client_id: OAUTH_CLIENT_ID,
      });
    } catch (error) {
      console.warn("Error obtaining FxA token:", error);
      return null;
    }
  }

  /**
   * Checks if an error is an HTTP 429 from MLPA. MLPA returns 429 for several
   * sub-conditions (budget overage, QPS rate limit, upstream limit, etc.)
   * callers should back off the same way regardless of the sub-code.
   *
   * @param {Error} error  The error to check
   * @returns {boolean}    True if the error is a 429
   */
  static is429Error(error) {
    if (!error) {
      return false;
    }
    return error.status === 429 || !!error.message?.includes("429 status code");
  }

  /**
   * Creates an OpenAI engine instance
   *
   * @param {string} engineId - The identifier for the engine instance
   * @param {string} serviceType - The type of message to be sent ("ai", "memories", "s2s")
   * @param {string} purpose - The purpose of the request, used for telemetry tracking
   * @param {string | null} modelId - The resolved model ID (already contains fallback logic)
   * @param {string | null} flowId - Flow ID for correlating frontend and backend telemetry
   * @param {string | null} featureId - Feature name passed to PipelineOptions
   * @param {string} baseURL - The endpoint base URL for this engine instance
   * @param {string} apiKey - The API key for this engine instance
   * @returns {Promise<object>} - The configured engine instance
   */
  static async #createOpenAIEngine(
    engineId,
    serviceType,
    purpose,
    modelId = null,
    flowId = null,
    featureId = null,
    baseURL,
    apiKey
  ) {
    const extraHeadersPref = Services.prefs.getStringPref(
      "browser.smartwindow.extraHeaders",
      "{}"
    );
    let extraHeaders = {};
    try {
      extraHeaders = JSON.parse(extraHeadersPref);
    } catch (e) {
      console.error("Failed to parse extra headers from prefs:", e);
      Services.prefs.clearUserPref("browser.smartwindow.extraHeaders");
    }

    try {
      const engineInstance = await openAIEngine._createEngine({
        apiKey,
        backend: "openai",
        baseURL,
        engineId,
        featureId,
        flowId,
        modelId,
        modelRevision: "main",
        taskName: "text-generation",
        serviceType,
        purpose,
        extraHeaders,
      });
      return engineInstance;
    } catch (error) {
      console.error("Failed to create OpenAI engine:", error);
      throw error;
    }
  }

  /**
   * Wrapper around engine.run to send message to the LLM
   * Will eventually use `usage` from the LiteLLM API response for token telemetry
   *
   * @param {Map<string, any>} content  OpenAI formatted messages to be sent to the LLM
   * @returns {object}                  LLM response
   */
  async run(content) {
    return await this._runWithAuth(content);
  }

  /**
   * Helper method to handle 401 authentication errors and retry with new token.
   *
   * @param {Map<string, any>} content  OpenAI formatted messages to be sent to the LLM
   * @returns {object}                  LLM response
   */
  async _runWithAuth(content) {
    try {
      return await this.engineInstance.run(content);
    } catch (ex) {
      // Skip the token retry flow when using a custom endpoint,
      // as the retry logic only applies to FxAccounts tokens.
      if (!this._is401Error(ex) || this.isCustomEndpoint) {
        throw ex;
      }

      console.warn(
        "LLM request returned a 401 - revoking our token and retrying"
      );

      const fxAccounts = lazy.getFxAccountsSingleton();
      const oldToken = content.fxAccountToken;
      if (oldToken) {
        await fxAccounts.removeCachedOAuthToken({ token: oldToken });
      }

      await this._recreateEngine();

      const newToken = await openAIEngine.getFxAccountToken();
      const updatedContent = { ...content, fxAccountToken: newToken };

      try {
        return await this.engineInstance.run(updatedContent);
      } catch (retryEx) {
        if (!this._is401Error(retryEx)) {
          throw retryEx;
        }

        console.warn(
          "Retry LLM request still returned a 401 - revoking our token and failing"
        );

        if (newToken) {
          await fxAccounts.removeCachedOAuthToken({ token: newToken });
        }

        throw retryEx;
      }
    }
  }

  /**
   * Recreates the engine instance with current configuration.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _recreateEngine() {
    if (!this.#engineId || !this.#serviceType) {
      console.warn("Cannot recreate engine: missing engineId or serviceType");
      return;
    }

    this.engineInstance = await openAIEngine.#createOpenAIEngine(
      this.#engineId,
      this.#serviceType,
      this.#purpose,
      this.model,
      this.#flowId,
      this.feature,
      this.#baseURL,
      this.#apiKey
    );
  }

  /**
   * Checks if an error is a 401 authentication error.
   *
   * @param {Error} error  The error to check
   * @returns {boolean}    True if the error is a 401 error
   * @private
   */
  _is401Error(error) {
    if (!error) {
      return false;
    }

    return error.status === 401 || error.message?.includes("401 status code");
  }

  /**
   * Helper async generator to handle 401 authentication errors and retry with new token for streaming requests.
   *
   * @param {Map<string, any>} options  OpenAI formatted messages with streaming and tooling options to be sent to the LLM
   * @yields {object}                   LLM streaming response chunks
   */
  async *_runWithGeneratorAuth(options) {
    // Extract signal before passing options to engineInstance — AbortSignal
    // cannot be cloned via postMessage (structured clone algorithm).
    const { signal, ...engineOptions } = options;
    try {
      const generator = this.engineInstance.runWithGenerator(engineOptions);
      for await (const chunk of generator) {
        if (signal?.aborted) {
          return;
        }
        yield chunk;
      }
    } catch (ex) {
      // Skip the token retry flow when using a custom endpoint,
      // as the retry logic only applies to FxAccounts tokens.
      if (!this._is401Error(ex) || this.isCustomEndpoint) {
        throw ex;
      }

      console.warn(
        "LLM streaming request returned a 401 - revoking our token and retrying"
      );

      const fxAccounts = lazy.getFxAccountsSingleton();
      const oldToken = options.fxAccountToken;
      if (oldToken) {
        await fxAccounts.removeCachedOAuthToken({ token: oldToken });
      }

      await this._recreateEngine();

      const newToken = await openAIEngine.getFxAccountToken();
      const updatedOptions = { ...engineOptions, fxAccountToken: newToken };

      try {
        const generator = this.engineInstance.runWithGenerator(updatedOptions);
        for await (const chunk of generator) {
          if (signal?.aborted) {
            return;
          }
          yield chunk;
        }
      } catch (retryEx) {
        if (!this._is401Error(retryEx)) {
          throw retryEx;
        }

        console.warn(
          "Retry LLM streaming request still returned a 401 - revoking our token and failing"
        );

        if (newToken) {
          await fxAccounts.removeCachedOAuthToken({ token: newToken });
        }

        throw retryEx;
      }
    }
  }

  /**
   * Wrapper around engine.runWithGenerator to send message to the LLM
   * Will eventually use `usage` from the LiteLLM API response for token telemetry
   *
   * @param {Map<string, any>} options  OpenAI formatted messages with streaming and tooling options to be sent to the LLM
   * @returns {AsyncGenerator}          LLM streaming response
   */
  runWithGenerator(options) {
    return this._runWithGeneratorAuth(options);
  }
}

XPCOMUtils.defineLazyPreferenceGetter(
  openAIEngine,
  "endpoint",
  ENDPOINT_PREF,
  DEFAULT_ENDPOINT
);

XPCOMUtils.defineLazyPreferenceGetter(openAIEngine, "apiKey", APIKEY_PREF, "");

/**
 * Resolves chat model metadata for a given choice ID from Remote Settings.
 *
 * @param {string} choiceId - Model choice ID (e.g., "1", "2", "3")
 * @param {number} [maxMajorVersion] - Maximum major version to include
 * @returns {Promise<{model: string, ownerName: string}|null>}
 *   Returns null if choice ID not found in Remote Settings
 */
export async function resolveChatModelChoice(
  choiceId,
  maxMajorVersion = FEATURE_MAJOR_VERSIONS[MODEL_FEATURES.CHAT]
) {
  if (choiceId === "0") {
    // Custom model - no RS lookup needed
    return {
      model: "custom-model",
      ownerName: "",
    };
  }

  try {
    const client = openAIEngine.getRemoteClient();
    const allRecords = await client.get();

    const record = selectMainConfig(
      allRecords.filter(r => r.feature === MODEL_FEATURES.CHAT),
      {
        majorVersion: maxMajorVersion,
        feature: MODEL_FEATURES.CHAT,
        modelChoiceId: choiceId,
      }
    );
    if (!record) {
      return null;
    }

    return {
      model: record.model,
      ownerName: record.owner_name ?? "",
    };
  } catch (error) {
    console.warn(
      "Failed to resolve chat model choice from Remote Settings:",
      error
    );
    return null;
  }
}

/**
 * Gets model metadata for a choice ID, with fallback
 *
 * @param {string} choiceId - Model choice ID (e.g., "1", "2", "3", "0")
 * @returns {Promise<{model: string, ownerName: string}|null>} null if choiceId is falsy
 */
export async function getModelForChoice(choiceId = getCurrentModelChoiceId()) {
  if (!choiceId) {
    return null;
  }

  const labelId = FALLBACK_MODELS[choiceId]?.labelId;
  const resolved = await resolveChatModelChoice(choiceId);
  if (resolved) {
    return { ...resolved, labelId };
  }

  if (choiceId in FALLBACK_MODELS) {
    return FALLBACK_MODELS[choiceId];
  }

  return { model: "unknown", ownerName: "unknown" };
}

/**
 *
 * @type {{[key: string]: {model: string, ownerName: string}}|null}
 * holds model metadata -- this should replace FALLBACK_MODELS where sync calls are needed
 * see getCachedModelsData() below
 */
let _modelsDataCache = null;

export async function refreshModelsDataCache() {
  _modelsDataCache = null;
  await getAllModelsData();
}

/**
 * Gets metadata for all models, with fallback. Result is cached after first call.
 *
 * @returns {Promise<{[key: string]: {model: string, ownerName: string}}>}
 */
export async function getAllModelsData() {
  if (_modelsDataCache) {
    return _modelsDataCache;
  }
  const modelData = { ...FALLBACK_MODELS };
  // RS reads from a local dump. Only the first call sets up RS state,
  // subsequent calls are cached
  const entries = await Promise.all(
    ["1", "2", "3"].map(async id => [id, await getModelForChoice(id)])
  );
  for (const [id, data] of entries) {
    // Preserve labelId from fallback when merging with RS data
    modelData[id] = { ...data, labelId: FALLBACK_MODELS[id]?.labelId };
  }
  _modelsDataCache = modelData;
  return _modelsDataCache;
}

/**
 * Returns cached model data synchronously, or FALLBACK_MODELS if not yet fetched.
 *
 * @returns {{[key: string]: {model: string, ownerName: string}}}
 */
export function getCachedModelsData() {
  return _modelsDataCache ?? FALLBACK_MODELS;
}

export function getCurrentModelName() {
  return getCachedModelsData()[getCurrentModelChoiceId()]?.model ?? "";
}

export function getCurrentModelChoiceId() {
  return Services.prefs.getStringPref(MODEL_CHOICE_PREF, "");
}

/**
 * Clearls ModelsDataCache -- mostly used for testing
 */
export function _clearModelsDataCacheForTesting() {
  _modelsDataCache = null;
}

/**
 * Renders a prompt from a string, replacing placeholders with provided strings.
 *
 * @param {string} rawPromptContent               The raw prompt as a string
 * @param {Map<string, string>} stringsToReplace  A map of placeholder strings to their replacements
 * @returns {Promise<string>}                     The rendered prompt
 */
export function renderPrompt(rawPromptContent, stringsToReplace = {}) {
  let finalPromptContent = rawPromptContent;

  for (const [orig, repl] of Object.entries(stringsToReplace)) {
    const regex = new RegExp(`{${orig}}`, "g");
    finalPromptContent = finalPromptContent.replace(regex, () => repl);
  }

  return finalPromptContent;
}
