/** Composer file-attachment helpers (pure; unit-testable). */

export type ComposerAttachmentKind = 'image' | 'video' | 'audio' | 'text' | 'file';

export type ComposerAttachment = {
  id: string;
  kind: ComposerAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  text?: string;
  truncated?: boolean;
  note?: string;
};

export const MAX_COMPOSER_ATTACHMENTS = 12;
export const MAX_INLINE_MEDIA_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_CHARS_PER_FILE = 100_000;
export const MAX_TOTAL_TEXT_CHARS = 200_000;

const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'text',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'log',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'cs',
  'sh',
  'bash',
  'zsh',
  'fish',
  'env',
  'ini',
  'conf',
  'cfg',
  'toml',
  'yaml',
  'yml',
  'sql',
  'r',
  'php',
  'vue',
  'svelte',
  'graphql',
  'gql',
  'diff',
  'patch',
  'svg',
  'rst',
  'tex',
  'adoc',
  'properties',
  'plist',
  'gitignore',
  'dockerignore',
  'editorconfig',
  'dockerfile',
  'makefile',
  'cmake',
  'lock',
  'map',
]);

export function extensionOf(name: string): string {
  const base =
    String(name || '')
      .split(/[/\\]/)
      .pop() || '';
  if (base.startsWith('.') && !base.slice(1).includes('.')) return base.slice(1).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isTextLikeFile(name: string, mimeType = ''): boolean {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript' ||
    mime === 'application/x-yaml' ||
    mime === 'application/yaml' ||
    mime === 'application/toml' ||
    mime === 'application/sql' ||
    mime === 'application/graphql' ||
    mime === 'application/x-sh' ||
    mime === 'application/xhtml+xml' ||
    mime.endsWith('+xml') ||
    mime.endsWith('+json')
  ) {
    return true;
  }
  const ext = extensionOf(name);
  if (!ext) {
    // Common extensionless config files
    const lower = String(name || '').toLowerCase();
    return (
      lower === 'dockerfile' ||
      lower === 'makefile' ||
      lower === 'gemfile' ||
      lower === 'procfile' ||
      lower === 'license' ||
      lower === 'readme' ||
      lower.endsWith('rc')
    );
  }
  return TEXT_EXTENSIONS.has(ext);
}

export function classifyFileKind(name: string, mimeType = ''): ComposerAttachmentKind {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  // SVG often arrives as image/svg+xml; already image above. If not:
  if (extensionOf(name) === 'svg') return 'text';
  if (isTextLikeFile(name, mime)) return 'text';
  return 'file';
}

const EXTRACTABLE_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx']);

const EXTRACTABLE_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const LEGACY_OFFICE_EXTENSIONS = new Set(['doc', 'xls', 'ppt']);

/** Modern OOXML / PDF that we extract client-side for chat context. */
export function isExtractableDocument(name: string, mimeType = ''): boolean {
  const mime = String(mimeType || '').toLowerCase();
  if (EXTRACTABLE_MIMES.has(mime)) return true;
  return EXTRACTABLE_EXTENSIONS.has(extensionOf(name));
}

/** Legacy binary Office — not extracted in-extension. */
export function isLegacyOfficeDocument(name: string, mimeType = ''): boolean {
  const mime = String(mimeType || '').toLowerCase();
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint'
  ) {
    return true;
  }
  return LEGACY_OFFICE_EXTENSIONS.has(extensionOf(name));
}

export function isHtmlFile(name: string, mimeType = ''): boolean {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return true;
  const ext = extensionOf(name);
  return ext === 'html' || ext === 'htm';
}

/** Prefer raw HTML source when small/simple; otherwise readable text extract. */
export function prepareHtmlAttachmentText(
  raw: string,
  maxChars: number,
): { text: string; truncated: boolean; note?: string } {
  const source = String(raw || '');
  const cap = Math.max(0, Math.floor(maxChars) || 0);
  const withoutNoise = source
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const tagCount = (withoutNoise.match(/</g) || []).length;
  const preferReadable = withoutNoise.length > 24_000 || tagCount > 800;

  if (!preferReadable) {
    const truncated = withoutNoise.length > cap;
    return {
      text: truncated ? withoutNoise.slice(0, cap) : withoutNoise,
      truncated,
      note: withoutNoise.length !== source.length ? 'scripts/styles stripped from HTML source' : undefined,
    };
  }

  const readable = htmlToReadableText(withoutNoise);
  const header = '[HTML readable text; scripts/styles removed]\n';
  const body = header + readable;
  const truncated = body.length > cap;
  return {
    text: truncated ? body.slice(0, cap) : body,
    truncated,
    note: 'large/noisy HTML reduced to readable text',
  };
}

function htmlToReadableText(html: string): string {
  return String(html || '')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer|nav|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function createAttachmentId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatByteSize(size: number): string {
  const n = Math.max(0, Number(size) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Build model-facing context block from pending attachments. */
export function formatAttachmentContext(attachments: ComposerAttachment[]): string {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';

  const blocks: string[] = [];
  for (const a of list) {
    const name = a.name || 'attachment';
    const meta = `${a.mimeType || 'unknown'}, ${formatByteSize(a.size)}`;
    // Prefer extracted/inlined text when present (text files + PDF/Office extracts).
    if (typeof a.text === 'string' && a.text.length > 0) {
      const body = a.truncated ? `${a.text}\n… (truncated)` : a.text;
      blocks.push(`[File: ${name}]\n${body}`);
      continue;
    }
    if (a.kind === 'image' || a.kind === 'video' || a.kind === 'audio') {
      blocks.push(`[Attached ${a.kind}: ${name} (${meta})]`);
      continue;
    }
    const note = a.note || 'Binary content not extracted for chat context';
    blocks.push(`[Attached file: ${name} (${meta}) — ${note}]`);
  }
  return `\n\n${blocks.join('\n\n')}`;
}

export function imageDataUrlsFromAttachments(
  attachments: ComposerAttachment[],
): Array<{ dataUrl: string; name?: string }> {
  return (Array.isArray(attachments) ? attachments : [])
    .filter((a) => a?.kind === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.length > 0)
    .map((a) => ({ dataUrl: a.dataUrl as string, name: a.name }));
}

export function mergeAttachmentCap(
  existing: ComposerAttachment[],
  incoming: ComposerAttachment[],
  max = MAX_COMPOSER_ATTACHMENTS,
): ComposerAttachment[] {
  return [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].slice(-max);
}
