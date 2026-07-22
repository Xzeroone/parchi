/** Client-side text extraction for PDF and modern Office (OOXML) attachments. */

import JSZip from 'jszip';
import { extensionOf } from './file-attachment-utils.js';

export type DocumentExtractResult = { ok: true; text: string } | { ok: false; error: string };

let pdfWorkerConfigured = false;

async function loadPdfJs() {
  // Legacy build works in Node unit tests and extension pages without canvas.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfWorkerConfigured) {
    // Only pin workerSrc inside the extension (bundled worker copied by build.mjs).
    // In Node unit tests, leave unset so pdfjs uses its built-in fake worker.
    try {
      if (typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function') {
        pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('sidepanel/pdf.worker.min.mjs');
      }
    } catch {
      // Leave default; extraction still proceeds via fake worker when available.
    }
    pdfWorkerConfigured = true;
  }
  return pdfjs;
}

function decodeXmlEntities(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
}

/** Pull inner text of repeated XML tags (e.g. w:t, a:t). Preserve interior spaces. */
export function collectXmlTagText(xml: string, localName: string): string[] {
  const re = new RegExp(`<${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</${localName}>`, 'gi');
  const out: string[] = [];
  let match: RegExpExecArray | null = re.exec(xml);
  while (match) {
    const raw = match[1] || '';
    // Do not trim individual runs — OOXML uses space-only <w:t> for spacing.
    const cleaned = decodeXmlEntities(raw.replace(/<[^>]+>/g, ''));
    if (cleaned.length) out.push(cleaned);
    match = re.exec(xml);
  }
  return out;
}

