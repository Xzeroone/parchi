/**
 * chrome.userScripts API wrapper for CSP-exempt script execution.
 *
 * chrome.userScripts.execute (Chrome 135+) runs code in the USER_SCRIPT world,
 * which is exempt from the page's Content Security Policy. This lets evaluate()
 * and waitFor(script) work on CSP-strict pages (social networks, banking, Google
 * apps, etc.) without weakening extension-page CSP.
 *
 * Security: USER_SCRIPT is a less-trusted context. Results are serialized
 * before returning to the extension — never treat them as privileged.
 *
 * Availability notes (per https://developer.chrome.com/docs/extensions/reference/api/userScripts):
 *  - Chrome <138: requires Developer Mode toggle on chrome://extensions.
 *  - Chrome 138+: requires "Allow User Scripts" toggle on the extension's details page.
 *  - When the toggle is off, `chrome.userScripts` is `undefined` and a service-worker
 *    context reload is required after the user enables it.
 *  - The docs-recommended probe is to call a no-op method (getScripts()) and catch,
 *    because the API object can be defined while its methods throw "not enabled".
 */

import {
  type UserScriptPayload,
  buildEvaluateUserScript,
  buildWaitForScriptUserScript,
} from './browser-user-script-builders.js';

export { buildEvaluateUserScript, buildWaitForScriptUserScript, type UserScriptPayload };

/**
 * InjectionResult as returned by chrome.userScripts.execute (Chrome 135+).
 * `result` and `error` are mutually exclusive. Kept here as a minimal local type
 * because @types/chrome (0.0.268) predates the execute() method.
 */
export interface UserScriptInjectionResult {
  frameId: number;
  documentId?: string;
  result?: unknown;
  error?: string;
}

type UserScriptsExecuteApi = {
  execute: (injection: {
    target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
    js: Array<{ code: string }>;
    world?: 'USER_SCRIPT' | 'MAIN';
    injectImmediately?: boolean;
  }) => Promise<UserScriptInjectionResult[]>;
  configureWorld: (properties: {
    csp?: string;
    messaging?: boolean;
  }) => Promise<void>;
  getScripts: () => Promise<unknown>;
};

function getUserScriptsApi(): UserScriptsExecuteApi | null {
  const chromeApi = (globalThis as Record<string, unknown>).chrome as
    | (Record<string, unknown> & { userScripts?: unknown })
    | undefined;
  if (typeof chromeApi !== 'object' || chromeApi === null) return null;
  const us = chromeApi.userScripts as UserScriptsExecuteApi | undefined;
  if (!us || typeof us.execute !== 'function') return null;
  return us;
}

export type UserScriptsAvailability = {
  available: boolean;
  code?: string;
  hint?: string;
};

/**
 * Probe whether userScripts is actually usable. The docs recommend calling a
 * no-op method and catching, because `chrome.userScripts` may be defined while
 * its methods throw "not enabled" on some Chrome versions.
 */
export async function probeUserScriptsAvailability(): Promise<UserScriptsAvailability> {
  const api = getUserScriptsApi();
  if (!api) {
    return {
      available: false,
      code: 'userScripts_api_missing',
      hint: 'chrome.userScripts is not available. On Chrome 138+, open chrome://extensions, open Parchi details, and enable "Allow User Scripts". On older Chrome, enable Developer Mode.',
    };
  }
  try {
    // getScripts() with no args returns all registered scripts; it throws if
    // the toggle is off even when the API object exists.
    await api.getScripts();
    return { available: true };
  } catch {
    return {
      available: false,
      code: 'userScripts_not_enabled',
      hint: 'User Scripts toggle is off. On Chrome 138+, open chrome://extensions, open Parchi details, and enable "Allow User Scripts". On older Chrome, enable Developer Mode, then reload the extension.',
    };
  }
}

export function isUserScriptsAvailable(): boolean {
  return getUserScriptsApi() !== null;
}

export interface UserScriptsStatus {
  available: boolean;
  code?: string;
  hint?: string;
}

/**
 * Synchronous status check (no probe). Use probeUserScriptsAvailability() for
 * the authoritative async check that distinguishes "API missing" from "toggle off".
 */
export function getUserScriptsStatus(): UserScriptsStatus {
  const api = getUserScriptsApi();
  if (!api) {
    return {
      available: false,
      code: 'userScripts_api_missing',
      hint: 'chrome.userScripts API is not available in this browser. Use selector/text-based tools instead, or switch to Chrome 135+ and enable "Allow User Scripts".',
    };
  }
  return { available: true };
}

let worldConfigured = false;

/**
 * Configure the USER_SCRIPT world CSP once per service-worker lifetime.
 * The default USER_SCRIPT CSP forbids eval/Function, which would block the
 * wrapped evaluate/waitFor payloads. We set a permissive CSP that still
 * disallows network fetches (connect-src 'none') but allows inline eval so
 * the injected serializer can run.
 */
