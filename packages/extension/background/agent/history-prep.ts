import { normalizeConversationHistory } from '../../ai/messages/schema.js';
import type { Message } from '../../ai/messages/schema.js';
import type { RecordedContext } from './agent-loop/shared.js';

export type MessageAttachment = {
  kind?: string;
  dataUrl?: string;
  name?: string;
};

export function prepareConversationHistory(
  userMessage: string,
  conversationHistory: Message[],
  recordedContext?: RecordedContext,
  attachments?: MessageAttachment[],
) {
  const historyInput = Array.isArray(conversationHistory) ? conversationHistory : [];
  const trimmedUserMessage = typeof userMessage === 'string' ? userMessage.trim() : '';

  let enrichedUserMessage = userMessage;
  let recordedImages: Array<{ dataUrl: string }> = [];
  if (recordedContext && typeof recordedContext === 'object' && recordedContext.summary) {
    enrichedUserMessage = `${userMessage}\n\n${recordedContext.summary}`;
    if (Array.isArray(recordedContext.selectedImages)) {
      recordedImages = recordedContext.selectedImages;
    }
  }

  // Sidepanel image attachments (picker/paste/drop) → same vision path as recording frames.
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (attachment?.kind !== 'image') continue;
      if (typeof attachment.dataUrl !== 'string' || !attachment.dataUrl) continue;
      recordedImages.push({ dataUrl: attachment.dataUrl });
    }
  }

  const lastMessage = historyInput[historyInput.length - 1];
  const lastContentText = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
  const shouldReplaceLastUserMessage =
    !!trimmedUserMessage &&
    !!lastMessage &&
    lastMessage.role === 'user' &&
    lastContentText === userMessage &&
    lastContentText !== enrichedUserMessage;
  const shouldAppendUserMessage =
    !!trimmedUserMessage &&
    (!lastMessage ||
      lastMessage.role !== 'user' ||
      (lastContentText !== enrichedUserMessage && !shouldReplaceLastUserMessage));
  const historyWithUserMessage = shouldReplaceLastUserMessage
    ? [...historyInput.slice(0, -1), { role: 'user' as const, content: enrichedUserMessage }]
    : shouldAppendUserMessage
      ? [...historyInput, { role: 'user' as const, content: enrichedUserMessage }]
      : historyInput;

  return {
    historyInput,
    historyWithUserMessage,
    normalizedHistory: normalizeConversationHistory(historyWithUserMessage),
    recordedImages,
    shouldAppendUserMessage,
    shouldReplaceLastUserMessage,
  };
}
