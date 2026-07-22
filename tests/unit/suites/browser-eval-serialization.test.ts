import { evaluateTool } from '../../../packages/extension/tools/browser-read-tools.js';
import type { BrowserToolsDelegate } from '../../../packages/extension/tools/browser-tool-shared.js';
import { waitForTool } from '../../../packages/extension/tools/browser-wait-tools.js';
import { type TestRunner, log } from '../shared/runner.js';

// chrome.scripting.executeScript serializes `func` via Function.prototype.toString() and
// re-runs it in the page with NO closure over the calling scope. A mock that just invokes
// the function in-process would miss that boundary entirely, so this reproduces it for real:
// stringify the injected function and reconstruct it with `new Function`, exactly like Chrome does.
function fakeRunInTab<TArgs extends unknown[], TResult>(
  _tabId: number,
  func: (...args: TArgs) => TResult | Promise<TResult>,
  args: TArgs,
): Promise<TResult> {
  const rebuilt = new Function(`return (${func.toString()});`)() as (...a: TArgs) => TResult | Promise<TResult>;
  return Promise.resolve(rebuilt(...args));
}

function makeCtx(overrides: Partial<BrowserToolsDelegate> = {}): BrowserToolsDelegate {
  return {
    sessionTabs: new Map(),
    currentSessionTabId: 1,
    sessionTabGroupId: null,
    supportsTabGroups: false,
    screenshotQuality: undefined,
    getSessionTabSummaries: () => [],
    getGroupTitle: () => '',
    updateGroupTitle: async () => {},
    groupTabsInternal: async () => {},
    resolveTabId: async () => 1,
    resolveSessionWindowId: async () => undefined,
    captureActiveTab: async () => 1,
    runInTab: fakeRunInTab,
    runInAllFrames: fakeRunInTab,
    sendOverlay: async () => {},
    runUserScript: async () => ({
      success: false,
      error: 'userScripts not available in test environment',
      code: 'userScripts_api_missing',
    }),
    ...overrides,
  } as unknown as BrowserToolsDelegate;
}

export async function runBrowserEvalSerializationSuite(runner: TestRunner) {
  log('\n=== Testing evaluate/waitFor across the MV3 closure-serialization boundary ===', 'info');

  await runner.test(
    'evaluateTool runs runPageScript/toJsonSafe without a closure (regression for ReferenceError)',
    async () => {
      const result = (await evaluateTool(makeCtx(), { script: 'return args[0] + args[1]', args: [2, 3] })) as {
        success: boolean;
        result?: unknown;
      };
      runner.assertTrue(result.success, `expected success, got: ${JSON.stringify(result)}`);
      runner.assertEqual(result.result, 5);
    },
  );

  await runner.test('waitForTool script condition runs runPageScript without a closure', async () => {
    const result = (await waitForTool(makeCtx(), {
      script: 'return true',
      timeoutMs: 500,
    })) as { success: boolean };
    runner.assertTrue(result.success, `expected success, got: ${JSON.stringify(result)}`);
  });

  await runner.test('evaluateTool falls back to executeScript when userScripts is unavailable', async () => {
    const result = (await evaluateTool(makeCtx(), { script: 'return args[0] + args[1]', args: [2, 3] })) as {
      success: boolean;
      result?: unknown;
    };
    runner.assertTrue(result.success, `expected success, got: ${JSON.stringify(result)}`);
    runner.assertEqual(result.result, 5);
  });

  await runner.test('evaluateTool returns userScripts result when userScripts succeeds', async () => {
    const ctx = makeCtx({
      runUserScript: (async () => ({
        success: true,
        result: { success: true, result: 42 },
      })) as BrowserToolsDelegate['runUserScript'],
    });
    const result = (await evaluateTool(ctx, { script: 'return 42' })) as {
      success: boolean;
      result?: unknown;
    };
    runner.assertTrue(result.success, `expected success, got: ${JSON.stringify(result)}`);
    runner.assertEqual(result.result, 42);
  });

  await runner.test('evaluateTool returns script error from userScripts path directly', async () => {
    const ctx = makeCtx({
      runUserScript: (async () => ({
        success: true,
        result: { success: false, error: 'ReferenceError: x is not defined', code: 'script_error' },
      })) as BrowserToolsDelegate['runUserScript'],
    });
    const result = (await evaluateTool(ctx, { script: 'return x' })) as {
      success: boolean;
      error?: string;
      code?: string;
    };
    runner.assertFalse(result.success, `expected failure, got: ${JSON.stringify(result)}`);
    runner.assertEqual(result.code, 'script_error');
  });

  await runner.test('waitForTool pure-script falls back to executeScript when userScripts is unavailable', async () => {
    const result = (await waitForTool(makeCtx(), {
      script: 'return true',
      timeoutMs: 500,
    })) as { success: boolean };
    runner.assertTrue(result.success, `expected success, got: ${JSON.stringify(result)}`);
  });

  await runner.test('waitForTool pure-script uses userScripts when available', async () => {
    const ctx = makeCtx({
      runUserScript: (async () => ({
        success: true,
        result: { success: true, matchedScript: true, elapsedMs: 10, attempts: 1 },
      })) as BrowserToolsDelegate['runUserScript'],
    });
    const result = (await waitForTool(ctx, {
      script: 'return document.title',
      timeoutMs: 500,
    })) as { success: boolean; matchedScript?: boolean };
    runner.assertTrue(result.success, `expected success, got: ${JSON.stringify(result)}`);
    runner.assertTrue(result.matchedScript === true, 'expected matchedScript from userScripts path');
  });

  await runner.test('waitForTool with selector+text still uses executeScript (not userScripts)', async () => {
    // When selector or text is present, userScripts path is not attempted
    const ctx = makeCtx({
      runUserScript: async () => {
        throw new Error('userScripts should not be called when selector/text is present');
      },
    });
    const result = (await waitForTool(ctx, {
      selector: 'body',
      text: 'test',
      timeoutMs: 500,
    })) as { success: boolean };
    // body exists, but text 'test' won't match — should time out
    runner.assertFalse(result.success, 'expected timeout since text does not match');
  });
}
