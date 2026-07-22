import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  collectXmlTagText,
  extractDocumentText,
  extractDocxText,
  extractPptxText,
  extractXlsxText,
} from '../../../packages/extension/sidepanel/ui/tabs/file-document-extract.js';
import type { TestRunner } from '../shared/runner.js';

async function zipToBuffer(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function minimalPdf(text: string): ArrayBuffer {
  // Minimal one-page PDF with a single text show operator.
  const stream = `BT /F1 12 Tf 10 100 Td (${text}) Tj ET`;
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += obj;
  }
  const xrefStart = body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `${xref}trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  // Slice to exact byte length — TextEncoder's underlying buffer may be oversized.
  const encoded = new TextEncoder().encode(body);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

export async function runFileDocumentExtractSuite(runner: TestRunner) {
  await runner.test('collectXmlTagText pulls tag bodies and decodes entities', async () => {
    const xml = `<root><w:t>Hello</w:t><w:t xml:space="preserve"> &amp; </w:t><w:t>World</w:t></root>`;
    // Interior spaces preserved (OOXML spacing runs).
    assert.deepEqual(collectXmlTagText(xml, 'w:t'), ['Hello', ' & ', 'World']);
  });

  await runner.test('extractDocxText joins paragraph runs', async () => {
    const buffer = await zipToBuffer({
      'word/document.xml': `<?xml version="1.0"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p>
            <w:p><w:r><w:t>Second line</w:t></w:r></w:p>
          </w:body>
        </w:document>`,
    });
    const result = await extractDocxText(buffer, 10_000);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.text, /Hello world/);
      assert.match(result.text, /Second line/);
    }
  });

  await runner.test('extractPptxText reads slide a:t text in order', async () => {
    const buffer = await zipToBuffer({
      'ppt/slides/slide2.xml': '<p:sld><a:t>Second</a:t></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:t>Title</a:t><a:t>Body</a:t></p:sld>',
    });
    const result = await extractPptxText(buffer, 10_000);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.text, /slide 1/);
      assert.match(result.text, /Title/);
      assert.match(result.text, /Body/);
      assert.match(result.text, /slide 2/);
      assert.match(result.text, /Second/);
    }
  });

  await runner.test('extractXlsxText resolves shared strings and inline cells', async () => {
    const buffer = await zipToBuffer({
      'xl/sharedStrings.xml': '<sst><si><t>Alpha</t></si><si><t>Beta</t></si></sst>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
        <row>
          <c t="s"><v>0</v></c>
          <c t="s"><v>1</v></c>
          <c><v>42</v></c>
          <c t="inlineStr"><is><t>Inline</t></is></c>
        </row>
      </sheetData></worksheet>`,
    });
    const result = await extractXlsxText(buffer, 10_000);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.text, /Alpha/);
      assert.match(result.text, /Beta/);
      assert.match(result.text, /42/);
      assert.match(result.text, /Inline/);
    }
  });

  await runner.test('extractPdfText reads simple PDF text via pdfjs', async () => {
    const buffer = minimalPdf('HelloPDF');
    const result = await extractDocumentText(buffer, 'sample.pdf', 'application/pdf', 10_000);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.text, /HelloPDF/);
    }
  });

  await runner.test('extractDocumentText routes by extension and reports unsupported', async () => {
    const docx = await zipToBuffer({
      'word/document.xml': '<w:document><w:p><w:r><w:t>Routed</w:t></w:r></w:p></w:document>',
    });
    const ok = await extractDocumentText(docx, 'note.docx', '', 1000);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.match(ok.text, /Routed/);

    const bad = await extractDocumentText(new ArrayBuffer(0), 'legacy.doc', '', 1000);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /Unsupported/);
  });

  await runner.test('extractors respect maxChars truncation', async () => {
    const buffer = await zipToBuffer({
      'word/document.xml': `<w:document><w:p><w:r><w:t>${'A'.repeat(500)}</w:t></w:r></w:p></w:document>`,
    });
    const result = await extractDocxText(buffer, 50);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text.length, 50);
  });
}
