export type ToolPermissions = {
  read: boolean;
  interact: boolean;
  navigate: boolean;
  tabs: boolean;
  screenshots: boolean;
  /** Arbitrary page JS: evaluate and waitFor(script). Default true. */
  scripting: boolean;
};

export const DEFAULT_TOOL_PERMISSIONS: ToolPermissions = {
  read: true,
  interact: true,
  navigate: true,
  tabs: true,
  screenshots: true,
  scripting: true,
};

// Superset of keys used across background + sidepanel.
export const PARCHI_STORAGE_KEYS = [
  'providers',
  'provider',
  'apiKey',
  'model',
  'customEndpoint',
  'extraHeaders',
  'systemPrompt',
  'temperature',
  'maxTokens',
  'contextLimit',
  'timeout',
  'enableScreenshots',
  'sendScreenshotsAsImages',
  'screenshotQuality',
  'showThinking',
  'streamResponses',
  'autoScroll',
  'confirmActions',
  'saveHistory',
  'autoSaveSession',
  'toolPermissions',
  'allowedDomains',
  'activeConfig',
  'configs',
  'auxAgentProfiles',
  'useOrchestrator',
  'orchestratorProfile',
  'visionProfile',
  'visionBridge',
  'uiZoom',
  'fontPreset',
  'fontStylePreset',
  'timelineCollapsed',
  'accountModeChoice',
  'convexUrl',
  'convexAccessToken',
  'convexRefreshToken',
  'convexTokenExpiresAt',
  'convexUserId',
  'convexUserEmail',
  'convexSubscriptionPlan',
  'convexSubscriptionStatus',
  'convexSubscriptionCurrentPeriodEnd',
  'convexSubscriptionCheckedAt',
  'parchiRuntimeStatus',
  'theme',
  'workflows',
  'maxSessionTabs',
] as const;
