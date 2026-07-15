/** Pull displayable identity from an OIDC id_token JWT (email / name / sub). */
export function extractIdentityFromIdToken(idToken?: string): { email?: string; accountId?: string } {
  if (!idToken) return {};
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return {};
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    const email =
      (typeof payload.email === 'string' && payload.email) ||
      (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
      (typeof payload.name === 'string' && payload.name) ||
      undefined;
    const accountId =
      (typeof payload.sub === 'string' && payload.sub) ||
      (typeof payload.name === 'string' && payload.name) ||
      undefined;
    return { email: email || undefined, accountId: accountId || undefined };
  } catch {
    return {};
  }
}
