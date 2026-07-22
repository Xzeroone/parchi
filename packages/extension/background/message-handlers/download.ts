/**
 * Message Handler - Download
 * Handles download_file messages from the side panel
 */

import type { ServiceContext } from '../service-context.js';

function contentToDataUrl(content: string, mimeType: string): string {
  // Prefer base64 data URL so we don't rely on FileReader (which races with
  // the message-router's "must respond before return" contract).
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  const safeMime = mimeType.includes(';') ? mimeType : `${mimeType};charset=utf-8`;
  return `data:${safeMime};base64,${base64}`;
}

function downloadsDownload(options: chrome.downloads.DownloadOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Download failed'));
        return;
      }
      resolve(downloadId);
    });
  });
}

export async function handleDownloadFile(_ctx: ServiceContext, message: any, sendResponse: (response?: any) => void) {
  try {
    const content = String(message.content ?? '');
    const filename = String(message.filename ?? 'download');
    const mimeType = String(message.mimeType ?? 'text/plain');

    if (!content) {
      sendResponse({ success: false, error: 'content is required' });
      return;
    }

    const dataUrl = contentToDataUrl(content, mimeType);
    const downloadId = await downloadsDownload({
      url: dataUrl,
      filename,
      saveAs: false,
    });
    sendResponse({ success: true, downloadId });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    sendResponse({ success: false, error: err.message });
  }
}
