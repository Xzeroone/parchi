/**
 * chrome.userScripts API wrapper for CSP-exempt script execution.
 *
 * chrome.userScripts.execute (Chrome 135+) runs code in the USER_SCRIPT world,
 * which is exempt from the page's Content Security Policy. This allows
 * evaluate() and waitFor(script) to work on CSP-strict pages (social networks,
 * banking, Google apps, etc.) without weakening extension-page CSP.
 *
 * Security: USER_SCRIPT is a less-trusted context. Results are serialized
 * before returning to the extension — never treat them as privileged.
 */

export function isUserScriptsAvailable(): boolean {
  const chromeApi = ((globalThis as Record<string, unknown>).chrome ||
    (typeof chrome !== 'undefined' ? chrome : undefined)) as Record<string, unknown> | undefined;
  return (
    typeof chromeApi === 'object' &&
    chromeApi !== null &&
    typeof chromeApi.userScripts === 'object' &&
    chromeApi.userScripts !== null &&
    typeof (chromeApi.userScripts as Record<string, unknown>).execute === 'function'
  );
}

export interface UserScriptsStatus {
  available: boolean;
  code?: string;
  hint?: string;
}

export function getUserScriptsStatus(): UserScriptsStatus {
  const chromeApi = ((globalThis as Record<string, unknown>).chrome ||
    (typeof chrome !== 'undefined' ? chrome : undefined)) as Record<string, unknown> | undefined;
  if (typeof chromeApi !== 'object' || chromeApi === null || typeof chromeApi.userScripts !== 'object') {
    return {
      available: false,
      code: 'userScripts_api_missing',
      hint: 'chrome.userScripts API is not available in this browser. Use selector/text-based tools instead, or switch to Chrome 135+.',
    };
  }
  if (typeof (chromeApi.userScripts as Record<string, unknown>).execute !== 'function') {
    return {
      available: false,
      code: 'userScripts_not_enabled',
      hint: 'User scripts are not enabled. In Chrome 138+, go to chrome://extensions, find Parchi, and enable "Allow User Scripts". In older versions, enable Developer Mode.',
    };
  }
  return { available: true };
}

/**
 * Build the JavaScript source to inject for an evaluate() call via userScripts.
 * The injected code runs the user's script in USER_SCRIPT world (CSP-exempt),
 * then serializes the result safely (handles circular refs, Map, Set, Date, etc.).
 */
export function buildEvaluateUserScript(userScript: string, args: unknown[]): string {
  const argsJson = JSON.stringify(args);
  return `(async () => {
"use strict";
const __args = ${argsJson};
const __fn = async (args) => { ${userScript} };
let __value;
try {
  __value = await __fn(__args);
} catch (__e) {
  return { success: false, error: __e instanceof Error ? __e.message : String(__e), code: "script_error" };
}
const __toJsonSafe = (v, __seen) => {
  if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "function") return "[Function]";
  if (v instanceof Date) return v.toISOString();
  if (v instanceof RegExp) return String(v);
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
  if (typeof Node !== "undefined" && v instanceof Node) {
    if (v instanceof Element) return { nodeType: v.nodeType, tagName: v.tagName, id: v.id || void 0, className: v.className || void 0, textContent: (v.textContent || "").slice(0, 500) };
    return { nodeType: v.nodeType, textContent: (v.textContent || "").slice(0, 500) };
  }
  if (Array.isArray(v)) return v.map(e => __toJsonSafe(e, __seen));
  if (v instanceof Map) return Array.from(v.entries()).map(([k, e]) => [__toJsonSafe(k, __seen), __toJsonSafe(e, __seen)]);
  if (v instanceof Set) return Array.from(v.values()).map(e => __toJsonSafe(e, __seen));
  if (typeof v === "object") {
    if (__seen.has(v)) return "[Circular]";
    __seen.add(v);
    const __out = {};
    for (const [__k, __e] of Object.entries(v)) __out[__k] = __toJsonSafe(__e, __seen);
    __seen.delete(v);
    return __out;
  }
  return String(v);
};
return { success: true, result: __toJsonSafe(__value, new WeakSet()) };
})()`;
}

/**
 * Build the JavaScript source to inject for a waitFor(script) polling loop via userScripts.
 * The injected code runs the user's script condition in USER_SCRIPT world (CSP-exempt),
 * polling until the condition is truthy or the timeout expires.
 */
export function buildWaitForScriptUserScript(
  userScript: string,
  args: unknown[],
  timeoutMs: number,
  pollIntervalMs: number,
): string {
  const argsJson = JSON.stringify(args);
  return `(async () => {
"use strict";
const __args = ${argsJson};
const __script = async (args) => { ${userScript} };
const __timeoutMs = ${timeoutMs};
const __pollMs = ${pollIntervalMs};
const __startedAt = Date.now();
let __attempts = 0;
const __sleep = (ms) => new Promise(r => setTimeout(r, ms));
while (Date.now() - __startedAt <= __timeoutMs) {
  __attempts++;
  try {
    const __value = await __script(__args);
    if (__value) {
      return { success: true, matchedScript: true, elapsedMs: Date.now() - __startedAt, attempts: __attempts };
    }
  } catch (__e) {
    return { success: false, error: __e instanceof Error ? __e.message : String(__e), code: "script_error", elapsedMs: Date.now() - __startedAt, attempts: __attempts };
  }
  await __sleep(__pollMs);
}
return { success: false, error: "Timed out waiting for condition.", elapsedMs: Date.now() - __startedAt, attempts: __attempts };
})()`;
}

/**
 * Execute a user script in a tab using chrome.userScripts.execute (USER_SCRIPT world).
 * This bypasses page CSP restrictions entirely.
 */
export async function executeUserScript<T = unknown>(
  tabId: number,
  code: string,
): Promise<{ success: true; result: T } | { success: false; error: string; code: string; hint?: string }> {
  const status = getUserScriptsStatus();
  if (!status.available) {
    return {
      success: false,
      error: status.hint || 'userScripts not available',
      code: status.code || 'userScripts_unavailable',
    };
  }

  try {
    // chrome.userScripts.execute is Chrome 135+; @types/chrome may lag behind.
    const userScriptsApi = chrome.userScripts as typeof chrome.userScripts & {
      execute: (injection: {
        target: { tabId: number };
        js: Array<{ code: string }>;
        world?: string;
      }) => Promise<Array<{ result?: unknown }>>;
    };
    const results = await userScriptsApi.execute({
      target: { tabId },
      js: [{ code }],
      world: 'USER_SCRIPT',
    });
    const raw = results?.[0]?.result;
    return { success: true, result: raw as T };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: msg,
      code: 'userScripts_execution_failed',
      hint: 'User script execution failed. Ensure "Allow User Scripts" is enabled for this extension in chrome://extensions.',
    };
  }
}
