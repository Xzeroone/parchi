// Account panel — Grok connection identity (name/email) + connect/disconnect.
import { SidePanelUI } from '../core/panel-ui.js';
const sidePanelProto = SidePanelUI.prototype as SidePanelUI & Record<string, unknown>;

// Import submodules (side-effect registration) — kept for setup-flow helpers.
import './account-auth.js';
import './account-billing.js';
import './account-managed.js';
import './account-profile.js';
import './account-setup-state.js';

import { getAllProviderStates } from '../../../oauth/manager.js';
import { getProviderSvg } from '../settings/panel-model-selector.js';
import { setHidden, updateStatusCopy } from './account-formatters.js';

const GROK_KEY = 'xai' as const;

function resolveGrokDisplayName(
  state: {
    email?: string;
    tokens?: { email?: string; accountId?: string };
  } | null,
): string {
  const email = String(state?.email || state?.tokens?.email || '').trim();
  if (email) return email;
  const accountId = String(state?.tokens?.accountId || '').trim();
  if (accountId) return accountId;
  return '';
}

sidePanelProto.setAccountUiBusy = function setAccountUiBusy(busy: boolean) {
  const button = this.elements.accountGrokConnectBtn as HTMLButtonElement | null;
  if (button) button.disabled = busy;
};

sidePanelProto.bindAccountEventListeners = function bindAccountEventListeners() {
  if (this._accountListenersBound) return;
  this._accountListenersBound = true;

  this.elements.accountChooseByokBtn?.addEventListener('click', () => {
    void this.chooseAccountMode('byok');
  });
  this.elements.accountChoosePaidBtn?.addEventListener('click', () => {
    void this.chooseAccountMode('paid');
  });

  this.elements.accountGrokConnectBtn?.addEventListener('click', () => {
    void this.handleAccountGrokConnectClick?.();
  });
};

sidePanelProto.handleAccountGrokConnectClick = async function handleAccountGrokConnectClick() {
  const states = await getAllProviderStates();
  const state = states[GROK_KEY];
  const connected = Boolean(state?.connected && state?.tokens?.accessToken);

  if (connected) {
    await this.startOAuthDisconnect?.(GROK_KEY);
    await this.refreshAccountPanel?.({ silent: true });
    this.renderOAuthProviderGrid?.();
    return;
  }

  // Device-code UI lives on the Connect tab — open it, then start the flow.
  this.openSettingsPanel?.();
  this.switchSettingsTab?.('connect');
  await this.startOAuthConnect?.(GROK_KEY);
  await this.refreshAccountPanel?.({ silent: true });
};

sidePanelProto.refreshAccountPanel = async function refreshAccountPanel({ silent = false } = {}) {
  this.setAccountUiBusy(true);
  try {
    const states = await getAllProviderStates();
    const state = states[GROK_KEY] || null;
    const connected = Boolean(state?.connected && state?.tokens?.accessToken);
    const displayName = resolveGrokDisplayName(state);
    const error = String(state?.error || '').trim();

    const nameEl = this.elements.accountGrokName as HTMLElement | null;
    const metaEl = this.elements.accountGrokMeta as HTMLElement | null;
    const statusText = this.elements.accountGrokStatusText as HTMLElement | null;
    const statusDot = this.elements.accountGrokStatusDot as HTMLElement | null;
    const rowDot = this.elements.accountGrokRowDot as HTMLElement | null;
    const row = this.elements.accountGrokProviderRow as HTMLElement | null;
    const connectBtn = this.elements.accountGrokConnectBtn as HTMLButtonElement | null;
    const logoEl = this.elements.accountGrokLogo as HTMLElement | null;

    if (logoEl && !logoEl.innerHTML) {
      logoEl.innerHTML = getProviderSvg(GROK_KEY);
    }

    if (connected) {
      const label = displayName || 'Grok account';
      if (nameEl) nameEl.textContent = label;
      if (metaEl)
        metaEl.textContent = displayName ? 'Connected to Grok' : 'Connected to Grok (account name unavailable)';
      if (statusText) statusText.textContent = displayName ? `Connected · ${displayName}` : 'Connected';
      statusDot?.classList.remove('off');
      rowDot?.classList.remove('off');
      row?.classList.add('connected');
      row?.classList.remove('dim');
      if (connectBtn) connectBtn.textContent = 'Disconnect';
      if (this.elements.accountUserValue) this.elements.accountUserValue.textContent = label;
      updateStatusCopy(this, displayName ? `Grok · ${displayName}` : 'Grok connected');
      if (!silent) this.updateStatus('Grok account ready', 'success');
    } else {
      if (nameEl) nameEl.textContent = 'Not connected';
      if (metaEl) {
        metaEl.textContent = error || 'Connect Grok to run chat and tools.';
      }
      if (statusText) statusText.textContent = error || 'Not connected';
      statusDot?.classList.add('off');
      rowDot?.classList.add('off');
      row?.classList.remove('connected');
      row?.classList.add('dim');
      if (connectBtn) connectBtn.textContent = 'Connect';
      if (this.elements.accountUserValue) this.elements.accountUserValue.textContent = '-';
      updateStatusCopy(this, error || 'Connect Grok to continue.');
      if (!silent) this.updateStatus(error || 'Grok not connected', error ? 'error' : 'warning');
    }

    // Hide any legacy managed-billing blocks if present.
    setHidden(this.elements.accountAuthUnavailable, true);
    setHidden(this.elements.accountAuthSignedOut, true);
    setHidden(this.elements.accountAuthSignedIn, true);

    this.syncAccountAvatar?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Failed to load Grok account');
    updateStatusCopy(this, message);
    if (!silent) this.updateStatus('Unable to load Grok account', 'error');
  } finally {
    this.setAccountUiBusy(false);
    await this.refreshSetupFlowUi?.();
  }
};
