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
    if (a.kind === 'text' && typeof a.text === 'string') {
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
