import { PROVIDER_REGISTRY } from '../../../packages/extension/ai/providers/definitions.js';
import { fetchModelsForProviderDetailed } from '../../../packages/extension/ai/providers/fetch.js';
import { extractModelEntries, fetchWithTimeout } from '../../../packages/extension/ai/providers/model-listing.js';
import { type AsyncTestRunner, log } from '../shared/runner.js';

export async function runModelListingIntegrationSuite(runner: AsyncTestRunner) {
  log('\n=== Integration: Model Listing ===', 'info');

  await runner.test('fetchWithTimeout forwards an AbortSignal to fetch', async () => {
    const originalFetch = globalThis.fetch;
    let signalSeen: AbortSignal | null = null;

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      signalSeen = init?.signal as AbortSignal;
      return new Response(JSON.stringify({ data: ['grok-4'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const response = await fetchWithTimeout('https://example.com/models', { method: 'GET' });
      runner.assertTrue(response.ok, 'Expected successful response');
      runner.assertTrue(
        Boolean(signalSeen) && typeof (signalSeen as AbortSignal | null)?.aborted === 'boolean',
        'Expected an AbortSignal',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runner.test('extractModelEntries preserves labels and context windows after network fetch', async () => {
    const payload = {
      data: [
        { id: 'grok-4', display_name: 'Grok 4', context_length: 256000 },
        { id: 'grok-4.3', display_name: 'Grok 4.3', context_length: 256000 },
      ],
    };
    runner.assertEqual(extractModelEntries(payload), [
      { id: 'grok-4', label: 'Grok 4', contextWindow: 256000 },
      { id: 'grok-4.3', label: 'Grok 4.3', contextWindow: 256000 },
    ]);
  });

  log('\n=== Integration: Live-First fetchModelsForProviderDetailed ===', 'info');

  await runner.test('fetchModelsForProviderDetailed fetches from xAI /models endpoint with Bearer auth', async () => {
    const originalFetch = globalThis.fetch;
    let fetchedUrl = '';
    let authHeader = '';

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchedUrl = String(url);
      const headers = init?.headers as Record<string, string>;
      authHeader = headers?.Authorization || '';
      return new Response(JSON.stringify({ data: [{ id: 'grok-4' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY['xai-oauth'];
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'test-key',
      });
      runner.assertTrue(result.live, 'should be live');
      runner.assertTrue(fetchedUrl.includes('api.x.ai'), `URL should contain api.x.ai, got: ${fetchedUrl}`);
      runner.assertTrue(fetchedUrl.includes('/models'), `URL should end with /models, got: ${fetchedUrl}`);
      runner.assertEqual(authHeader, 'Bearer test-key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runner.test(
    'fetchModelsForProviderDetailed fetches from xAI /models endpoint with live=true on success',
    async () => {
      const originalFetch = globalThis.fetch;
      let fetchedUrl = '';

      globalThis.fetch = (async (url: string | URL | Request) => {
        fetchedUrl = String(url);
        return new Response(JSON.stringify({ data: [{ id: 'grok-4' }, { id: 'grok-4.3' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const def = PROVIDER_REGISTRY['xai-oauth'];
        runner.assertTrue(def.supportsModelListing, 'xai-oauth must support listing');
        const result = await fetchModelsForProviderDetailed(def, {
          type: def.type,
          apiKey: 'test-key',
        });
        runner.assertTrue(result.live, 'should be live');
        runner.assertTrue(fetchedUrl.includes('/models'), `URL should contain /models, got: ${fetchedUrl}`);
        runner.assertTrue(
          result.models.some((m) => m.id === 'grok-4'),
          'grok-4 in result',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );
}
