import { getBrowserTools } from '../../../packages/extension/background/session-manager.js';
import { openTabTool } from '../../../packages/extension/tools/browser-tab-tools.js';
import {
  DEFAULT_MAX_SESSION_TABS,
  MAX_SESSION_TABS_LIMIT,
  normalizeMaxSessionTabs,
} from '../../../packages/extension/tools/browser-tool-shared.js';
import type { BrowserToolsDelegate } from '../../../packages/extension/tools/browser-tool-shared.js';
import type { BrowserTools } from '../../../packages/extension/tools/browser-tools.js';
import { type TestRunner, log } from '../shared/runner.js';

function makeOpenTabDelegate(maxSessionTabs: number, existingCount: number): BrowserToolsDelegate {
  const sessionTabs = new Map<number, { id: number; title?: string; url?: string }>();
  for (let i = 0; i < existingCount; i++) {
    sessionTabs.set(1000 + i, { id: 1000 + i, title: `Tab ${i}`, url: `https://example.com/${i}` });
  }
  return {
    sessionTabs,
    currentSessionTabId: existingCount > 0 ? 1000 : null,
    sessionTabGroupId: null,
    supportsTabGroups: false,
    supportsDebugger: false,
    screenshotQuality: undefined,
    maxSessionTabs,
    getSessionTabSummaries: () => Array.from(sessionTabs.values()),
    getGroupTitle: () => 'Parchi',
    updateGroupTitle: async () => {},
    resolveTabId: async () => null,
    resolveSessionWindowId: async () => undefined,
    captureActiveTab: async () => null,
    groupTabsInternal: async () => {},
    sendOverlay: async () => {},
    runInTab: async () => null,
    runInAllFrames: async () => null,
    runUserScript: async () => ({
      success: false,
      error: 'n/a',
      code: 'userScripts_api_missing',
    }),
    getCurrentSessionTabId: () => null,
    getSessionState: () => ({
      tabs: [],
      activeTabId: null,
      maxTabs: maxSessionTabs,
      groupTitle: '',
    }),
    watchNetwork: async () => ({ success: true }),
    readNetworkLog: async () => ({ success: true, entries: [] }),
  } as unknown as BrowserToolsDelegate;
}

function withChromeStub<T>(fn: () => T | Promise<T>): Promise<T> {
  const g = globalThis as typeof globalThis & { chrome?: unknown };
  const original = g.chrome;
  g.chrome = {
    tabs: {
      create: async () => ({
        id: 9999,
        index: 0,
        windowId: 1,
        highlighted: false,
        active: true,
        pinned: false,
        incognito: false,
        title: 'New',
        url: 'https://example.com/new',
      }),
      group: async () => 1,
    },
    // BrowserDebugManager construction probes chrome.debugger — leave undefined (Firefox-like).
  } as unknown as typeof chrome;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      g.chrome = original;
    });
}

export async function runMaxSessionTabsSuite(runner: TestRunner) {
  log('\n=== Testing Max Session Tabs setting (PAR-57) ===', 'info');

  await runner.test('normalizeMaxSessionTabs accepts values above 10', () => {
    runner.assertEqual(normalizeMaxSessionTabs(15), 15, '15 should pass through');
    runner.assertEqual(normalizeMaxSessionTabs(20), 20, '20 should pass through');
    runner.assertEqual(normalizeMaxSessionTabs('25'), 25, 'numeric string 25 should parse');
    runner.assertEqual(normalizeMaxSessionTabs(1), 1, '1 is minimum valid');
    runner.assertEqual(normalizeMaxSessionTabs(MAX_SESSION_TABS_LIMIT), MAX_SESSION_TABS_LIMIT);
  });

  await runner.test('normalizeMaxSessionTabs clamps to [1, MAX_SESSION_TABS_LIMIT]', () => {
    runner.assertEqual(normalizeMaxSessionTabs(0), 1, '0 clamps to 1');
    runner.assertEqual(normalizeMaxSessionTabs(-3), 1, 'negative clamps to 1');
    runner.assertEqual(normalizeMaxSessionTabs(999), MAX_SESSION_TABS_LIMIT, 'over ceiling clamps');
    runner.assertEqual(
      normalizeMaxSessionTabs(undefined, DEFAULT_MAX_SESSION_TABS),
      DEFAULT_MAX_SESSION_TABS,
      'undefined uses fallback',
    );
    runner.assertEqual(
      normalizeMaxSessionTabs('nope', DEFAULT_MAX_SESSION_TABS),
      DEFAULT_MAX_SESSION_TABS,
      'non-numeric uses fallback',
    );
  });

  await runner.test('getBrowserTools applies maxSessionTabs from settings (value > 10)', async () => {
    await withChromeStub(() => {
      const map = new Map<string, BrowserTools>();
      const tools = getBrowserTools(map, { maxSessionTabs: 15 }, 'session-above-10');
      runner.assertEqual(tools.maxSessionTabs, 15, 'runtime must honor setting 15');

      // Live re-apply on existing instance when settings change
      getBrowserTools(map, { maxSessionTabs: 22 }, 'session-above-10');
      runner.assertEqual(tools.maxSessionTabs, 22, 'existing instance must pick up setting 22');
    });
  });

  await runner.test('getBrowserTools coerces string maxSessionTabs from storage', async () => {
    await withChromeStub(() => {
      const map = new Map<string, BrowserTools>();
      const tools = getBrowserTools(map, { maxSessionTabs: '18' as unknown as number }, 'session-string');
      runner.assertEqual(tools.maxSessionTabs, 18, 'string "18" from storage must apply');
    });
  });

  await runner.test('openTabTool enforces configurable max above 10 (not old hard cap)', async () => {
    const max = 15;
    // At capacity with 15 existing tabs — should refuse open
    const atCap = makeOpenTabDelegate(max, max);
    const blocked = await openTabTool(atCap, { url: 'https://example.com/new' });
    runner.assertEqual(blocked.success, false, 'should block when at configured max 15');
    runner.assertTrue(
      String((blocked as { error?: string }).error || '').includes('max 15'),
      'error message should report configured max 15',
    );

    const underCap = makeOpenTabDelegate(max, max - 1);
    await withChromeStub(async () => {
      const allowed = await openTabTool(underCap, { url: 'https://example.com/new' });
      runner.assertEqual(allowed.success, true, 'should allow open when under configured max 15');
      runner.assertEqual(underCap.sessionTabs.size, max, 'session should grow to 15');
    });
  });

  await runner.test('default maxSessionTabs remains DEFAULT_MAX_SESSION_TABS when unset', async () => {
    await withChromeStub(() => {
      const map = new Map<string, BrowserTools>();
      const tools = getBrowserTools(map, {}, 'session-default');
      runner.assertEqual(tools.maxSessionTabs, DEFAULT_MAX_SESSION_TABS, 'default is 5 when unset');
    });
  });
}
