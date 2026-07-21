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
  // OpenAI-compatible cloud API (https://ollama.com/v1). Keys from ollama.com/settings/keys.
  'ollama-cloud': {
    key: 'ollama-cloud',
    name: 'Ollama Cloud',
    type: 'api-key',
    sdkType: 'openai-compatible',
    defaultBaseUrl: 'https://ollama.com/v1',
    authHeaderStyle: 'bearer',
    supportsModelListing: true,
    modelsEndpoint: '/models',
    models: [
      { id: 'gpt-oss:120b', label: 'GPT-OSS 120B', contextWindow: 131072 },
      { id: 'qwen3-coder:480b', label: 'Qwen 3 Coder 480B', contextWindow: 131072 },
      { id: 'deepseek-v3.1:671b', label: 'DeepSeek V3.1 671B', contextWindow: 131072 },
      { id: 'kimi-k2:1t', label: 'Kimi K2 1T', contextWindow: 131072 },
      { id: 'glm-4.6', label: 'GLM 4.6', contextWindow: 131072 },
      { id: 'minimax-m2', label: 'MiniMax M2', contextWindow: 131072 },
    ],
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
