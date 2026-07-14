import { BrowserDebugManager } from '../../../packages/extension/tools/browser-debug-tools.js';
import { type TestRunner, log } from '../shared/runner.js';

function withChrome<T>(fakeChrome: unknown, fn: () => T): T {
  const original = (globalThis as any).chrome;
  (globalThis as any).chrome = fakeChrome;
  try {
    return fn();
  } finally {
    (globalThis as any).chrome = original;
  }
}

function makeFirefoxLikeChrome() {
  // Firefox has no manifest "debugger" permission and no debugger API at all.
  return { debugger: undefined, tabs: {}, runtime: { lastError: undefined } };
}

function makeChromeWithDebugger() {
  const detachCalls: unknown[] = [];
  return {
    detachCalls,
    debugger: {
      onEvent: { addListener: () => {} },
      onDetach: { addListener: () => {} },
      attach: (_target: unknown, _version: string, cb: () => void) => cb(),
      sendCommand: (_target: unknown, _method: string, _params: unknown, cb: (result: unknown) => void) => cb({}),
      detach: (target: unknown, cb: () => void) => {
        detachCalls.push(target);
        cb();
      },
    },
    runtime: { lastError: undefined },
  };
}

export function runBrowserDebugFirefoxGuardSuite(runner: TestRunner) {
  log('\n=== Testing chrome.debugger Firefox guard and detach-on-cleanup ===', 'info');

  runner.test('BrowserDebugManager construction does not crash when chrome.debugger is unavailable (Firefox)', () => {
    withChrome(makeFirefoxLikeChrome(), () => {
      new BrowserDebugManager();
    });
  });

  runner.test(
    'watchNetwork rejects with a clear error (not a raw TypeError) when chrome.debugger is unavailable',
    async () => {
      await withChrome(makeFirefoxLikeChrome(), async () => {
        const manager = new BrowserDebugManager();
        let caught: Error | null = null;
        try {
          await manager.watchNetwork(1);
        } catch (error) {
          caught = error as Error;
        }
        runner.assertTrue(caught instanceof Error, 'Expected watchNetwork to reject');
        runner.assertTrue(
          !!caught && /firefox|not available/i.test(caught.message),
          `Expected a descriptive platform-limitation error, got: ${caught?.message}`,
        );
      });
    },
  );

  runner.test('detachAll detaches every tracked session and clears them', async () => {
    await withChrome(makeChromeWithDebugger(), async () => {
      const fakeChrome = (globalThis as any).chrome;
      const manager = new BrowserDebugManager();
      await manager.watchNetwork(1);
      await manager.watchNetwork(2);
      await manager.detachAll();
      runner.assertEqual(fakeChrome.detachCalls.length, 2);
      // A second watchNetwork after detach must re-attach cleanly rather than reuse stale state.
      await manager.watchNetwork(1);
    });
  });
}
