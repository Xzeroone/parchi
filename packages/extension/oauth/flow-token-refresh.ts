import type { OAuthProviderConfig, OAuthTokenSet } from './types.js';

/**
 * Refresh a Qwen/xAI-style token using the refresh_token grant.
 */
export async function refreshQwenToken(config: OAuthProviderConfig, refreshToken: string): Promise<OAuthTokenSet> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Qwen token refresh failed (${response.status}): ${text}`);
  }

  const data: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    resource_url?: string;
  } = await response.json();
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 0;
  return {
    accessToken: String(data.access_token || ''),
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    tokenType: data.token_type || 'Bearer',
    resourceUrl: data.resource_url,
    raw: data as Record<string, unknown>,
  };
}
