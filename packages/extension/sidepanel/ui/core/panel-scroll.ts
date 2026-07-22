import { SidePanelUI } from './panel-ui.js';
const sidePanelProto = SidePanelUI.prototype as SidePanelUI & Record<string, unknown>;

sidePanelProto.scrollToBottom = function scrollToBottom({ force = false } = {}) {
  if (!this.elements.chatMessages) return;
  if (!force && !this.shouldAutoScroll()) return;
  requestAnimationFrame(() => {
    this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    this.isNearBottom = true;
    this.userScrolledUp = false;
    this.updateScrollButton();
  });
};

sidePanelProto.shouldAutoScroll = function shouldAutoScroll() {
  const config = this.configs?.[this.currentConfig] || {};
  const autoScrollEnabled = config.autoScroll !== false;
  return autoScrollEnabled && !this.userScrolledUp;
};

sidePanelProto.handleChatScroll = function handleChatScroll() {
  if (!this.elements.chatMessages) return;
  const { scrollTop, scrollHeight, clientHeight } = this.elements.chatMessages;
  const nearBottom = scrollHeight - scrollTop - clientHeight < 60;
  this.isNearBottom = nearBottom;
  this.userScrolledUp = !nearBottom;
  this.recordScrollPosition();
  this.updateScrollButton();
};

sidePanelProto.recordScrollPosition = function recordScrollPosition() {
  if (!this.elements.chatMessages) return;
  this.scrollPositions.set(this.sessionId, this.elements.chatMessages.scrollTop);
};

sidePanelProto.restoreScrollPosition = function restoreScrollPosition() {
  if (!this.elements.chatMessages) return;
  const saved = this.scrollPositions.get(this.sessionId);
  if (saved !== undefined) {
    requestAnimationFrame(() => {
      this.elements.chatMessages.scrollTop = saved;
      this.handleChatScroll();
    });
  } else {
    this.scrollToBottom({ force: true });
  }
};

sidePanelProto.updateScrollButton = function updateScrollButton() {
  if (!this.elements.scrollToLatestBtn) return;
  this.elements.scrollToLatestBtn.classList.toggle('hidden', !this.userScrolledUp);
};
