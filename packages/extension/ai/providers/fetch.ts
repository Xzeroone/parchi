// Model fetching for providers
import { extractModelEntries, fetchWithTimeout } from './model-listing.js';
import type { ModelEntry, ProviderCredentials, ProviderDefinition } from './types.js';

export interface FetchedModelsResult {
  /** Discovered model entries (empty when listing failed). */
  models: ModelEntry[];
  /** True when the models came from a live API response; false when they are
   * the static fallback list (listing unsupported, no credentials, or fetch
   * error/timeout). Callers can use this to decide live-first merging. */
  live: boolean;
}

export async function fetchModelsForProvider(
  def: ProviderDefinition,
  credentials: ProviderCredentials,
): Promise<ModelEntry[]> {
  const result = await fetchModelsForProviderDetailed(def, credentials);
  return result.models;
}

export async function fetchModelsForProviderDetailed(
  def: ProviderDefinition,
  credentials: ProviderCredentials,
): Promise<FetchedModelsResult> {
  const staticFallback = def.models || [];

  if (!def.supportsModelListing) {
    return { models: staticFallback, live: false };
  }

  const apiKey = credentials.oauthAccessToken || credentials.apiKey || '';
  if (!apiKey) return { models: staticFallback, live: false };

  const baseURL = (credentials.customEndpoint || def.defaultBaseUrl).replace(/\/+$/, '');
  if (!baseURL) return { models: staticFallback, live: false };

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...def.defaultHeaders,
    ...credentials.extraHeaders,
  };

  if (def.authHeaderStyle === 'x-api-key') {
    headers['X-Api-Key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const endpoint = def.modelsEndpoint || '/models';
  let base = baseURL;
  if (base.endsWith('/v1') && endpoint.startsWith('/v1/')) {
    base = base.slice(0, -3);
  }

  try {
    const response = await fetchWithTimeout(`${base}${endpoint}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) {
      console.warn(`[provider-registry] ${def.key} model fetch returned ${response.status}`);
      return { models: staticFallback, live: false };
    }
    const data = await response.json();
    const models = extractModelEntries(data, def.key);
    return models.length > 0 ? { models, live: true } : { models: staticFallback, live: false };
  } catch (err) {
    console.warn(`[provider-registry] Failed to fetch models for ${def.key}:`, err);
    return { models: staticFallback, live: false };
  }
}
