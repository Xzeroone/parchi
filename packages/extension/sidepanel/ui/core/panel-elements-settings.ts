type NullableElement<T extends Element> = T | null;

const byId = <T extends HTMLElement>(id: string): NullableElement<T> =>
  document.getElementById(id) as NullableElement<T>;

export const getSettingsFormElements = () => ({
  // Form elements - Provider & model
  provider: byId<HTMLSelectElement>('provider'),
  apiKey: byId<HTMLInputElement>('apiKey'),
  model: byId<HTMLInputElement>('model'),
  modelSuggestions: byId<HTMLDataListElement>('modelSuggestions'),
  modelHint: byId<HTMLElement>('modelHint'),
  customEndpoint: byId<HTMLInputElement>('customEndpoint'),
  customEndpointGroup: byId<HTMLElement>('customEndpointGroup'),
  customHeaders: byId<HTMLTextAreaElement>('customHeaders'),
  customHeadersGroup: byId<HTMLElement>('customHeadersGroup'),

  // Form elements - Model parameters
  temperature: byId<HTMLInputElement>('temperature'),
  temperatureValue: byId<HTMLElement>('temperatureValue'),
  maxTokens: byId<HTMLInputElement>('maxTokens'),
  contextLimit: byId<HTMLInputElement>('contextLimit'),
  timeout: byId<HTMLInputElement>('timeout'),

  // Form elements - Screenshots & vision
  enableScreenshots: byId<HTMLInputElement>('enableScreenshots'),
  sendScreenshotsAsImages: byId<HTMLInputElement>('sendScreenshotsAsImages'),
  screenshotQuality: byId<HTMLSelectElement>('screenshotQuality'),
  visionBridge: byId<HTMLInputElement>('visionBridge'),
  visionProfile: byId<HTMLSelectElement>('visionProfile'),

  // Form elements - Behavior
  showThinking: byId<HTMLInputElement>('showThinking'),
  streamResponses: byId<HTMLInputElement>('streamResponses'),
  autoScroll: byId<HTMLInputElement>('autoScroll'),
  saveHistory: byId<HTMLInputElement>('saveHistory'),
  autoSaveSession: byId<HTMLSelectElement>('autoSaveSession'),
  autoSaveFolderBtn: byId<HTMLButtonElement>('autoSaveFolderBtn'),
  autoSaveFolderLabel: byId<HTMLSpanElement>('autoSaveFolderLabel'),

  // Form elements - Orchestrator
  orchestratorToggle: byId<HTMLInputElement>('orchestratorToggle'),
  orchestratorProfile: byId<HTMLSelectElement>('orchestratorProfile'),
  orchestratorEnabledVisible: byId<HTMLInputElement>('orchestratorToggle'),
  orchestratorProfileVisible: byId<HTMLSelectElement>('orchestratorProfile'),
  orchestratorProfileSelectGroup: byId<HTMLElement>('orchestratorProfile')?.closest('.form-group'),

  // Form elements - System prompt
  systemPrompt: byId<HTMLTextAreaElement>('systemPrompt'),
  orchestratorPromptSection: byId<HTMLElement>('orchestratorPromptSection'),
  orchestratorPromptTextarea: byId<HTMLTextAreaElement>('orchestratorPromptTextarea'),
  visionPromptSection: byId<HTMLElement>('visionPromptSection'),
  visionPromptTextarea: byId<HTMLTextAreaElement>('visionPromptTextarea'),

  // Form elements - Appearance
  uiZoom: byId<HTMLInputElement>('uiZoom'),
  uiZoomValue: byId<HTMLElement>('uiZoomValue'),
  fontPreset: byId<HTMLSelectElement>('fontPreset'),
  themeSelect: byId<HTMLSelectElement>('themeSelect'),
  fontStylePreset: byId<HTMLSelectElement>('fontStylePreset'),
  themeGrid: byId<HTMLElement>('themeGrid'),

  // Settings actions
  saveSettingsBtn: byId<HTMLButtonElement>('saveSettingsBtn'),
  cancelSettingsBtn: byId<HTMLButtonElement>('cancelSettingsBtn'),
});
