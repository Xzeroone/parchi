import { BrowserDebugManager } from './browser-debug-tools.js';
import { runInAllFrames, runInTab, sendOverlay } from './browser-script-execution.js';
import {
  captureActiveTabState,
  configureSessionTabsState,
  ensureSessionTabGroupState,
  getGroupTitle,
  groupTabsInternalState,
  resolveSessionWindowIdState,
  updateGroupTitleState,
} from './browser-session-state.js';
import { type BrowserToolName, getBrowserToolDefinitions, getBrowserToolMap } from './browser-tool-definitions.js';
import { type ToolHandlerMap, createToolHandlers, executeTool } from './browser-tool-handlers.js';
import {
  type ActionOverlayPayload,
  type BrowserToolArgs,
  DEFAULT_MAX_SESSION_TABS,
  DEFAULT_SESSION_GROUP,
  type GroupOptions,
  type SessionTabSummary,
} from './browser-tool-shared.js';
import { executeUserScript } from './browser-user-scripts.js';

export class BrowserTools {
  tools: Partial<Record<BrowserToolName, true>>;
  toolHandlers: ToolHandlerMap;
  sessionTabs: Map<number, SessionTabSummary>;
  currentSessionTabId: number | null;
  sessionTabGroupId: number | null;
  supportsTabGroups: boolean;
  supportsDebugger: boolean;
  screenshotQuality: 'high' | 'medium' | 'low' | undefined;
  debugManager: BrowserDebugManager;
  maxSessionTabs: number;

  constructor() {
    this.sessionTabs = new Map();
    this.currentSessionTabId = null;
    this.sessionTabGroupId = null;
    this.supportsTabGroups =
      typeof globalThis.chrome?.tabs?.group === 'function' &&
      typeof globalThis.chrome?.tabGroups?.update === 'function';
    this.supportsDebugger = typeof globalThis.chrome?.debugger !== 'undefined';
    this.debugManager = new BrowserDebugManager();
    this.tools = getBrowserToolMap(this.supportsTabGroups, this.supportsDebugger);
    this.toolHandlers = createToolHandlers(this);
    this.maxSessionTabs = DEFAULT_MAX_SESSION_TABS;
  }

  /**
   * Prune session tabs that no longer exist in Chrome. Called by the background
   * service worker's onRemoved listener so resolveTabId never latches onto a
   * closed tab between runs. Keeps currentSessionTabId consistent if its tab was
   * the one closed.
   */
  async pruneClosedTabs(): Promise<void> {
    const staleIds: number[] = [];
    for (const tabId of this.sessionTabs.keys()) {
      try {
        await chrome.tabs.get(tabId);
      } catch {
        staleIds.push(tabId);
      }
    }
    for (const tabId of staleIds) {
      this.sessionTabs.delete(tabId);
      if (this.currentSessionTabId === tabId) {
        this.currentSessionTabId = this.sessionTabs.size > 0 ? (this.sessionTabs.keys().next().value ?? null) : null;
      }
    }
  }

  /**
   * Update this session's currentSessionTabId when the user activates a tab in
   * Chrome. Only latches onto the activated tab if it already belongs to this
   * session (so subagent sessions don't hijack each other's focus). If the
   * activated tab isn't a session tab and we currently have no focus, lazily
   * capture it (respecting restricted-URL rules from captureActiveTabState).
   */
  async syncActiveTab(tabId: number, windowId?: number): Promise<void> {
    if (this.sessionTabs.has(tabId)) {
      this.currentSessionTabId = tabId;
      try {
        const tab = await chrome.tabs.get(tabId);
        const existing = this.sessionTabs.get(tabId);
        if (existing) {
          existing.title = tab.title || existing.title;
          existing.url = tab.url ?? existing.url;
          existing.favIconUrl = tab.favIconUrl ?? existing.favIconUrl;
          if (typeof tab.windowId === 'number') existing.windowId = tab.windowId;
        }
      } catch {
        // Tab gone between activation event and get — prune will catch it.
      }
      return;
    }
    // Activated a non-session tab. Only capture it for sessions that already
    // have tabs in the same window (so a subagent in window B doesn't latch onto
    // a tab the user clicked in window A), OR sessions with no tabs at all
    // (fresh session — needs a target).
    if (this.currentSessionTabId === null) {
      if (this.sessionTabs.size === 0) {
        await this.captureActiveTab();
        return;
      }
      if (typeof windowId === 'number') {
        const ownsWindow = Array.from(this.sessionTabs.values()).some((t) => t.windowId === windowId);
        if (ownsWindow) await this.captureActiveTab();
      }
    }
  }

