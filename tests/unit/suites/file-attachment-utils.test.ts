import assert from 'node:assert/strict';
import {
  type ComposerAttachment,
  classifyFileKind,
  formatAttachmentContext,
  imageDataUrlsFromAttachments,
  isExtractableDocument,
  isHtmlFile,
  isLegacyOfficeDocument,
  isTextLikeFile,
  mergeAttachmentCap,
  prepareHtmlAttachmentText,
} from '../../../packages/extension/sidepanel/ui/tabs/file-attachment-utils.js';
import type { TestRunner } from '../shared/runner.js';

export async function runFileAttachmentUtilsSuite(runner: TestRunner) {
  await runner.test('isTextLikeFile recognizes extensions and mimes', async () => {
    assert.equal(isTextLikeFile('notes.md'), true);
    assert.equal(isTextLikeFile('data.csv'), true);
    assert.equal(isTextLikeFile('config.json'), true);
    assert.equal(isTextLikeFile('app.ts'), true);
    assert.equal(isTextLikeFile('Dockerfile'), true);
    assert.equal(isTextLikeFile('page.html'), true);
    assert.equal(isTextLikeFile('blob.bin'), false);
    assert.equal(isTextLikeFile('archive.zip'), false);
    assert.equal(isTextLikeFile('report.pdf'), false);
    assert.equal(isTextLikeFile('plain', 'text/plain'), true);
    assert.equal(isTextLikeFile('data', 'application/json'), true);
    assert.equal(isTextLikeFile('page', 'text/html'), true);
  });

  await runner.test('classifyFileKind maps media vs text vs binary', async () => {
    assert.equal(classifyFileKind('shot.png', 'image/png'), 'image');
    assert.equal(classifyFileKind('clip.mp4', 'video/mp4'), 'video');
    assert.equal(classifyFileKind('tone.wav', 'audio/wav'), 'audio');
    assert.equal(classifyFileKind('readme.md', 'text/markdown'), 'text');
    assert.equal(classifyFileKind('index.html', 'text/html'), 'text');
    assert.equal(classifyFileKind('pack.zip', 'application/zip'), 'file');
    assert.equal(classifyFileKind('report.pdf', 'application/pdf'), 'file');
    assert.equal(classifyFileKind('icon.svg', 'image/svg+xml'), 'image');
  });

  await runner.test('isExtractableDocument / legacy Office / HTML helpers', async () => {
    assert.equal(isExtractableDocument('a.pdf'), true);
    assert.equal(isExtractableDocument('a.docx'), true);
    assert.equal(isExtractableDocument('a.xlsx'), true);
    assert.equal(isExtractableDocument('a.pptx'), true);
    assert.equal(isExtractableDocument('a', 'application/pdf'), true);
    assert.equal(isExtractableDocument('a.zip'), false);
    assert.equal(isLegacyOfficeDocument('old.doc'), true);
    assert.equal(isLegacyOfficeDocument('old.xls'), true);
    assert.equal(isLegacyOfficeDocument('old.ppt'), true);
    assert.equal(isLegacyOfficeDocument('new.docx'), false);
    assert.equal(isHtmlFile('page.html'), true);
    assert.equal(isHtmlFile('page.htm'), true);
    assert.equal(isHtmlFile('x', 'text/html'), true);
    assert.equal(isHtmlFile('x.md'), false);
  });

  await runner.test('prepareHtmlAttachmentText keeps small source and extracts large/noisy', async () => {
    const small = '<html><body><p>Hello <b>world</b></p><script>alert(1)</script></body></html>';
    const smallPrep = prepareHtmlAttachmentText(small, 10_000);
    assert.match(smallPrep.text, /Hello/);
    assert.doesNotMatch(smallPrep.text, /alert/);
    assert.equal(smallPrep.truncated, false);

    const noisy = `<html><body>${'<div>x</div>'.repeat(900)}<p>NeedleContent</p></body></html>`;
    const largePrep = prepareHtmlAttachmentText(noisy, 50_000);
    assert.match(largePrep.text, /readable text/i);
    assert.match(largePrep.text, /NeedleContent/);
    assert.ok(largePrep.note);
  });

  await runner.test('formatAttachmentContext inlines text and labels media/binary', async () => {
    const attachments: ComposerAttachment[] = [
      {
        id: '1',
        kind: 'text',
        name: 'a.md',
        mimeType: 'text/markdown',
        size: 12,
        text: '# Hello',
      },
      {
        id: '2',
        kind: 'image',
        name: 'b.png',
        mimeType: 'image/png',
        size: 2048,
        dataUrl: 'data:image/png;base64,xx',
      },
      {
        id: '3',
        kind: 'file',
        name: 'c.zip',
        mimeType: 'application/zip',
        size: 4096,
        note: 'Binary content not extracted for chat context',
      },
      {
        id: '4',
        kind: 'file',
        name: 'd.pdf',
        mimeType: 'application/pdf',
        size: 100,
        text: 'Extracted PDF body',
        note: 'extracted text',
      },
    ];
    const ctx = formatAttachmentContext(attachments);
    assert.match(ctx, /\[File: a\.md\]/);
    assert.match(ctx, /# Hello/);
    assert.match(ctx, /\[Attached image: b\.png/);
    assert.match(ctx, /\[Attached file: c\.zip/);
    assert.match(ctx, /Binary content not extracted/);
    assert.match(ctx, /\[File: d\.pdf\]/);
    assert.match(ctx, /Extracted PDF body/);
  });

  await runner.test('imageDataUrlsFromAttachments extracts image dataUrls only', async () => {
    const images = imageDataUrlsFromAttachments([
      {
        id: '1',
        kind: 'image',
        name: 'a.png',
        mimeType: 'image/png',
        size: 1,
        dataUrl: 'data:image/png;base64,aa',
      },
      {
        id: '2',
        kind: 'text',
        name: 'b.md',
        mimeType: 'text/markdown',
        size: 1,
        text: 'x',
      },
      {
        id: '3',
        kind: 'image',
        name: 'empty.png',
        mimeType: 'image/png',
        size: 0,
      },
    ]);
    assert.equal(images.length, 1);
    assert.equal(images[0]?.dataUrl, 'data:image/png;base64,aa');
  });

  await runner.test('mergeAttachmentCap keeps the newest N items', async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      kind: 'text' as const,
      name: `e${i}.txt`,
      mimeType: 'text/plain',
      size: 1,
      text: 'x',
    }));
    const incoming = [
      {
        id: 'n1',
        kind: 'text' as const,
        name: 'n1.txt',
        mimeType: 'text/plain',
        size: 1,
        text: 'y',
      },
      {
        id: 'n2',
        kind: 'text' as const,
        name: 'n2.txt',
        mimeType: 'text/plain',
        size: 1,
        text: 'z',
      },
    ];
    const merged = mergeAttachmentCap(existing, incoming, 12);
    assert.equal(merged.length, 12);
    assert.equal(merged[merged.length - 1]?.id, 'n2');
    assert.equal(merged[0]?.id, 'e0');
  });
}
