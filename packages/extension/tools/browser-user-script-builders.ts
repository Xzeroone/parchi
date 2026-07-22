/**
 * Source-string builders for chrome.userScripts.execute injection.
 *
 * These produce self-contained JS source that runs in the USER_SCRIPT world
 * (CSP-exempt). Each builder wraps a user-supplied snippet so that:
 *  - success paths return { success: true, result: <safe-serialized value> }
 *  - script throws return { success: false, error, code: "script_error" }
 *  - polling timeouts return { success: false, error, elapsedMs, attempts }
 *
 * Extracted from browser-user-scripts.ts so the API wrapper stays under the
 * repo-standards 300-line cap for new files.
 */

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
 * Shape of a parsed user-script payload returned by the injected code.
 * The injected wrapper always returns an object with `success`; on failure it
 * sets `error` and (sometimes) `code: "script_error"`.
 */
export interface UserScriptPayload {
  success: boolean;
  result?: unknown;
  error?: string;
  code?: string;
  [key: string]: unknown;
}