  getToolDefinitions(): ReturnType<typeof getBrowserToolDefinitions> {
    return getBrowserToolDefinitions(this.supportsTabGroups, this.supportsDebugger);
  }

  getSessionTabSummaries(): SessionTabSummary[] {
    return Array.from(this.sessionTabs.values());
  }

  getCurrentSessionTabId(): number | null {
    return this.currentSessionTabId;
  }

  getSessionState() {
    return {
      tabs: this.getSessionTabSummaries(),
      activeTabId: this.currentSessionTabId,
      maxTabs: this.maxSessionTabs,
      groupTitle: this.getGroupTitle(DEFAULT_SESSION_GROUP),
    };
  }

  private toSessionTabSummary(tab: chrome.tabs.Tab | null | undefined): SessionTabSummary | null {
    if (!tab || typeof tab.id !== 'number') return null;
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      windowId: typeof tab.windowId === 'number' ? tab.windowId : undefined,
    };
  }

  async configureSessionTabs(tabs: chrome.tabs.Tab[], options: GroupOptions = {}) {
    await configureSessionTabsState(
      this.sessionTabs,
      tabs,
      options,
      (tab) => this.toSessionTabSummary(tab),
      (tabId) => {
        this.currentSessionTabId = tabId;
      },
      this.supportsTabGroups,
      (groupOptions) => this.ensureSessionTabGroup(groupOptions),
    );
  }

  getGroupTitle(options: GroupOptions): string {
    return getGroupTitle(this.sessionTabs, options, this.maxSessionTabs);
  }

  async ensureSessionTabGroup(options: GroupOptions = DEFAULT_SESSION_GROUP) {
    await ensureSessionTabGroupState(
      this.sessionTabs,
      this.supportsTabGroups,
      this.sessionTabGroupId,
      (groupId) => {
        this.sessionTabGroupId = groupId;
      },
      options,
      this.maxSessionTabs,
    );
  }

  async updateGroupTitle() {
    await updateGroupTitleState(this.supportsTabGroups, this.sessionTabGroupId, this.sessionTabs, this.maxSessionTabs);
  }

  async executeTool(toolName: string, args: BrowserToolArgs = {}) {
    return executeTool(this.toolHandlers, toolName, args);
  }

  async resolveTabId(args: BrowserToolArgs = {}) {
    if (typeof args.tabId === 'number') {
      return this.sessionTabs.has(args.tabId) ? args.tabId : null;
    }
    if (this.currentSessionTabId && this.sessionTabs.has(this.currentSessionTabId)) {
      return this.currentSessionTabId;
    }
    if (this.sessionTabs.size === 1) {
      const [onlyTabId] = this.sessionTabs.keys();
      return typeof onlyTabId === 'number' ? onlyTabId : null;
    }
    if (this.sessionTabs.size === 0) {
      await this.captureActiveTab();
      if (this.currentSessionTabId && this.sessionTabs.has(this.currentSessionTabId)) {
        return this.currentSessionTabId;
      }
    }
    return null;
  }

  async captureActiveTab() {
    return captureActiveTabState(this.sessionTabs, (tabId) => {
      this.currentSessionTabId = tabId;
    });
  }

  async runInTab<TArgs extends unknown[], TResult>(
    tabId: number,
    func: (...args: TArgs) => TResult | Promise<TResult>,
    args: TArgs,
  ) {
    return runInTab(tabId, func, args);
  }

  async runInAllFrames<TArgs extends unknown[], TResult>(
    tabId: number,
    func: (...args: TArgs) => TResult | Promise<TResult>,
    args: TArgs,
  ) {
    return runInAllFrames(tabId, func, args);
  }

  async runUserScript(tabId: number, code: string) {
    return executeUserScript(tabId, code);
  }

  async watchNetwork(tabId: number, clearExisting = true) {
    return this.debugManager.watchNetwork(tabId, clearExisting);
  }

  async detachDebugSessions() {
    await this.debugManager.detachAll();
  }

  async readNetworkLog(
    tabId: number,
    options: {
      urlIncludes?: string;
      method?: string;
      status?: number;
      limit?: number;
      includeBody?: boolean;
      clearAfterRead?: boolean;
    } = {},
  ) {
    return this.debugManager.getNetworkLog(tabId, options);
  }

  async sendOverlay(tabId: number, payload: ActionOverlayPayload, retries = 0) {
    return sendOverlay(tabId, payload, retries);
  }

  async resolveSessionWindowId(): Promise<number | undefined> {
    return resolveSessionWindowIdState(this.currentSessionTabId, this.sessionTabs);
  }

  async groupTabsInternal(tabIds: number[], options: GroupOptions) {
    await groupTabsInternalState(this.supportsTabGroups, tabIds, options);
  }
}
