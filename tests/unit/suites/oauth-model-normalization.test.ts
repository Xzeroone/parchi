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

  await runner.test('Copilot prefixed model IDs are normalized', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('copilot-oauth', 'copilot/claude-sonnet-4'), 'claude-sonnet-4');
    runner.assertEqual(normalizeOAuthModelIdForProvider('copilot', 'github-copilot/gpt-4o'), 'gpt-4o');
  });

  await runner.test('Codex prefixed model IDs are normalized', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('codex-oauth', 'openai/gpt-5.2'), 'gpt-5.2');
  });

  await runner.test('Non-prefixed OAuth model IDs remain unchanged', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('qwen-oauth', 'qwen-max'), 'qwen-max');
  });

  await runner.test('Namespaced OAuth model IDs collapse to final raw model segment', () => {
    runner.assertEqual(
      normalizeOAuthModelIdForProvider('copilot-oauth', 'openrouter/moonshotai/kimi-k2.5'),
      'kimi-k2.5',
    );
  });

  await runner.test('Copilot shorthand Anthropic names normalize to claude-* slugs', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('copilot-oauth', 'copilot/sonnet-4.6'), 'claude-sonnet-4.6');
    runner.assertEqual(normalizeOAuthModelIdForProvider('copilot-oauth', 'opus-4.6'), 'claude-opus-4.6');
  });

  await runner.test('Normalization handles empty provider keys, empty models, and deduplicates batches', () => {
    runner.assertEqual(normalizeOAuthModelIdForProvider('', 'gpt-4.1'), 'gpt-4.1');
    runner.assertEqual(normalizeOAuthModelIdForProvider('copilot-oauth', 'copilot/'), '');
    runner.assertEqual(normalizeOAuthModelIdForProvider('copilot-oauth', ''), '');
    runner.assertEqual(normalizeOAuthModelIdsForProvider('copilot-oauth', ['copilot/gpt-4o', 'gpt-4o', '']), [
      'gpt-4o',
    ]);
  });

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
      { id: 'kimi-k2.5', contextWindow: 256000 },
      { id: 'kimi-new-model', contextWindow: 200000 },
    ];
    const merged = mergeProviderModelsWithOptions('kimi', [apiEntries], { liveSourcePresent: true });
    // kimi-k2.5 appears in both static and live → kept
    runner.assertTrue(
      merged.some((m) => m.id === 'kimi-k2.5'),
      'kimi-k2.5 should be kept (in live list)',
    );
    // kimi-new-model is only in live → kept
    runner.assertTrue(
      merged.some((m) => m.id === 'kimi-new-model'),
      'kimi-new-model should be kept',
    );
    // kimi-k2-thinking is only in static → dropped in live-first mode
    runner.assertFalse(
      merged.some((m) => m.id === 'kimi-k2-thinking'),
      'static-only model should be dropped',
    );
  });

  await runner.test('mergeProviderModelsWithOptions preserves manually-added models in live-first mode', () => {
    const apiEntries = [{ id: 'kimi-k2.5' }];
    const manual = [{ id: 'my-custom-model', addedManually: true }];
    const merged = mergeProviderModelsWithOptions('kimi', [apiEntries, manual], { liveSourcePresent: true });
    runner.assertTrue(
      merged.some((m) => m.id === 'kimi-k2.5'),
      'live model kept',
    );
    runner.assertTrue(
      merged.some((m) => m.id === 'my-custom-model'),
      'manually-added model preserved',
    );
    // static-only models dropped
    runner.assertFalse(
      merged.some((m) => m.id === 'kimi-k2-thinking'),
      'static-only model dropped',
    );
  });

  await runner.test('mergeProviderModelsWithOptions enriches live entries with static metadata', () => {
    const apiEntries = [{ id: 'kimi-k2.5' }]; // no contextWindow from API
    const merged = mergeProviderModelsWithOptions('kimi', [apiEntries], { liveSourcePresent: true });
    const entry = merged.find((m) => m.id === 'kimi-k2.5');
    runner.assertEqual(entry?.contextWindow, 256000); // from static
    runner.assertEqual(entry?.supportsVision, true); // from static
  });

  await runner.test('mergeProviderModels (legacy) keeps static models when no live flag', () => {
    const apiEntries = [{ id: 'kimi-k2.5' }];
    const merged = mergeProviderModels('kimi', apiEntries);
    // Legacy mode: static models are seeded first, API merged on top
    runner.assertTrue(
      merged.some((m) => m.id === 'kimi-k2.5'),
      'live model kept',
    );
    runner.assertTrue(
      merged.some((m) => m.id === 'kimi-k2-thinking'),
      'static model kept in legacy mode',
    );
  });

  await runner.test('kimi and minimax support model listing (live-first eligible)', () => {
    runner.assertTrue(PROVIDER_REGISTRY.kimi.supportsModelListing, 'kimi should support model listing');
    runner.assertTrue(PROVIDER_REGISTRY.minimax.supportsModelListing, 'minimax should support model listing');
    runner.assertEqual(PROVIDER_REGISTRY.kimi.modelsEndpoint, '/v1/models');
    runner.assertEqual(PROVIDER_REGISTRY.minimax.modelsEndpoint, '/v1/models');
  });

  log('\n=== Testing fetchModelsForProviderDetailed (live flag) ===', 'info');

  await runner.test('fetchModelsForProviderDetailed returns live=false when listing unsupported', async () => {
    const def = PROVIDER_REGISTRY.parchi; // supportsModelListing: false
    const result = await fetchModelsForProviderDetailed(def, { type: def.type });
    runner.assertFalse(result.live, 'parchi does not support listing → live=false');
  });

  await runner.test('fetchModelsForProviderDetailed returns live=false when no API key', async () => {
    const def = PROVIDER_REGISTRY.openai;
    const result = await fetchModelsForProviderDetailed(def, { type: def.type, apiKey: '' });
    runner.assertFalse(result.live, 'no API key → live=false');
  });

  await runner.test('fetchModelsForProviderDetailed returns live=true on successful API fetch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request) => {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5.2' }, { id: 'o3' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const def = PROVIDER_REGISTRY.openai;
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'sk-test',
      });
      runner.assertTrue(result.live, 'successful fetch → live=true');
      runner.assertTrue(result.models.length >= 2, 'should return discovered models');
      runner.assertTrue(
        result.models.some((m) => m.id === 'gpt-5.2'),
        'gpt-5.2 in result',
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
      const def = PROVIDER_REGISTRY.kimi; // has static fallback models
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'sk-bad',
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
      const def = PROVIDER_REGISTRY.glm; // has static fallback models
      const result = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: 'sk-test',
      });
      runner.assertFalse(result.live, 'network error → live=false');
      runner.assertTrue(result.models.length > 0, 'fallback to static models');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