export async function extractPdfText(data: ArrayBuffer | Uint8Array, maxChars: number): Promise<DocumentExtractResult> {
  try {
    const pdfjs = await loadPdfJs();
    // Copy into a tight Uint8Array — pdfjs is sensitive to oversized ArrayBuffers.
    const bytes =
      data instanceof Uint8Array ? data.slice() : new Uint8Array(data instanceof ArrayBuffer ? data.slice(0) : data);
    const doc = await pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
      disableFontFace: true,
    }).promise;
    try {
      const parts: string[] = [];
      let total = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        if (total >= maxChars) break;
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: unknown) => {
            if (item && typeof item === 'object' && 'str' in item) {
              const str = (item as { str?: unknown }).str;
              return typeof str === 'string' ? str : '';
            }
            return '';
          })
          .filter((s: string) => s.trim())
          .join(' ')
          .trim();
        if (!pageText) continue;
        const block = `--- page ${i} ---\n${pageText}`;
        parts.push(block);
        total += block.length + 1;
      }
      const text = parts.join('\n').slice(0, Math.max(0, maxChars));
      if (!text.trim()) {
        return { ok: false, error: 'PDF contained no extractable text (may be scanned/image-only)' };
      }
      return { ok: true, text };
    } finally {
      await doc.destroy();
    }
  } catch (e) {
    return { ok: false, error: `PDF extraction failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function extractDocxText(data: ArrayBuffer, maxChars: number): Promise<DocumentExtractResult> {
  try {
    const zip = await JSZip.loadAsync(data);
    const docFile = zip.file('word/document.xml');
    if (!docFile) return { ok: false, error: 'DOCX missing word/document.xml' };
    const xml = await docFile.async('text');
    // Split on paragraph ends, then collect w:t runs inside each chunk.
    const paragraphs = xml
      .replace(/<\/w:p>/gi, '\n')
      .split('\n')
      .map((chunk) => collectXmlTagText(chunk, 'w:t').join('').trim())
      .filter(Boolean);
    const body = paragraphs.join('\n').slice(0, Math.max(0, maxChars));
    if (!body.trim()) return { ok: false, error: 'DOCX contained no extractable text' };
    return { ok: true, text: body };
  } catch (e) {
    return { ok: false, error: `DOCX extraction failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function extractPptxText(data: ArrayBuffer, maxChars: number): Promise<DocumentExtractResult> {
  try {
    const zip = await JSZip.loadAsync(data);
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml$/i)?.[1] || 0);
        const nb = Number(b.match(/slide(\d+)\.xml$/i)?.[1] || 0);
        return na - nb;
      });
    if (!slideNames.length) return { ok: false, error: 'PPTX has no slides' };

    const parts: string[] = [];
    let total = 0;
    for (let i = 0; i < slideNames.length; i++) {
      if (total >= maxChars) break;
      const file = zip.file(slideNames[i]!);
      if (!file) continue;
      const xml = await file.async('text');
      const texts = collectXmlTagText(xml, 'a:t');
      if (!texts.length) continue;
      const block = `--- slide ${i + 1} ---\n${texts.join('\n')}`;
      parts.push(block);
      total += block.length + 1;
    }
    const text = parts.join('\n').slice(0, Math.max(0, maxChars));
    if (!text.trim()) return { ok: false, error: 'PPTX contained no extractable text' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: `PPTX extraction failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let m: RegExpExecArray | null = siRe.exec(xml);
  while (m) {
    const parts = collectXmlTagText(m[1] || '', 't');
    strings.push(parts.join(''));
    m = siRe.exec(xml);
  }
  return strings;
}

export async function extractXlsxText(data: ArrayBuffer, maxChars: number): Promise<DocumentExtractResult> {
  try {
    const zip = await JSZip.loadAsync(data);
    const sharedFile = zip.file('xl/sharedStrings.xml');
    const shared = sharedFile ? parseSharedStrings(await sharedFile.async('text')) : [];

    const sheetNames = Object.keys(zip.files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const na = Number(a.match(/sheet(\d+)\.xml$/i)?.[1] || 0);
        const nb = Number(b.match(/sheet(\d+)\.xml$/i)?.[1] || 0);
        return na - nb;
      });
    if (!sheetNames.length) return { ok: false, error: 'XLSX has no worksheets' };

    const parts: string[] = [];
    let total = 0;
    const maxRowsPerSheet = 500;
    for (let s = 0; s < sheetNames.length; s++) {
      if (total >= maxChars) break;
      const file = zip.file(sheetNames[s]!);
      if (!file) continue;
      const xml = await file.async('text');
      const rows: string[] = [];
      const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
      let rowMatch: RegExpExecArray | null = rowRe.exec(xml);
      let rowCount = 0;
      while (rowMatch && rowCount < maxRowsPerSheet && total < maxChars) {
        const rowXml = rowMatch[1] || '';
        const cells: string[] = [];
        const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
        let cellMatch: RegExpExecArray | null = cellRe.exec(rowXml);
        while (cellMatch) {
          const attrs = cellMatch[1] || cellMatch[3] || '';
          const body = cellMatch[2] || '';
          const isShared = /\bt\s*=\s*["']s["']/.test(attrs);
          const isInline = /\bt\s*=\s*["']inlineStr["']/.test(attrs);
          let value = '';
          if (isInline) {
            value = collectXmlTagText(body, 't').join('');
          } else {
            const vMatch = body.match(/<v[^>]*>([\s\S]*?)<\/v>/i);
            const raw = vMatch ? decodeXmlEntities(vMatch[1] || '').trim() : '';
            if (isShared) {
              const idx = Number(raw);
              value = Number.isFinite(idx) ? shared[idx] || '' : '';
            } else {
              value = raw;
            }
          }
          if (value) cells.push(value);
          cellMatch = cellRe.exec(rowXml);
        }
        if (cells.length) {
          rows.push(cells.join('\t'));
          rowCount += 1;
        }
        rowMatch = rowRe.exec(xml);
      }
      if (!rows.length) continue;
      const block = `--- sheet ${s + 1} ---\n${rows.join('\n')}`;
      parts.push(block);
      total += block.length + 1;
    }
    const text = parts.join('\n').slice(0, Math.max(0, maxChars));
    if (!text.trim()) return { ok: false, error: 'XLSX contained no extractable cell values' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: `XLSX extraction failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function extractDocumentText(
  data: ArrayBuffer | Uint8Array,
  name: string,
  mimeType = '',
  maxChars = 100_000,
): Promise<DocumentExtractResult> {
  const ext = extensionOf(name);
  const mime = String(mimeType || '').toLowerCase();
  const cap = Math.max(0, Math.floor(maxChars) || 0);

  if (ext === 'pdf' || mime === 'application/pdf') {
    return extractPdfText(data, cap);
  }
  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    return extractDocxText(data, cap);
  }
  if (ext === 'pptx' || mime.includes('presentationml')) {
    return extractPptxText(data, cap);
  }
  if (ext === 'xlsx' || mime.includes('spreadsheetml')) {
    return extractXlsxText(data, cap);
  }
  return { ok: false, error: `Unsupported document type: ${ext || mime || 'unknown'}` };
}
