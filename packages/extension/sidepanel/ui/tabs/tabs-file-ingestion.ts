import { SidePanelUI } from '../core/panel-ui.js';
import {
  type ComposerAttachment,
  MAX_INLINE_MEDIA_BYTES,
  MAX_TEXT_CHARS_PER_FILE,
  MAX_TOTAL_TEXT_CHARS,
  classifyFileKind,
  createAttachmentId,
  formatByteSize,
  mergeAttachmentCap,
} from './file-attachment-utils.js';

const sidePanelProto = SidePanelUI.prototype as SidePanelUI & Record<string, unknown>;

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

sidePanelProto.ingestFilesIntoComposer = async function ingestFilesIntoComposer(
  files: File[],
  source: 'picker' | 'paste' | 'drop' = 'picker',
) {
  if (!Array.isArray(files) || files.length === 0) return;

  const existing: ComposerAttachment[] = Array.isArray(this.pendingComposerAttachments)
    ? [...this.pendingComposerAttachments]
    : [];
  const added: ComposerAttachment[] = [];
  let totalTextChars = existing
    .filter((a) => a.kind === 'text' && typeof a.text === 'string')
    .reduce((sum, a) => sum + (a.text?.length || 0), 0);
  let skipped = 0;

  for (const file of files) {
    const mime = String(file.type || '').toLowerCase();
    const name = file.name || `${source}-attachment`;
    const kind = classifyFileKind(name, mime);
    const size = file.size || 0;

    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      if (size > MAX_INLINE_MEDIA_BYTES) {
        skipped += 1;
        this.updateStatus?.(`${name} skipped (media larger than 4MB)`, 'warning');
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        added.push({
          id: createAttachmentId(),
          kind,
          name,
          mimeType: mime || 'application/octet-stream',
          size,
          dataUrl,
        });
      } catch (e) {
        console.warn('Failed to read media attachment', name, e);
        skipped += 1;
      }
      continue;
    }

    if (kind === 'text') {
      if (totalTextChars >= MAX_TOTAL_TEXT_CHARS) {
        skipped += 1;
        this.updateStatus?.('Attachment text budget reached for this turn', 'warning');
        continue;
      }
      try {
        const raw = await file.text();
        const remaining = Math.max(0, MAX_TOTAL_TEXT_CHARS - totalTextChars);
        const cap = Math.min(MAX_TEXT_CHARS_PER_FILE, remaining);
        const truncated = raw.length > cap;
        const text = truncated ? raw.slice(0, cap) : raw;
        totalTextChars += text.length;
        added.push({
          id: createAttachmentId(),
          kind: 'text',
          name,
          mimeType: mime || 'text/plain',
          size,
          text,
          truncated,
        });
      } catch (e) {
        console.warn('Failed to read text file', name, e);
        skipped += 1;
      }
      continue;
    }

    // Binary / unknown: keep metadata so the model still sees name+type.
    added.push({
      id: createAttachmentId(),
      kind: 'file',
      name,
      mimeType: mime || 'application/octet-stream',
      size,
      note: 'Binary content not extracted for chat context',
    });
  }

  this.pendingComposerAttachments = mergeAttachmentCap(existing, added);
  this.renderComposerAttachments?.();

  const ready = this.pendingComposerAttachments.length;
  if (ready > 0) {
    const skipNote = skipped > 0 ? ` (${skipped} skipped)` : '';
    this.updateStatus?.(
      `${ready} attachment${ready === 1 ? '' : 's'} ready${skipNote}`,
      skipped > 0 ? 'warning' : 'active',
    );
  } else if (skipped > 0) {
    this.updateStatus?.('No attachments added', 'warning');
  }
  this.elements.userInput?.focus();
};

sidePanelProto.renderComposerAttachments = function renderComposerAttachments() {
  const el = this.elements.composerAttachments as HTMLElement | null;
  if (!el) return;
  const list: ComposerAttachment[] = Array.isArray(this.pendingComposerAttachments)
    ? this.pendingComposerAttachments
    : [];

  if (!list.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  el.classList.remove('hidden');
  el.innerHTML = list
    .map((a) => {
      const kindLabel = a.kind === 'text' ? 'TXT' : a.kind === 'file' ? 'FILE' : a.kind.toUpperCase();
      const size = formatByteSize(a.size);
      const title = this.escapeHtml?.(`${a.name} (${a.mimeType || 'unknown'}, ${size})`) || a.name;
      const name = this.escapeHtml?.(a.name) || a.name;
      return `<span class="composer-attachment-chip" data-id="${this.escapeHtml?.(a.id) || a.id}" title="${title}">
        <span class="composer-attachment-kind">${kindLabel}</span>
        <span class="composer-attachment-name">${name}</span>
        <button type="button" class="composer-attachment-remove" data-id="${this.escapeHtml?.(a.id) || a.id}" title="Remove attachment" aria-label="Remove ${name}">&times;</button>
      </span>`;
    })
    .join('');

  for (const btn of Array.from(el.querySelectorAll('.composer-attachment-remove'))) {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (id) this.removeComposerAttachment?.(id);
    });
  }
};

sidePanelProto.removeComposerAttachment = function removeComposerAttachment(id: string) {
  if (!id || !Array.isArray(this.pendingComposerAttachments)) return;
  this.pendingComposerAttachments = this.pendingComposerAttachments.filter((a: ComposerAttachment) => a.id !== id);
  this.renderComposerAttachments?.();
};

sidePanelProto.clearComposerAttachments = function clearComposerAttachments() {
  this.pendingComposerAttachments = [];
  this.renderComposerAttachments?.();
};

sidePanelProto.handleFileSelection = async function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  const files = Array.from(input.files || []) as File[];
  if (!files.length) return;

  await this.ingestFilesIntoComposer(files, 'picker');
  input.value = '';
};
