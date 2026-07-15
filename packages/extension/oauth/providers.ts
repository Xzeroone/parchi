import type { OAuthProviderConfig } from './types.js';

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  xai: {
    key: 'xai',
    name: 'Grok',
    flowType: 'device_code',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    deviceCodeUrl: 'https://auth.x.ai/oauth2/device/code',
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    scopes: 'openid profile email offline_access grok-cli:access api:access',
    extraAuthorizeParams: { referrer: 'hermes-agent', plan: 'generic' },
    apiBaseUrl: 'https://api.x.ai/v1',
    models: [
      { id: 'grok-build-0.1', label: 'Grok Build 0.1', contextWindow: 256000 },
      { id: 'grok-4.3', label: 'Grok 4.3', contextWindow: 256000, supportsVision: true },
      { id: 'grok-4', label: 'Grok 4', contextWindow: 256000, supportsVision: true },
    ],
  },
};

export const OAUTH_PROVIDER_KEYS = Object.keys(OAUTH_PROVIDERS) as Array<keyof typeof OAUTH_PROVIDERS>;
