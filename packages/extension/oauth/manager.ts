import { type DeviceCodeFlowCallbacks, runDeviceCodeFlow } from './flow-device-code.js';
import { refreshQwenToken } from './flow-token-refresh.js';
import { OAUTH_PROVIDERS } from './providers.js';
import {
  disconnectProvider,
  getProviderState,
  saveProviderTokens,
  setProviderError,
  updateProviderTokens,
} from './store.js';
import type { DeviceCodeResponse, OAuthProviderKey, OAuthProviderState, OAuthTokenSet } from './types.js';

import { prioritizeOAuthModelCandidates } from './model-candidates.js';
import {
  fetchOpenAICompatibleModelEntries,
  fetchOpenAICompatibleModels,
  getStaticOAuthModelIds,
} from './model-listing.js';
import { normalizeOAuthModelIdsForProvider } from './model-normalization.js';

export type { OAuthProviderKey, OAuthProviderState, OAuthTokenSet, DeviceCodeResponse };
export { OAUTH_PROVIDERS } from './providers.js';
export { getAllProviderStates, getConnectedProviders } from './store.js';

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const activeFlows = new Map<string, AbortController>();

export function getProviderConfig(key: OAuthProviderKey) {
  return OAUTH_PROVIDERS[key] || null;
}

export async function connectProvider(
  key: OAuthProviderKey,
  callbacks?: {
    onDeviceCode?: (response: DeviceCodeResponse) => void;
  },
): Promise<OAuthTokenSet> {
  const config = OAUTH_PROVIDERS[key];
  if (!config) throw new Error(`Unknown OAuth provider: ${key}`);

  // Cancel any active flow for this provider
  const existing = activeFlows.get(key);
  if (existing) existing.abort();

  const controller = new AbortController();
  activeFlows.set(key, controller);

  try {
    let tokens: OAuthTokenSet;

    // xAI uses device_code flow
    const deviceCallbacks: DeviceCodeFlowCallbacks = {
      onDeviceCode: (response) => callbacks?.onDeviceCode?.(response),
    };
    tokens = await runDeviceCodeFlow(config, deviceCallbacks, controller.signal);

    await saveProviderTokens(key, tokens);
    return tokens;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!controller.signal.aborted) {
      await setProviderError(key, message);
    }
    throw error;
  } finally {
    activeFlows.delete(key);
  }
}

export function cancelConnection(key: OAuthProviderKey): void {
  const controller = activeFlows.get(key);
  if (controller) {
    controller.abort();
    activeFlows.delete(key);
  }
}

export async function disconnect(key: OAuthProviderKey): Promise<void> {
  cancelConnection(key);
  await disconnectProvider(key);
}

/**
 * Get a valid access token for a provider, refreshing if needed.
 * Returns null if the provider is not connected.
 */
export async function getAccessToken(key: OAuthProviderKey): Promise<string | null> {
  const state = await getProviderState(key);
  if (!state?.connected || !state.tokens) return null;

  const tokens = state.tokens;
  const isExpired = tokens.expiresAt && tokens.expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS;

  if (!isExpired) return tokens.accessToken;

  // Token is expired or about to expire -- refresh
  try {
    const config = OAUTH_PROVIDERS[key];
    if (!config) return null;

    if (key === 'xai' && tokens.refreshToken) {
      const refreshed = await refreshQwenToken(config, tokens.refreshToken);
      await updateProviderTokens(key, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        resourceUrl: refreshed.resourceUrl,
      });
      return refreshed.accessToken;
    }

    // No refresh mechanism available
    return tokens.accessToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setProviderError(key, `Token refresh failed: ${message}`);
    return null;
  }
}

/**
 * Get the API base URL for a provider. xAI uses a static URL.
 */
export async function getApiBaseUrl(key: OAuthProviderKey): Promise<string | null> {
  const config = OAUTH_PROVIDERS[key];
  if (!config) return null;
  return config.apiBaseUrl || null;
}

/**
 * Fetch available models from an OAuth provider's API using the stored access token.
 * Returns model IDs, or falls back to static list on failure.
 */
export async function fetchProviderModels(key: OAuthProviderKey): Promise<string[]> {
  const result = await fetchProviderModelsDetailed(key);
  return result.models;
}

export interface OAuthFetchResult {
  /** Model IDs discovered (or static fallback on failure). */
  models: string[];
  /** True when the models came from a live API response. */
  live: boolean;
}

/**
 * Detailed variant that reports whether the returned models are live or the
 * static fallback. Callers that want live-first merging should use this.
 */
export async function fetchProviderModelsDetailed(key: OAuthProviderKey): Promise<OAuthFetchResult> {
  const config = OAUTH_PROVIDERS[key];
  if (!config) return { models: [], live: false };

  const accessToken = await getAccessToken(key);
  const staticModels = normalizeOAuthModelIdsForProvider(key, getStaticOAuthModelIds(config));
  if (!accessToken) return { models: staticModels, live: false };

  try {
    let models: string[] = [];

    if (key === 'xai') {
      const apiBase = config.apiBaseUrl;
      if (apiBase) {
        const entries = await fetchOpenAICompatibleModelEntries(accessToken, apiBase);
        if (entries.length > 0) {
          models = entries.map((e) => e.id);
        } else {
          models = await fetchOpenAICompatibleModels(accessToken, apiBase);
        }
      }
    }

    const discoveredModels = normalizeOAuthModelIdsForProvider(key, models);
    if (discoveredModels.length > 0) {
      const prioritizedModels = prioritizeOAuthModelCandidates(key, discoveredModels, staticModels);
      if (prioritizedModels.length > 0) {
        return { models: prioritizedModels, live: true };
      }
    }
    return { models: staticModels, live: false };
  } catch (err) {
    console.warn(`[OAuth] Failed to fetch models for ${key}:`, err);
    return { models: staticModels, live: false };
  }
}
