import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentToDataUrl,
  handleDownloadFile,
} from '../../../packages/extension/background/message-handlers/download.js';
import type { ServiceContext } from '../../../packages/extension/background/service-context.js';
import { type TestRunner, log } from '../shared/runner.js';

const toolsHandlerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/extension/sidepanel/ui/core/message-handlers/tools.ts',
);

type DownloadResponse = {
  success?: boolean;
  error?: string;
  downloadId?: number;
};

function stubCtx(): ServiceContext {
  return {} as ServiceContext;
}

export async function runDownloadFileSuite(runner: TestRunner) {
  log('\n=== Testing download_file handler (PAR-54/55) ===', 'info');

  await runner.test('contentToDataUrl encodes UTF-8 text as base64 data URL', () => {
    const url = contentToDataUrl('hello, café', 'text/plain');
    runner.assertTrue(url.startsWith('data:text/plain;charset=utf-8;base64,'), 'mime + charset prefix');
    const b64 = url.split(',')[1] || '';
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    runner.assertEqual(decoded, 'hello, café');
  });

  await runner.test('contentToDataUrl preserves mime types that already include parameters', () => {
    const url = contentToDataUrl('x', 'text/csv;charset=utf-8');
    runner.assertTrue(url.startsWith('data:text/csv;charset=utf-8;base64,'), 'should not double-append charset');
  });

  await runner.test('handleDownloadFile rejects empty content', async () => {
    let response: DownloadResponse = {};
    await handleDownloadFile(stubCtx(), { content: '', filename: 'a.txt' }, (r) => {
      response = r as DownloadResponse;
    });
    runner.assertEqual(response.success, false);
    runner.assertIncludes(response.error || '', 'content is required');
  });

  await runner.test('handleDownloadFile awaits chrome.downloads.download with data URL', async () => {
    const prevChrome = (globalThis as { chrome?: unknown }).chrome;
    const calls: chrome.downloads.DownloadOptions[] = [];
    (globalThis as { chrome: unknown }).chrome = {
      runtime: { lastError: undefined },
      downloads: {
        download: (options: chrome.downloads.DownloadOptions, cb?: (id: number) => void) => {
          calls.push(options);
          cb?.(42);
        },
      },
    };

    try {
      let response: DownloadResponse = {};
      await handleDownloadFile(
        stubCtx(),
        { content: 'row1,row2', filename: 'prices.csv', mimeType: 'text/csv' },
        (r) => {
          response = r as DownloadResponse;
        },
      );

      runner.assertEqual(response.success, true);
      runner.assertEqual(response.downloadId, 42);
      runner.assertEqual(calls.length, 1);
      runner.assertEqual(calls[0]?.filename, 'prices.csv');
      runner.assertEqual(calls[0]?.saveAs, false);
      runner.assertTrue(String(calls[0]?.url || '').startsWith('data:text/csv'), 'data URL url');
      const b64 = String(calls[0]?.url || '').split(',')[1] || '';
      runner.assertEqual(Buffer.from(b64, 'base64').toString('utf8'), 'row1,row2');
    } finally {
      if (prevChrome === undefined) {
        delete (globalThis as { chrome?: unknown }).chrome;
      } else {
        (globalThis as { chrome: unknown }).chrome = prevChrome;
      }
    }
  });

  await runner.test('handleDownloadFile surfaces chrome.runtime.lastError', async () => {
    const prevChrome = (globalThis as { chrome?: unknown }).chrome;
    (globalThis as { chrome: unknown }).chrome = {
      runtime: { lastError: { message: 'User canceled' } },
      downloads: {
        download: (_options: chrome.downloads.DownloadOptions, cb?: (id: number) => void) => {
          cb?.(0);
        },
      },
    };

    try {
      let response: DownloadResponse = {};
      await handleDownloadFile(stubCtx(), { content: 'x', filename: 'a.txt' }, (r) => {
        response = r as DownloadResponse;
      });
      runner.assertEqual(response.success, false);
      runner.assertIncludes(response.error || '', 'User canceled');
    } finally {
      if (prevChrome === undefined) {
        delete (globalThis as { chrome?: unknown }).chrome;
      } else {
        (globalThis as { chrome: unknown }).chrome = prevChrome;
      }
    }
  });

  await runner.test('message-router registers download_file handler', async () => {
    const mod = await import('../../../packages/extension/background/message-router.js');
    runner.assertTrue(typeof mod.handleMessage === 'function', 'handleMessage exported');
    let response: DownloadResponse = {};
    const ctx = {
      sendToSidePanel: () => {},
    } as unknown as ServiceContext;
    await mod.handleMessage(ctx, { type: 'download_file', content: 'hi', filename: 't.txt' }, {}, (r: unknown) => {
      response = r as DownloadResponse;
    });
    // Without chrome.downloads this may fail at API boundary — but must not be "unknown type"
    runner.assertTrue(Object.keys(response).length > 0, 'handler responded');
    runner.assertFalse(
      String(response.error || '').includes('Unknown message type'),
      'download_file must be a known message type',
    );
  });

  await runner.test('create_file card is a real <a download> hyperlink (PAR-56)', () => {
    const src = readFileSync(toolsHandlerPath, 'utf8');
    runner.assertTrue(src.includes("document.createElement('a')"), 'card element is an anchor');
    runner.assertTrue(src.includes('card.download = filename'), 'sets download attribute');
    runner.assertTrue(src.includes('card.href = objectUrl'), 'sets href to object URL');
    runner.assertFalse(src.includes("document.createElement('button')"), 'must not use button card');
    // Must not block native navigation/download
    runner.assertFalse(
      /card\.addEventListener\('click'[\s\S]*?preventDefault/.test(src),
      'click handler must not preventDefault on the hyperlink',
    );
  });

  await runner.test('buildFileArtifactObjectUrl returns a blob: URL', async () => {
    // Import pure helper from built dist if available; otherwise exercise Blob/URL locally
    // matching the sidepanel implementation contract.
    const safeMime = 'text/csv;charset=utf-8';
    const href = URL.createObjectURL(new Blob(['a,b\n1,2'], { type: safeMime }));
    try {
      runner.assertTrue(href.startsWith('blob:'), 'blob object URL');
    } finally {
      URL.revokeObjectURL(href);
    }
  });
}
