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
  // Live /v1/models is authoritative for model IDs (Hermes-style live-first), but
  // the OpenAI-compatible endpoint omits context_window — enrich from the static
  // catalog below (sourced from Ollama's native /api/show) and fall back to the
  // native /api/show endpoint for models not yet in the catalog.
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
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextWindow: 524288 },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1048576 },
      { id: 'kimi-k2.5', label: 'Kimi K2.5', contextWindow: 262144 },
      { id: 'kimi-k2.6', label: 'Kimi K2.6', contextWindow: 262144 },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', contextWindow: 262144 },
      { id: 'glm-5.1', label: 'GLM 5.1', contextWindow: 202752 },
      { id: 'glm-5.2', label: 'GLM 5.2', contextWindow: 1000000 },
      { id: 'minimax-m2.5', label: 'MiniMax M2.5', contextWindow: 196608 },
      { id: 'minimax-m2.7', label: 'MiniMax M2.7', contextWindow: 196608 },
      { id: 'minimax-m3', label: 'MiniMax M3', contextWindow: 524288, supportsVision: true },
      { id: 'nemotron-3-nano:30b', label: 'Nemotron 3 Nano 30B', contextWindow: 262144 },
      { id: 'nemotron-3-super', label: 'Nemotron 3 Super', contextWindow: 262144 },
      { id: 'nemotron-3-ultra', label: 'Nemotron 3 Ultra', contextWindow: 262144 },
      { id: 'gemma4:31b', label: 'Gemma 4 31B', contextWindow: 262144 },
      { id: 'qwen3.5:397b', label: 'Qwen 3.5 397B', contextWindow: 262144 },
      { id: 'gpt-oss:20b', label: 'GPT-OSS 20B', contextWindow: 131072 },
      { id: 'gpt-oss:120b', label: 'GPT-OSS 120B', contextWindow: 131072 },
      { id: 'mistral-large-3:675b', label: 'Mistral Large 3 675B', contextWindow: 262144 },
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
