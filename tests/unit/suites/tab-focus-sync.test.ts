import { switchTabTool } from '../../../packages/extension/tools/browser-tab-tools.js';
import type { BrowserToolsDelegate } from '../../../packages/extension/tools/browser-tool-shared.js';
import { BrowserTools } from '../../../packages/extension/tools/browser-tools.js';
import { type TestRunner, log } from '../shared/runner.js';

type TabStub = {
  id: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  windowId?: number;
  groupId?: number;
  active?: boolean;
  highlighted?: boolean;
  pinned?: boolean;
  incognito?: boolean;
  index?: number;
};

function installChromeStub(tabs: Record<string, unknown> = {}, windows: Record<string, unknown> = {}) {
  const g = globalThis as typeof globalThis & { chrome?: unknown };
  const original = g.chrome;
  g.chrome = {
    tabs: {
      get: async (id: number) => {
        const all = (tabs as { all?: TabStub[] }).all || [];
        const found = all.find((t) => t.id === id);
        if (!found) throw new Error(`No tab with id ${id}`);
        return found;
      },
      update: async (id: number, props: Record<string, unknown>) => ({ id, ...props }),
      query: async () => (tabs as { all?: TabStub[] }).all || [],
      create: async (props: Record<string, unknown>) => ({ id: 9999, windowId: 1, ...props }),
      group: async () => 1,
      remove: async () => {},
      ...tabs,
    },
    windows: { update: async () => {}, ...windows },
    tabGroups: undefined,
    debugger: undefined,
  } as unknown as typeof chrome;
  return () => {
    g.chrome = original;
  };
}

function makeCtx(overrides: Partial<BrowserToolsDelegate> = {}): BrowserToolsDelegate {
  const sessionTabs = new Map<number, { id: number; title?: string; url?: string; windowId?: number }>();
  return {
    sessionTabs,
    currentSessionTabId: null,
    sessionTabGroupId: null,
    supportsTabGroups: false,
    supportsDebugger: false,
    screenshotQuality: undefined,
    maxSessionTabs: 5,
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
    runUserScript: async () => ({ success: false, error: 'n/a', code: 'userScripts_api_missing' }),
    getCurrentSessionTabId: () => null,
    pruneClosedTabs: async () => {},
    syncActiveTab: async () => {},
    watchNetwork: async () => ({ success: true }),
    readNetworkLog: async () => ({ success: true, entries: [] }),
    ...overrides,
  } as unknown as BrowserToolsDelegate;
}

export async function runTabFocusSyncSuite(runner: TestRunner) {
  log('\n=== Testing tab focus sync (onActivated/onRemoved/switchTab) ===', 'info');

  await runner.test(
    'switchTabTool adopts a non-session tab into sessionTabs (regression: silent re-target)',
    async () => {
      const ctx = makeCtx();
      const restore = installChromeStub({
        all: [{ id: 42, title: 'External', url: 'https://other.example.com', windowId: 1 }],
      });
      try {
        runner.assertEqual(ctx.sessionTabs.size, 0, 'starts empty');
        const result = await switchTabTool(ctx, { tabId: 42 });
        runner.assertTrue(result.success, `switch should succeed, got ${JSON.stringify(result)}`);
        runner.assertEqual(ctx.currentSessionTabId, 42, 'focus moved to switched tab');
        runner.assertTrue(ctx.sessionTabs.has(42), 'switched tab must be adopted into sessionTabs');
      } finally {
        restore();
      }
    },
  );

  await runner.test('switchTabTool updates an existing session tab in place', async () => {
    const ctx = makeCtx();
    ctx.sessionTabs.set(7, { id: 7, title: 'Old', url: 'https://old.example.com', windowId: 1 });
    const restore = installChromeStub({
      all: [{ id: 7, title: 'New Title', url: 'https://new.example.com', windowId: 1 }],
    });
    try {
      await switchTabTool(ctx, { tabId: 7 });
      const tab = ctx.sessionTabs.get(7);
      runner.assertEqual(tab?.title, 'New Title', 'title refreshed');
      runner.assertEqual(tab?.url, 'https://new.example.com', 'url refreshed');
    } finally {
      restore();
    }
  });

  await runner.test('BrowserTools.syncActiveTab latches focus when the activated tab is a session tab', async () => {
    const restore = installChromeStub({
      all: [{ id: 5, title: 'Sess', url: 'https://sess.example.com', windowId: 1 }],
    });
    try {
      const tools = new BrowserTools();
      tools.sessionTabs.set(5, { id: 5, title: 'Sess', url: 'https://sess.example.com', windowId: 1 });
      // start focused elsewhere to prove sync moves it
      tools.currentSessionTabId = null;
      await tools.syncActiveTab(5, 1);
      runner.assertEqual(tools.currentSessionTabId, 5, 'focus should move to the activated session tab');
    } finally {
      restore();
    }
  });

  await runner.test('BrowserTools.syncActiveTab does NOT hijack a session that already has focus', async () => {
    const restore = installChromeStub({
      all: [{ id: 9, title: 'Other', url: 'https://other.example.com', windowId: 2 }],
    });
    try {
      const tools = new BrowserTools();
      tools.sessionTabs.set(1, { id: 1, title: 'Mine', url: 'https://mine.example.com', windowId: 1 });
      tools.currentSessionTabId = 1;
      await tools.syncActiveTab(9, 2);
      runner.assertEqual(tools.currentSessionTabId, 1, 'existing focus must be preserved');
      runner.assertFalse(tools.sessionTabs.has(9), 'non-window tab must not be adopted');
    } finally {
      restore();
    }
  });

  await runner.test('BrowserTools.syncActiveTab lazily captures active tab for a fresh (empty) session', async () => {
    const restore = installChromeStub({
      // active tab Chrome would report
      all: [{ id: 33, title: 'Active', url: 'https://active.example.com', windowId: 1 }],
      // getActiveTab uses query({active:true, currentWindow:true}) → first match
      query: async () => [{ id: 33, title: 'Active', url: 'https://active.example.com', windowId: 1 }],
    });
    try {
      const tools = new BrowserTools();
      runner.assertEqual(tools.sessionTabs.size, 0, 'starts empty');
      await tools.syncActiveTab(33, 1);
      runner.assertEqual(tools.currentSessionTabId, 33, 'fresh session should capture the active tab');
      runner.assertTrue(tools.sessionTabs.has(33), 'captured tab added to sessionTabs');
    } finally {
      restore();
    }
  });

  await runner.test('BrowserTools.pruneClosedTabs drops stale tabs and resets focus if needed', async () => {
    const liveTab = { id: 10, title: 'Live', url: 'https://live.example.com', windowId: 1 };
    const restore = installChromeStub({
      // chrome.tabs.get throws for id 20 (closed), returns for id 10
      get: async (id: number) => {
        if (id === 10) return liveTab;
        throw new Error(`No tab with id ${id}`);
      },
    });
    try {
      const tools = new BrowserTools();
      tools.sessionTabs.set(10, { id: 10, title: 'Live', url: 'https://live.example.com', windowId: 1 });
      tools.sessionTabs.set(20, { id: 20, title: 'Dead', url: 'https://dead.example.com', windowId: 1 });
      tools.currentSessionTabId = 20;
      await tools.pruneClosedTabs();
      runner.assertFalse(tools.sessionTabs.has(20), 'dead tab pruned');
      runner.assertTrue(tools.sessionTabs.has(10), 'live tab kept');
      runner.assertTrue(
        tools.currentSessionTabId !== 20,
        `focus must not point at pruned tab, got ${tools.currentSessionTabId}`,
      );
    } finally {
      restore();
    }
  });
}
