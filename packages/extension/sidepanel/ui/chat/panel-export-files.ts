import { sidePanelProto } from './panel-export-shared.js';
import { getSessionTraces } from './trace-store.js';

sidePanelProto.getSelectedReportImagesForExport = function getSelectedReportImagesForExport() {
  if (!this.reportImages || this.reportImages.size === 0) return [];
  const order =
    Array.isArray(this.reportImageOrder) && this.reportImageOrder.length > 0
      ? this.reportImageOrder
      : Array.from(this.reportImages.keys());
  const selected = this.selectedReportImageIds instanceof Set ? this.selectedReportImageIds : new Set<string>();

  return order
    .map((id: string) => this.reportImages.get(id))
    .filter((image) => {
      if (!image || typeof image !== 'object') return false;
      const obj = image as { id?: unknown; dataUrl?: unknown };
      return typeof obj.dataUrl === 'string' && selected.has(String(obj.id));
    });
};

sidePanelProto.appendSelectedReportImagesMarkdown = function appendSelectedReportImagesMarkdown(markdown: string) {
  const images = this.getSelectedReportImagesForExport();
  if (!images.length) return markdown;

  let next = markdown;
  next += '\n---\n\n## Selected Report Images\n\n';
  images.forEach((image: unknown, index: number) => {
    const img = image as {
      title?: unknown;
      url?: unknown;
      id?: unknown;
      capturedAt?: unknown;
      visionDescription?: unknown;
      dataUrl?: unknown;
    };
    const label = String(img.title || img.url || img.id || '');
    next += `### Image ${index + 1}: ${label}\n\n`;
    next += `- **ID:** ${String(img.id || '')}\n`;
    next += `- **Captured:** ${new Date(Number(img.capturedAt || Date.now())).toLocaleString()}\n`;
    if (img.url) next += `- **Source URL:** ${String(img.url)}\n`;
    if (img.visionDescription) next += `- **Vision Notes:** ${String(img.visionDescription)}\n`;
    next += '\n';
    next += `![Report image ${index + 1}](${String(img.dataUrl || '')})\n\n`;
  });
  return next;
};

sidePanelProto.extractTextContent = function extractTextContent(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (part.type === 'text' && part.text) return part.text;
          if (part.type === 'tool-result') {
            const output = part.output;
            if (output && typeof output === 'object') {
              if (output.type === 'text' && output.value) return output.value;
              if (output.type === 'json') return JSON.stringify(output.value, null, 2);
              return JSON.stringify(output, null, 2);
            }
            return String(output || '');
          }
          return part.text || part.content || '';
        }
        return '';
      })
      .join('\n');
  }
  return String(content);
};

sidePanelProto.downloadFile = function downloadFile(content: string, filename: string, mimeType: string): void {
  // Sidepanel-first: blob + anchor is reliable in extension pages and is synchronous from the
  // user's click (no message-port race with the service worker).
  try {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1000);
    return;
  } catch {
    // Fall through to background chrome.downloads
  }

  chrome.runtime.sendMessage({
    type: 'download_file',
    content,
    filename,
    mimeType,
  });
};

sidePanelProto.downloadMarkdown = function downloadMarkdown(content: string, filename: string): void {
  this.downloadFile(content, filename, 'text/markdown');
  this.updateStatus(`Exported to ${filename}`, 'success');
};

sidePanelProto.autoSaveSessionJsonl = async function autoSaveSessionJsonl(): Promise<void> {
  let autoSaveEnabled = false;
  try {
    const stored = await chrome.storage.local.get('autoSaveSession');
    autoSaveEnabled = stored.autoSaveSession === true || stored.autoSaveSession === 'true';
  } catch {
    /* ignore */
  }
  if (!autoSaveEnabled) return;
  if (!this.displayHistory || this.displayHistory.length === 0) return;

  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      kind: 'session_meta',
      sessionId: this.sessionId || '',
      startedAt: this.sessionStartedAt || Date.now(),
      endedAt: Date.now(),
      title: this.firstUserMessage || '',
      tokenTotals: this.sessionTokenTotals || {},
      messageCount: this.displayHistory.length,
    }),
  );

  let traces: unknown[] = [];
  try {
    traces = await getSessionTraces(this.sessionId);
  } catch {
    /* ignore */
  }

  if (traces.length > 0) {
    for (const ev of traces) lines.push(JSON.stringify(ev));
  } else {
    for (const msg of this.displayHistory) {
      const entry: Record<string, unknown> = {
        kind: 'display_message',
        role: msg.role || '',
        content: typeof msg.content === 'string' ? msg.content : this.extractTextContent(msg.content),
      };
      if (msg.thinking) entry.thinking = msg.thinking;
      if (msg.meta) entry.meta = msg.meta;
      lines.push(JSON.stringify(entry));
    }
  }

  const selectedImages = this.getSelectedReportImagesForExport?.() || [];
  for (const img of selectedImages) {
    lines.push(
      JSON.stringify({
        kind: 'report_image',
        id: img.id,
        capturedAt: img.capturedAt,
        url: img.url || '',
        title: img.title || '',
        dataUrl: img.dataUrl || '',
      }),
    );
  }

  const content = `${lines.join('\n')}\n`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `session-${timestamp}.jsonl`;

  if (this._autoSaveDirHandle) {
    try {
      const fileHandle = await this._autoSaveDirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      this.updateStatus?.(`Session auto-saved to ${filename}`, 'success');
      return;
    } catch {
      // Fall through to anchor download
    }
  }

  this.downloadFile(content, filename, 'application/x-ndjson');
  this.updateStatus?.(`Session auto-saved to ${filename}`, 'success');
};
