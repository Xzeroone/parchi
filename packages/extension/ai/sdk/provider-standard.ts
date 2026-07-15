// Standard provider resolution (non-OAuth, non-proxy)
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { normalizeOpenRouterModelId } from './model-normalize.js';
import type { SDKModelSettings } from './provider-types.js';
import { buildAnthropicCompatibleHeaders, toAnthropicBaseUrl } from './provider-utils.js';

export function resolveAnthropicCompatibleProvider(
  provider: string,
  settings: SDKModelSettings,
  apiKey: string,
  extraHeaders: Record<string, string> | undefined,
  modelId: string,
) {
  const fallbackBase =
    provider === 'glm'
      ? 'https://api.z.ai/api/anthropic'
      : provider === 'minimax'
        ? 'https://api.minimax.io/anthropic'
        : 'https://api.kimi.com/coding';
  return createAnthropic({
    apiKey,
    baseURL: toAnthropicBaseUrl(settings.customEndpoint || fallbackBase),
    headers: buildAnthropicCompatibleHeaders(provider, apiKey, extraHeaders),
  })(modelId);
}

export function resolveOpenRouterProvider(
  _provider: string,
  apiKey: string,
  extraHeaders: Record<string, string> | undefined,
  modelId: string,
) {
  const openRouterProvider = createOpenAICompatible({
    name: 'openrouter',
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    headers: { ...extraHeaders, 'HTTP-Referer': 'https://parchi.app', 'X-Title': 'Parchi' },
  });
  return openRouterProvider(normalizeOpenRouterModelId(modelId));
}
