import { SidePanelUI } from '../core/panel-ui.js';

const sidePanelProto = SidePanelUI.prototype as SidePanelUI & Record<string, unknown>;

sidePanelProto.switchSettingsTab = function switchSettingsTab(
  tabName: 'providers' | 'model' | 'screenshots' | 'display' | 'permissions' | string = 'providers',
) {
  const tabMap: Record<string, string> = {
    connect: 'providers',
    setup: 'providers',
    oauth: 'providers',
    profiles: 'model',
    look: 'display',
    design: 'display',
    theme: 'display',
    agents: 'permissions',
    system: 'permissions',
    usage: 'permissions',
  };
  const resolvedTab = (tabMap[tabName] || tabName) as 'providers' | 'model' | 'screenshots' | 'display' | 'permissions';
  this.currentSettingsTab = resolvedTab;

  const tabs = ['providers', 'model', 'screenshots', 'display', 'permissions'] as const;
  const tabElements: Record<string, HTMLElement | null> = {
    providers: this.elements.settingsTabProviders || document.getElementById('settingsTabProviders'),
    model: this.elements.settingsTabModel || document.getElementById('settingsTabModel'),
    screenshots: document.getElementById('settingsTabScreenshots'),
    display: document.getElementById('settingsTabDisplay'),
    permissions: this.elements.settingsTabPermissions || document.getElementById('settingsTabPermissions'),
  };
  const btnElements: Record<string, HTMLElement | null> = {
    providers: this.elements.settingsTabProvidersBtn || document.getElementById('settingsTabProvidersBtn'),
    model: this.elements.settingsTabModelBtn || document.getElementById('settingsTabModelBtn'),
    screenshots: document.getElementById('settingsTabScreenshotsBtn'),
    display: document.getElementById('settingsTabDisplayBtn'),
    permissions: this.elements.settingsTabPermissionsBtn || document.getElementById('settingsTabPermissionsBtn'),
  };

  for (const tab of tabs) {
    const isActive = tab === resolvedTab;
    tabElements[tab]?.classList.toggle('hidden', !isActive);
    btnElements[tab]?.classList.toggle('active', isActive);
    const pane = tabElements[tab]?.querySelector('.settings-tab-pane') as HTMLElement | null;
    pane?.classList.toggle('active', isActive);
    btnElements[tab]?.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }

  if (resolvedTab === 'providers') {
    // Connect: Grok (OAuth) + Ollama Cloud (API key).
    this.renderOAuthProviderGrid?.();
    this.renderApiProviderGrid?.();
  }
  if (resolvedTab === 'model') {
    this.renderModelSelectorGrid?.();
  }
  if (resolvedTab === 'display') {
    this.renderThemeGrid?.();
  }
};

sidePanelProto.cancelSettings = async function cancelSettings() {
  await this.loadSettings();
  this.openChatView?.();
};
