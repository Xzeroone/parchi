import { SidePanelUI } from '../core/panel-ui.js';
const sidePanelProto = SidePanelUI.prototype as SidePanelUI & Record<string, unknown>;

import {
  ACCOUNT_SETUP_STORAGE_KEYS,
  PARCHI_RUNTIME_STATUS_KEY,
  setHidden,
  updateStatusCopy,
} from './account-formatters.js';
import { ACCOUNT_MODE_BYOK, ACCOUNT_MODE_KEY, ACCOUNT_MODE_PAID, hasConfiguredByokProvider } from './account-mode.js';

sidePanelProto.refreshSetupFlowUi = async function refreshSetupFlowUi() {
  const setupState = await this.getSetupFlowState();
  const showSetupButton = !setupState.setupComplete;
  setHidden(this.elements.setupAccessBtn, !showSetupButton);
  setHidden(this.elements.modelSelectorWrap, showSetupButton);

  if (this.elements.setupAccessBtn) {
    this.elements.setupAccessBtn.textContent = setupState.setupButtonLabel;
    this.elements.setupAccessBtn.title = setupState.setupButtonLabel;
  }

  await this.renderPaidModeProviderGrid?.();
  this.updateActivityState?.();
};

sidePanelProto.renderPaidModeProviderGrid = async function renderPaidModeProviderGrid() {
  // Paid/managed provider grid removed — product is Grok-only.
  // Keep method as a no-op for any lingering callers.
  const grid = this.elements.paidModeProviderGrid || document.getElementById('paidModeProviderGrid');
  if (grid) grid.innerHTML = '';
};

sidePanelProto.handleSetupAccessClick = async function handleSetupAccessClick() {
  const setupState = await this.getSetupFlowState();
  if (!setupState.hasChoice && !setupState.hasConfiguredProvider) {
    setHidden(this.elements.accountOnboardingModal, false);
    this.updateStatus('Connect Grok to continue, or enable optional managed billing.', 'warning');
    updateStatusCopy(this, 'Connect Grok to continue, or enable optional managed billing.');
    return;
  }

  if (setupState.mode === ACCOUNT_MODE_PAID) {
    this.openAccountPanel?.();
    this.updateStatus('Finish paid setup in Account & Billing to unlock Parchi managed access.', 'active');
    return;
  }

  this.openSettingsPanel?.();
  this.switchSettingsTab?.('connect');
  this.updateStatus('Connect Grok to finish setup.', 'active');
};

sidePanelProto.showAccountOnboardingIfNeeded = async function showAccountOnboardingIfNeeded() {
  const stored = await chrome.storage.local.get(ACCOUNT_SETUP_STORAGE_KEYS as unknown as string[]);
  const hasChoice = stored[ACCOUNT_MODE_KEY] === ACCOUNT_MODE_BYOK || stored[ACCOUNT_MODE_KEY] === ACCOUNT_MODE_PAID;
  if (hasChoice) {
    setHidden(this.elements.accountOnboardingModal, true);
    await this.refreshSetupFlowUi();
    return;
  }

  const hasConfiguredProvider = hasConfiguredByokProvider(stored);
  if (hasConfiguredProvider) {
    await chrome.storage.local.set({ [ACCOUNT_MODE_KEY]: ACCOUNT_MODE_BYOK });
    setHidden(this.elements.accountOnboardingModal, true);
    await this.refreshSetupFlowUi();
    return;
  }

  updateStatusCopy(this, 'Connect Grok to continue, or enable optional managed billing.');
  this.updateStatus('Connect Grok to continue.', 'warning');
  // Keep onboarding non-blocking by default; setup button opens guided flow when needed.
  setHidden(this.elements.accountOnboardingModal, true);
  await this.refreshSetupFlowUi();
};

sidePanelProto.chooseAccountMode = async function chooseAccountMode(mode: 'byok' | 'paid') {
  await chrome.storage.local.set({ [ACCOUNT_MODE_KEY]: mode });
  if (mode === ACCOUNT_MODE_BYOK) {
    await chrome.storage.local.remove([PARCHI_RUNTIME_STATUS_KEY]);
  }
  setHidden(this.elements.accountOnboardingModal, true);
  if (mode === ACCOUNT_MODE_BYOK) {
    this.openSettingsPanel?.();
    this.switchSettingsTab?.('connect');
    this.updateStatus('Connect Grok to finish setup.', 'success');
    updateStatusCopy(this, 'Connect Grok in Settings → Connect.');
    await this.refreshSetupFlowUi();
    return;
  }
  // Managed path deprecated — always route to Grok connect.
  this.openSettingsPanel?.();
  this.switchSettingsTab?.('connect');
  this.updateStatus('Connect Grok to finish setup.', 'active');
  updateStatusCopy(this, 'Connect Grok in Settings → Connect.');
  await this.refreshSetupFlowUi();
};

sidePanelProto.initAccountPanel = async function initAccountPanel() {
  this.bindAccountEventListeners();
  await this.refreshAccountPanel({ silent: true });
  await this.showAccountOnboardingIfNeeded();
  await this.refreshSetupFlowUi();
  this.renderOAuthProviderGrid?.();
};
