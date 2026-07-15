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
      return new Response(JSON.stringify({ data: ['gpt-4.1'] }), {
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
      models: [
        { id: 'claude-sonnet-4.5', display_name: 'Claude Sonnet 4.5', context_length: 200000 },
        { slug: 'kimi-k2', name: 'Kimi K2' },
      ],
    };
    runner.assertEqual(extractModelEntries(payload), [
      { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', contextWindow: 200000 },
      { id: 'kimi-k2', label: 'Kimi K2' },
    ]);
  });

  log('\n=== Integration: Live-First fetchModelsForProviderDetailed ===', 'info');

  await runner.test('fetchModelsForProviderDetailed fetches from the correct URL with Bearer auth', async () => {
    const originalFetch = globalThis.fetch;
    let fetchedUrl = '';
    let authHeader = '';

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchedUrl = String(url);
      const headers = init?.headers as Record<string, string>;
      authHeader = headers?.Authorization || '';
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5.2' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY.openai;
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'sk-test-key',
      });
      runner.assertTrue(result.live, 'should be live');
      runner.assertTrue(fetchedUrl.includes('api.openai.com'), `URL should contain api.openai.com, got: ${fetchedUrl}`);
      runner.assertTrue(fetchedUrl.includes('/models'), `URL should end with /models, got: ${fetchedUrl}`);
      runner.assertEqual(authHeader, 'Bearer sk-test-key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runner.test('fetchModelsForProviderDetailed uses x-api-key header for anthropic-style providers', async () => {
    const originalFetch = globalThis.fetch;
    let apiKeyHeader = '';
    let anthropicVersionHeader = '';

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      apiKeyHeader = headers?.['X-Api-Key'] || '';
      anthropicVersionHeader = headers?.['anthropic-version'] || '';
      return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY.anthropic;
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'ant-key',
      });
      runner.assertTrue(result.live, 'should be live');
      runner.assertEqual(apiKeyHeader, 'ant-key');
      runner.assertEqual(anthropicVersionHeader, '2023-06-01');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runner.test('fetchModelsForProviderDetailed fetches from kimi /v1/models endpoint', async () => {
    const originalFetch = globalThis.fetch;
    let fetchedUrl = '';

    globalThis.fetch = (async (url: string | URL | Request) => {
      fetchedUrl = String(url);
      return new Response(JSON.stringify({ data: [{ id: 'kimi-k2.5' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY.kimi;
      runner.assertTrue(def.supportsModelListing, 'kimi must support listing');
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'kimi-key',
      });
      runner.assertTrue(result.live, 'should be live');
      runner.assertTrue(fetchedUrl.includes('/v1/models'), `URL should contain /v1/models, got: ${fetchedUrl}`);
      runner.assertTrue(
        result.models.some((m) => m.id === 'kimi-k2.5'),
        'kimi-k2.5 in result',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runner.test('fetchModelsForProviderDetailed fetches from minimax /v1/models endpoint', async () => {
    const originalFetch = globalThis.fetch;
    let fetchedUrl = '';

    globalThis.fetch = (async (url: string | URL | Request) => {
      fetchedUrl = String(url);
      return new Response(JSON.stringify({ data: [{ id: 'MiniMax-M2.7' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY.minimax;
      runner.assertTrue(def.supportsModelListing, 'minimax must support listing');
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'mm-key',
      });
      runner.assertTrue(result.live, 'should be live');
      runner.assertTrue(fetchedUrl.includes('/v1/models'), `URL should contain /v1/models, got: ${fetchedUrl}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
