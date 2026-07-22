import {
  __resetUserScriptsWorldConfigured,
  buildEvaluateUserScript,
  buildWaitForScriptUserScript,
  executeUserScript,
  getUserScriptsStatus,
  isUserScriptsAvailable,
  probeUserScriptsAvailability,
} from '../../../packages/extension/tools/browser-user-scripts.js';
import type { UserScriptInjectionResult } from '../../../packages/extension/tools/browser-user-scripts.js';
import { type TestRunner, log } from '../shared/runner.js';

type ExecuteImpl = (injection: {
  target: { tabId: number; allFrames?: boolean; frameIds?: number[] };
  js: Array<{ code: string }>;
  world?: 'USER_SCRIPT' | 'MAIN';
  injectImmediately?: boolean;
}) => Promise<UserScriptInjectionResult[]>;

interface MockUserScriptsApi {
  execute: ExecuteImpl;
  configureWorld: (p: { csp?: string; messaging?: boolean }) => Promise<void>;
  getScripts: () => Promise<unknown>;
}

const ORIGINAL_CHROME = (globalThis as { chrome?: unknown }).chrome;

function installMockUserScripts(api: MockUserScriptsApi | null): void {
  __resetUserScriptsWorldConfigured();
  if (api === null) {
    (globalThis as { chrome?: unknown }).chrome = undefined;
    return;
  }
  (globalThis as { chrome: Record<string, unknown> }).chrome = { userScripts: api };
}

function restoreChrome(): void {
  (globalThis as { chrome?: unknown }).chrome = ORIGINAL_CHROME;
  __resetUserScriptsWorldConfigured();
}

const OK_GET_SCRIPTS: MockUserScriptsApi = {
  execute: async () => [],
  configureWorld: async () => {},
  getScripts: async () => [],
};