async function ensureWorldConfigured(api: UserScriptsExecuteApi): Promise<void> {
  if (worldConfigured) return;
  try {
    await api.configureWorld({
      csp: "script-src 'self' 'unsafe-eval'; object-src 'none'; connect-src 'none'",
    });
    worldConfigured = true;
  } catch {
    // configureWorld may throw on older Chrome that doesn't support CSP config;
    // injection still works with defaults. Stay silent and retry next call would
    // also throw, so mark configured to avoid repeated noise.
    worldConfigured = true;
  }
}

/**
 * Outcome of a userScript injection.
 *  - On API/toggle failure: { success: false, error, code, hint? }
 *  - On injection succeeded + script-internal payload: { success: true, result: UserScriptPayload }
 *  - On injection succeeded but frame reported an error: { success: false, error, code: 'injection_error' }
 */
export type ExecuteUserScriptOutcome =
  | { success: true; result: UserScriptPayload }
  | { success: false; error: string; code: string; hint?: string };

/**
 * Execute a user script in a tab using chrome.userScripts.execute (USER_SCRIPT world).
 * This bypasses page CSP restrictions entirely.
 *
 * Handles the real InjectionResult shape (Chrome 135+):
 *  - results[i].result  → the value the script resolved to (our wrapper payload).
 *  - results[i].error   → per-frame injection error (e.g. "frame was removed").
 * Multiple frames: returns the first success payload, or the first error.
 */
export async function executeUserScript(tabId: number, code: string): Promise<ExecuteUserScriptOutcome> {
  const api = getUserScriptsApi();
  if (!api) {
    const status = getUserScriptsStatus();
    return {
      success: false,
      error: status.hint || 'userScripts not available',
      code: status.code || 'userScripts_unavailable',
      hint: status.hint,
    };
  }

  await ensureWorldConfigured(api);

  try {
    const results = await api.execute({
      target: { tabId },
      js: [{ code }],
      world: 'USER_SCRIPT',
    });

    if (!Array.isArray(results) || results.length === 0) {
      return {
        success: false,
        error: 'userScripts.execute returned no frame results.',
        code: 'userScripts_empty_result',
        hint: 'The tab may be navigating or on a restricted URL (chrome://, etc.).',
      };
    }

    // Prefer the first frame that produced a result; fall back to the first error.
    for (const entry of results) {
      if (entry && typeof entry.result !== 'undefined' && entry.result !== null) {
        const payload = entry.result as UserScriptPayload;
        // The injected wrapper always returns { success: ... } — pass it through.
        if (payload && typeof payload === 'object' && typeof payload.success === 'boolean') {
          return { success: true, result: payload };
        }
        // Unexpected shape (user code returned a non-object) — normalize it.
        return { success: true, result: { success: true, result: payload } };
      }
    }

    // No result field on any frame — surface the first per-frame injection error.
    const errorEntry = results.find((e) => typeof e?.error === 'string');
    const errorMessage = errorEntry?.error || 'userScripts.execute produced no result.';
    const lower = errorMessage.toLowerCase();
    let errCode = 'injection_error';
    let hint: string | undefined;
    if (lower.includes('frame') && (lower.includes('removed') || lower.includes('no frame'))) {
      errCode = 'frame_detached';
      hint = 'The page may be navigating. Wait briefly and retry.';
    } else if (lower.includes('cannot access') || lower.includes('url')) {
      errCode = 'tab_inaccessible';
      hint = 'The tab may be on a restricted URL (chrome://, etc.).';
    }
    return {
      success: false,
      error: errorMessage,
      code: errCode,
      hint,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    // Distinguish "toggle off / not enabled" from a real execution failure.
    // Chrome throws variations like:
    //   "Cannot read properties of undefined (reading 'execute')" (toggle off, API undefined)
    //   "chrome.userScripts is not available" / "userScripts not enabled" / "permission denied"
    const looksNotEnabled =
      (lower.includes('userscripts') || lower.includes('user_scripts')) &&
      (lower.includes('not enabled') ||
        lower.includes('permission') ||
        lower.includes('not available') ||
        lower.includes("reading 'execute'") ||
        lower.includes('undefined'));
    if (looksNotEnabled) {
      return {
        success: false,
        error: msg,
        code: 'userScripts_not_enabled',
        hint: 'User Scripts toggle is off. On Chrome 138+, open chrome://extensions, open Parchi details, and enable "Allow User Scripts". On older Chrome, enable Developer Mode, then reload the extension.',
      };
    }
    return {
      success: false,
      error: msg,
      code: 'userScripts_execution_failed',
      hint: 'User script execution failed. Ensure "Allow User Scripts" is enabled for this extension in chrome://extensions.',
    };
  }
}

/**
 * Reset the world-configured flag. Exposed for tests so each case starts clean.
 */
export function __resetUserScriptsWorldConfigured(): void {
  worldConfigured = false;
}
