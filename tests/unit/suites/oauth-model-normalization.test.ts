import { PROVIDER_REGISTRY } from '../../../packages/extension/ai/providers/definitions.js';
import { fetchModelsForProviderDetailed } from '../../../packages/extension/ai/providers/fetch.js';
import {
  mergeProviderModels,
  mergeProviderModelsWithOptions,
} from '../../../packages/extension/ai/providers/instance-models.js';
import { extractModelEntriesRich } from '../../../packages/extension/oauth/model-listing.js';
import {
  normalizeOAuthModelIdForProvider,
  normalizeOAuthModelIdsForProvider,
} from '../../../packages/extension/oauth/model-normalization.js';
import { OAUTH_PROVIDERS } from '../../../packages/extension/oauth/providers.js';
import { computeConfiguredContextLimit } from '../../../packages/extension/sidepanel/ui/chat/panel-context.js';
import { type TestRunner, log } from '../shared/runner.js';

export async function runOauthModelNormalizationSuite(runner: TestRunner) {
  log('\n=== Testing OAuth Model Normalization ===', 'info');

  log('\n=== Testing OAuth Model Normalization (xAI / Grok) ===', 'info');

  await runner.test('xAI / Grok prefixed model IDs are normalized', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('xai-oauth', 'xai/grok-4'), 'grok-4');
    runner.assertEqual(normalizeOAuthModelIdForProvider('xai', 'grok/grok-build-0.1'), 'grok-build-0.1');
  });

  await runner.test('Non-prefixed Grok model IDs remain unchanged', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('xai-oauth', 'grok-4'), 'grok-4');
  });

  await runner.test('Namespaced Grok OAuth model IDs collapse to final raw model segment', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('xai-oauth', 'xai/vendor/grok-3'), 'grok-3');
  });

  await runner.test('Grok normalization handles empty provider keys, empty models, and deduplicates batches', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('', 'grok-4'), 'grok-4');
    runner.assertEqual(normalizeOAuthModelIdForProvider('xai-oauth', 'xai/'), '');
    runner.assertEqual(normalizeOAuthModelIdForProvider('xai-oauth', ''), '');
    runner.assertEqual(normalizeOAuthModelIdsForProvider('xai-oauth', ['xai/grok-4', 'grok-4', '']), ['grok-4']);
  });

  await runner.test(
    'extractModelEntriesRich pulls contextWindow from api data (context_length or contextWindow) for grok models',
    () => {
      const entries = extractModelEntriesRich({
        data: [
          { id: 'grok-test-128k', context_length: 128000 },
          { id: 'grok-test-256k', contextWindow: 256000 },
          { id: 'grok-noctx' },
        ],
      });
      runner.assertEqual(entries.find((e) => e.id === 'grok-test-128k')?.contextWindow, 128000);
      runner.assertEqual(entries.find((e) => e.id === 'grok-test-256k')?.contextWindow, 256000);
      runner.assertEqual(entries.find((e) => e.id === 'grok-noctx')?.contextWindow, undefined);
    },
  );

  await runner.test(
    'mergeProviderModels takes context from API entries (later sources) over static fallback for xai',
    () => {
      const staticModels = OAUTH_PROVIDERS.xai?.models || [];
      const apiEntries = [
        { id: 'grok-foo', contextWindow: 128000 },
        { id: 'grok-bar', contextWindow: 131072 },
      ];
      const merged = mergeProviderModels('xai-oauth', staticModels, apiEntries);
      runner.assertEqual(merged.find((m) => m.id === 'grok-foo')?.contextWindow, 128000);
      runner.assertEqual(merged.find((m) => m.id === 'grok-bar')?.contextWindow, 131072);
      // a model only in static keeps its value
      const build = merged.find((m) => m.id === 'grok-build-0.1');
      runner.assertEqual(build?.contextWindow, 256000);
    },
  );

  await runner.test(
    'computeConfiguredContextLimit returns profile contextLimit for grok models (no 256k force)',
    () => {
      const activeWith128k = { model: 'grok-4', contextLimit: 128000 };
      runner.assertEqual(computeConfiguredContextLimit(activeWith128k), 128000);
      const activeWithApi = { model: 'grok-build-0.1', contextLimit: 131072 };
      runner.assertEqual(computeConfiguredContextLimit(activeWithApi), 131072);
      const activeNoLimitGrok = { model: 'grok-foo' };
      runner.assertEqual(computeConfiguredContextLimit(activeNoLimitGrok), 200000);
    },
  );

  log('\n=== Testing Live-First Model Merging ===', 'info');

  await runner.test('mergeProviderModelsWithOptions drops static-only models when live source present', () => {
    const apiEntries = [
      { id: 'grok-4', contextWindow: 256000 },
      { id: 'grok-new-model', contextWindow: 200000 },
    ];
    const merged = mergeProviderModelsWithOptions('xai-oauth', [apiEntries], { liveSourcePresent: true });
    // grok-4 appears in both static and live → kept
    runner.assertTrue(
      merged.some((m) => m.id === 'grok-4'),
      'grok-4 should be kept (in live list)',
    );
    // grok-new-model is only in live → kept
    runner.assertTrue(
      merged.some((m) => m.id === 'grok-new-model'),
      'grok-new-model should be kept',
    );
    // grok-build-0.1 is only in static → dropped in live-first mode
    runner.assertFalse(
      merged.some((m) => m.id === 'grok-build-0.1'),
      'static-only model should be dropped',
    );
  });

  await runner.test('mergeProviderModelsWithOptions preserves manually-added models in live-first mode', () => {
    const apiEntries = [{ id: 'grok-4' }];
    const manual = [{ id: 'my-custom-model', addedManually: true }];
    const merged = mergeProviderModelsWithOptions('xai-oauth', [apiEntries, manual], { liveSourcePresent: true });
    runner.assertTrue(
      merged.some((m) => m.id === 'grok-4'),
      'live model kept',
    );
    runner.assertTrue(
      merged.some((m) => m.id === 'my-custom-model'),
      'manually-added model preserved',
    );
    // static-only models dropped
    runner.assertFalse(
      merged.some((m) => m.id === 'grok-build-0.1'),
      'static-only model dropped',
    );
  });

  await runner.test('mergeProviderModelsWithOptions enriches live entries with static metadata', () => {
    const apiEntries = [{ id: 'grok-4' }]; // no contextWindow from API
    const merged = mergeProviderModelsWithOptions('xai-oauth', [apiEntries], { liveSourcePresent: true });
    const entry = merged.find((m) => m.id === 'grok-4');
    runner.assertEqual(entry?.contextWindow, 256000); // from static
    runner.assertEqual(entry?.supportsVision, true); // from static
  });

  await runner.test('mergeProviderModels (legacy) keeps static models when no live flag', () => {
    const apiEntries = [{ id: 'grok-4' }];
    const merged = mergeProviderModels('xai-oauth', apiEntries);
    // Legacy mode: static models are seeded first, API merged on top
    runner.assertTrue(
      merged.some((m) => m.id === 'grok-4'),
      'live model kept',
    );
    runner.assertTrue(
      merged.some((m) => m.id === 'grok-build-0.1'),
      'static model kept in legacy mode',
    );
  });

  await runner.test('xai supports model listing (live-first eligible)', () => {
    // xai-oauth is the provider key in PROVIDER_REGISTRY
    runner.assertTrue(PROVIDER_REGISTRY['xai-oauth'].supportsModelListing, 'xai-oauth should support model listing');
    runner.assertEqual(PROVIDER_REGISTRY['xai-oauth'].modelsEndpoint, '/models');
  });

  log('\n=== Testing Ollama Cloud + legacy prefix normalization ===', 'info');

  await runner.test('Legacy Claude-prefixed model IDs still normalize via aliases', () => {
    runner.assertEqual(
      normalizeOAuthModelIdForProvider('claude', 'claude/claude-sonnet-4-6-20260601'),
      'claude-sonnet-4-6-20260601',
    );
    runner.assertEqual(
      normalizeOAuthModelIdForProvider('claude', 'anthropic/claude-opus-4-6-20260204'),
      'claude-opus-4-6-20260204',
    );
  });

  await runner.test('claude-oauth is not registered (removed)', () => {
    runner.assertTrue(PROVIDER_REGISTRY['claude-oauth'] === undefined, 'claude-oauth should not be registered');
  });

  await runner.test('ollama-cloud is live-first (empty static catalog, api-key)', () => {
    const def = PROVIDER_REGISTRY['ollama-cloud'];
    runner.assertTrue(def !== undefined && def.type === 'api-key');
    runner.assertEqual(def.sdkType, 'openai-compatible');
    runner.assertEqual(def.defaultBaseUrl, 'https://ollama.com/v1');
    runner.assertTrue(def.supportsModelListing && def.modelsEndpoint === '/models');
    runner.assertTrue(Array.isArray(def.models) && def.models.length === 0);
  });

  await runner.test('live-first merge keeps only live + manual (ollama)', () => {
    const live = [{ id: 'live-a' }, { id: 'live-b' }];
    const manual = [{ id: 'my-custom', addedManually: true as const }];
    const merged = mergeProviderModelsWithOptions('ollama-cloud', [live, manual], {
      liveSourcePresent: true,
    });
    runner.assertTrue(merged.some((m) => m.id === 'live-a') && merged.some((m) => m.id === 'live-b'));
    runner.assertTrue(merged.some((m) => m.id === 'my-custom'));
    runner.assertFalse(merged.some((m) => m.id === 'stale-static-model'));
  });

  log('\n=== Testing fetchModelsForProviderDetailed (live flag) ===', 'info');

  await runner.test('fetchModelsForProviderDetailed returns live=false when listing unsupported', async () => {
    const def = {
      key: 'test-no-listing',
      name: 'Test No Listing',
      type: 'api-key' as const,
      sdkType: 'openai-compatible' as const,
      defaultBaseUrl: 'https://example.com/v1',
      authHeaderStyle: 'bearer' as const,
      supportsModelListing: false,
    };
    const result = await fetchModelsForProviderDetailed(def, { type: def.type });
    runner.assertFalse(result.live, 'unsupported listing → live=false');
  });

  await runner.test('fetchModelsForProviderDetailed returns live=false when no API key', async () => {
    const def = PROVIDER_REGISTRY['xai-oauth'];
    const result = await fetchModelsForProviderDetailed(def, { type: def.type, apiKey: '' });
    runner.assertFalse(result.live, 'no API key → live=false');
  });

  await runner.test('fetchModelsForProviderDetailed returns live=true on successful API fetch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request) => {
      return new Response(JSON.stringify({ data: [{ id: 'grok-4' }, { id: 'grok-4.3' }] }), {
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
      runner.assertTrue(result.live, 'successful fetch → live=true');
      runner.assertTrue(result.models.length >= 2, 'should return discovered models');
      runner.assertTrue(
        result.models.some((m) => m.id === 'grok-4'),
        'grok-4 in result',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runner.test('fetchModelsForProviderDetailed returns live=false on HTTP error (fallback)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request) => {
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY['xai-oauth']; // has static fallback models
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'test-key',
      });
      runner.assertFalse(result.live, 'HTTP error → live=false');
      runner.assertTrue(result.models.length > 0, 'fallback to static models');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runner.test('fetchModelsForProviderDetailed returns live=false on network failure (fallback)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('Network error');
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY['xai-oauth']; // has static fallback models
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'test-key',
      });
      runner.assertFalse(result.live, 'network error → live=false');
      runner.assertTrue(result.models.length > 0, 'fallback to static models');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
