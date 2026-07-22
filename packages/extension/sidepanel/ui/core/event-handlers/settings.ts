/**
 * Event Handler - Settings Module
 * Settings panel event handlers
 */

import { debounce } from '../dom-utils.js';
import { SidePanelUI } from '../panel-ui.js';

const sidePanelProto = (SidePanelUI as any).prototype as SidePanelUI & Record<string, unknown>;

/**
 * Set up settings-related event listeners
 */
export const setupSettingsListeners = function setupSettingsListeners(this: SidePanelUI & Record<string, unknown>) {
  // Provider change — also refresh model catalog for setup tab
  const debouncedSetupModelRefresh = debounce(() => this.refreshModelCatalog({ force: true }), 800);
  this.elements.provider?.addEventListener('change', () => {
    this.toggleCustomEndpoint();
    this.updateScreenshotToggleState();
    debouncedSetupModelRefresh();
  });

  // Custom endpoint validation + model refresh
  this.elements.customEndpoint?.addEventListener('input', () => {
    this.validateCustomEndpoint();
    debouncedSetupModelRefresh();
  });
  this.elements.apiKey?.addEventListener('input', debouncedSetupModelRefresh);
  this.elements.model?.addEventListener('input', () => {
    if (!this.configs?.[this.currentConfig]) return;
    this.configs[this.currentConfig] = {
      ...this.configs[this.currentConfig],
      model: String(this.elements.model?.value || '').trim(),
    };
    this.populateModelSelect?.();
    this.updateModelDisplay?.();
  });

  // Temperature slider
  this.elements.temperature?.addEventListener('input', () => {
    if (this.elements.temperatureValue) {
      this.elements.temperatureValue.textContent = this.elements.temperature.value;
    }
  });

  // Configuration management
  this.elements.newConfigBtn?.addEventListener('click', () => this.createNewConfig());
  this.elements.newProfileInput?.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.createNewConfig();
    }
  });
  this.elements.deleteConfigBtn?.addEventListener('click', () => this.deleteConfig());
  this.elements.activeConfig?.addEventListener('change', () => this.switchConfig());

  // Settings tabs
  this.elements.settingsTabProvidersBtn?.addEventListener('click', () => this.switchSettingsTab('providers'));
  this.elements.settingsTabModelBtn?.addEventListener('click', () => this.switchSettingsTab('model'));
  this.elements.settingsTabScreenshotsBtn?.addEventListener('click', () => this.switchSettingsTab('screenshots'));
  this.elements.settingsTabDisplayBtn?.addEventListener('click', () => this.switchSettingsTab('display'));
  this.elements.settingsTabPermissionsBtn?.addEventListener('click', () => this.switchSettingsTab('permissions'));
  this.elements.settingsOpenAccountBtn?.addEventListener('click', () => this.openAccountPanel?.());
  this.elements.accountBackToSettingsBtn?.addEventListener('click', () => this.openSettingsPanel?.());
  document.getElementById('usageRefreshBtn')?.addEventListener('click', () => this.refreshUsageTab?.());
  document.getElementById('usageClearBtn')?.addEventListener('click', () => this.clearUsageData?.());
  this.elements.teamProfileList?.addEventListener('change', (event: Event) => {
    const input = event.target as HTMLInputElement | null;
    const profileName = input?.dataset.teamProfile;
    if (!profileName) return;
    this.toggleAuxProfile(profileName);
    void this.persistAllSettings?.({ silent: true });
    this.renderTeamProfileList?.();
  });

  // Screenshot + vision controls
  this.elements.enableScreenshots?.addEventListener('change', () => this.updateScreenshotToggleState());
  this.elements.visionProfile?.addEventListener('change', () => {
    this.updateScreenshotToggleState();
    this.updatePromptSections?.();
  });
  this.elements.sendScreenshotsAsImages?.addEventListener('change', () => this.updateScreenshotToggleState());
  this.elements.orchestratorToggle?.addEventListener('change', () => this.updatePromptSections?.());
  this.elements.orchestratorProfile?.addEventListener('change', () => this.updatePromptSections?.());

  // Screenshots tab controls — sync to active config
  const syncScreenshotsConfig = () => {
    const config = this.configs?.[this.currentConfig];
    if (!config) return;
    if (this.elements.enableScreenshots) config.enableScreenshots = this.elements.enableScreenshots.checked;
    if (this.elements.sendScreenshotsAsImages)
      config.sendScreenshotsAsImages = this.elements.sendScreenshotsAsImages.checked;
    if (this.elements.screenshotQuality) config.screenshotQuality = this.elements.screenshotQuality.value;
    if (this.elements.saveHistory) config.saveHistory = this.elements.saveHistory.checked;
    void this.persistAllSettings?.({ silent: true });
  };
  this.elements.enableScreenshots?.addEventListener('change', syncScreenshotsConfig);
  this.elements.sendScreenshotsAsImages?.addEventListener('change', syncScreenshotsConfig);
  this.elements.screenshotQuality?.addEventListener('change', syncScreenshotsConfig);
  this.elements.saveHistory?.addEventListener('change', syncScreenshotsConfig);

  // Visible orchestrator controls sync with hidden ones
  this.elements.orchestratorToggle?.addEventListener('change', () => {
    const enabled = this.elements.orchestratorToggle?.checked === true;
    const profileGroup = this.elements.orchestratorProfileSelectGroup as HTMLElement | null;
    if (profileGroup) profileGroup.style.display = enabled ? '' : 'none';
    this.updatePromptSections?.();
    this.renderTeamProfileList?.();
  });
  this.elements.orchestratorProfile?.addEventListener('change', () => {
    this.updatePromptSections?.();
  });

  // Auto-save sessions toggle
  this.elements.autoSaveSession?.addEventListener('change', () => {
    const enabled = this.elements.autoSaveSession?.value === 'true';
    const folderGroup = document.getElementById('autoSaveFolderGroup');
    if (folderGroup) folderGroup.style.display = enabled ? '' : 'none';
  });
  this.elements.autoSaveFolderBtn?.addEventListener('click', async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      this._autoSaveDirHandle = handle;
      if (this.elements.autoSaveFolderLabel) this.elements.autoSaveFolderLabel.textContent = handle.name;
    } catch {
      // User cancelled or API unavailable
    }
  });

  // Save settings
  this.elements.saveSettingsBtn?.addEventListener('click', () => {
    void this.saveSettings();
  });
  // Cancel settings
  this.elements.cancelSettingsBtn?.addEventListener('click', () => {
    void this.cancelSettings();
  });

  // Provider headers validation
  this.elements.customHeaders?.addEventListener('input', () => this.validateCustomHeaders());
};

sidePanelProto.setupSettingsListeners = setupSettingsListeners;
