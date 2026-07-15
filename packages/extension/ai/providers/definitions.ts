// Provider definitions and registry
import { OAUTH_PROVIDERS } from '../../oauth/providers.js';
import type { ProviderDefinition } from './types.js';

export const PROVIDER_REGISTRY: Record<string, ProviderDefinition> = {
  'xai-oauth': {
    key: 'xai-oauth',
    name: 'Grok',
    type: 'oauth',
    sdkType: 'openai-compatible',
    defaultBaseUrl: 'https://api.x.ai/v1',
    authHeaderStyle: 'bearer',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    oauth: OAUTH_PROVIDERS.xai,
    models: OAUTH_PROVIDERS.xai?.models,
  },
};

export function getProviderDefinition(key: string): ProviderDefinition | null {
  return PROVIDER_REGISTRY[key] || null;
}

export function getAllProviders(): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY);
}

export function getApiKeyProviders(): ProviderDefinition[] {
  return getAllProviders().filter((p) => p.type === 'api-key');
}

export function getOAuthProviders(): ProviderDefinition[] {
  return getAllProviders().filter((p) => p.type === 'oauth');
}
