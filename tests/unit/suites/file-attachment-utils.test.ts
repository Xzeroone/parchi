import assert from 'node:assert/strict';
import {
  type ComposerAttachment,
  classifyFileKind,
  formatAttachmentContext,
  imageDataUrlsFromAttachments,
  isTextLikeFile,
  mergeAttachmentCap,
} from '../../../packages/extension/sidepanel/ui/tabs/file-attachment-utils.js';
import type { TestRunner } from '../shared/runner.js';

export async function runFileAttachmentUtilsSuite(runner: TestRunner) {
  await runner.test('isTextLikeFile recognizes extensions and mimes', async () => {
    assert.equal(isTextLikeFile('notes.md'), true);
    assert.equal(isTextLikeFile('data.csv'), true);
    assert.equal(isTextLikeFile('config.json'), true);
    assert.equal(isTextLikeFile('app.ts'), true);
    assert.equal(isTextLikeFile('Dockerfile'), true);
    assert.equal(isTextLikeFile('blob.bin'), false);
    assert.equal(isTextLikeFile('archive.zip'), false);
    assert.equal(isTextLikeFile('plain', 'text/plain'), true);
    assert.equal(isTextLikeFile('data', 'application/json'), true);
  });

  await runner.test('classifyFileKind maps media vs text vs binary', async () => {
    assert.equal(classifyFileKind('shot.png', 'image/png'), 'image');
    assert.equal(classifyFileKind('clip.mp4', 'video/mp4'), 'video');
    assert.equal(classifyFileKind('tone.wav', 'audio/wav'), 'audio');
    assert.equal(classifyFileKind('readme.md', 'text/markdown'), 'text');
    assert.equal(classifyFileKind('pack.zip', 'application/zip'), 'file');
    assert.equal(classifyFileKind('icon.svg', 'image/svg+xml'), 'image');
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
    ];
    const ctx = formatAttachmentContext(attachments);
    assert.match(ctx, /\[File: a\.md\]/);
    assert.match(ctx, /# Hello/);
    assert.match(ctx, /\[Attached image: b\.png/);
    assert.match(ctx, /\[Attached file: c\.zip/);
    assert.match(ctx, /Binary content not extracted/);
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