export async function runUserScriptsInjectionSuite(runner: TestRunner) {
  log('\n=== Testing executeUserScript InjectionResult handling ===', 'info');

  await runner.test('isUserScriptsAvailable returns false when chrome.userScripts is undefined', () => {
    installMockUserScripts(null);
    try {
      runner.assertFalse(isUserScriptsAvailable(), 'API missing should be unavailable');
    } finally {
      restoreChrome();
    }
  });

  await runner.test('getUserScriptsStatus returns available=true when API present', () => {
    installMockUserScripts(OK_GET_SCRIPTS);
    try {
      const status = getUserScriptsStatus();
      runner.assertTrue(status.available, `expected available, got ${JSON.stringify(status)}`);
    } finally {
      restoreChrome();
    }
  });

  await runner.test('probeUserScriptsAvailability returns available when getScripts resolves', async () => {
    installMockUserScripts(OK_GET_SCRIPTS);
    try {
      const probe = await probeUserScriptsAvailability();
      runner.assertTrue(probe.available, `expected available, got ${JSON.stringify(probe)}`);
    } finally {
      restoreChrome();
    }
  });

  await runner.test('probeUserScriptsAvailability returns userScripts_not_enabled when getScripts throws', async () => {
    installMockUserScripts({
      ...OK_GET_SCRIPTS,
      getScripts: async () => {
        throw new Error("Cannot read properties of undefined (reading 'userScripts')");
      },
    });
    try {
      const probe = await probeUserScriptsAvailability();
      runner.assertFalse(probe.available, 'expected unavailable');
      runner.assertEqual(probe.code, 'userScripts_not_enabled');
    } finally {
      restoreChrome();
    }
  });

  await runner.test('executeUserScript returns wrapper payload when InjectionResult.result is present', async () => {
    const api: MockUserScriptsApi = {
      ...OK_GET_SCRIPTS,
      execute: async () => [{ frameId: 0, result: { success: true, result: 42 } }],
    };
    installMockUserScripts(api);
    try {
      const outcome = await executeUserScript(1, buildEvaluateUserScript('return 42', []));
      runner.assertTrue(outcome.success, `expected success, got ${JSON.stringify(outcome)}`);
      if (outcome.success) {
        runner.assertEqual(outcome.result.success, true);
        runner.assertEqual(outcome.result.result, 42);
      }
    } finally {
      restoreChrome();
    }
  });

  await runner.test(
    'executeUserScript surfaces nested script_error payload (regression for fallback bug)',
    async () => {
      const api: MockUserScriptsApi = {
        ...OK_GET_SCRIPTS,
        execute: async () => [
          { frameId: 0, result: { success: false, error: 'ReferenceError: x is not defined', code: 'script_error' } },
        ],
      };
      installMockUserScripts(api);
      try {
        const outcome = await executeUserScript(1, buildEvaluateUserScript('return x', []));
        // Injection succeeded → success: true with the payload carrying the script error.
        runner.assertTrue(outcome.success, 'injection itself should be marked successful');
        if (outcome.success) {
          runner.assertFalse(outcome.result.success, 'payload should report script failure');
          runner.assertEqual(outcome.result.code, 'script_error');
          runner.assertEqual(outcome.result.error, 'ReferenceError: x is not defined');
        }
      } finally {
        restoreChrome();
      }
    },
  );

  await runner.test(
    'executeUserScript returns frame_detached when InjectionResult.error mentions removed frame',
    async () => {
      const api: MockUserScriptsApi = {
        ...OK_GET_SCRIPTS,
        execute: async () => [{ frameId: 0, error: 'Frame with id 123 was removed.' }],
      };
      installMockUserScripts(api);
      try {
        const outcome = await executeUserScript(1, buildEvaluateUserScript('return 1', []));
        runner.assertFalse(outcome.success, 'expected failure');
        if (!outcome.success) {
          runner.assertEqual(outcome.code, 'frame_detached');
        }
      } finally {
        restoreChrome();
      }
    },
  );

  await runner.test('executeUserScript returns userScripts_not_enabled when execute throws on toggle off', async () => {
    const api: MockUserScriptsApi = {
      ...OK_GET_SCRIPTS,
      execute: async () => {
        throw new Error("Cannot read properties of undefined (reading 'execute') — userScripts not enabled");
      },
    };
    installMockUserScripts(api);
    try {
      const outcome = await executeUserScript(1, buildEvaluateUserScript('return 1', []));
      runner.assertFalse(outcome.success, 'expected failure');
      if (!outcome.success) {
        runner.assertEqual(outcome.code, 'userScripts_not_enabled');
      }
    } finally {
      restoreChrome();
    }
  });

  await runner.test('executeUserScript returns userScripts_empty_result when results array is empty', async () => {
    const api: MockUserScriptsApi = {
      ...OK_GET_SCRIPTS,
      execute: async () => [],
    };
    installMockUserScripts(api);
    try {
      const outcome = await executeUserScript(1, buildEvaluateUserScript('return 1', []));
      runner.assertFalse(outcome.success, 'expected failure');
      if (!outcome.success) {
        runner.assertEqual(outcome.code, 'userScripts_empty_result');
      }
    } finally {
      restoreChrome();
    }
  });

  await runner.test('executeUserScript picks the first frame with a result among multiple frames', async () => {
    const api: MockUserScriptsApi = {
      ...OK_GET_SCRIPTS,
      execute: async () => [
        { frameId: 1, error: 'Frame was removed' },
        { frameId: 0, result: { success: true, result: 'ok' } },
      ],
    };
    installMockUserScripts(api);
    try {
      const outcome = await executeUserScript(1, buildEvaluateUserScript('return "ok"', []));
      runner.assertTrue(outcome.success, 'should pick the frame that produced a result');
      if (outcome.success) {
        runner.assertEqual(outcome.result.result, 'ok');
      }
    } finally {
      restoreChrome();
    }
  });

  await runner.test('buildWaitForScriptUserScript produces a polling payload that resolves on truthy', async () => {
    const code = buildWaitForScriptUserScript('return document.title', [], 500, 50);
    // Spot-check that the generated source contains the expected structure.
    runner.assertTrue(code.includes('__timeoutMs = 500'), 'timeout embedded');
    runner.assertTrue(code.includes('__pollMs = 50'), 'poll interval embedded');
    runner.assertTrue(code.includes('matchedScript: true'), 'success shape embedded');
  });

  await runner.test('buildEvaluateUserScript embeds args JSON safely', () => {
    const code = buildEvaluateUserScript('return args[0]', [{ a: 1 }]);
    runner.assertTrue(code.includes('"a":1'), 'args serialized');
  });
}
