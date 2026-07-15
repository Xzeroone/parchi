import { extractModelEntries } from '../../../packages/extension/ai/providers/model-listing.js';
import { type TestRunner, log } from '../shared/runner.js';

export async function runModelListingSuite(runner: TestRunner) {
  log('\n=== Testing Model Listing ===', 'info');

  await runner.test('extractModelEntries normalizes string and object payloads', () => {
    const entries = extractModelEntries({
      data: [
        'gpt-4.1',
        { id: 'grok-4.3', display_name: 'Grok 4.3', context_length: 256000 },
        { slug: 'grok-4', name: 'Grok 4', contextWindow: 256000 },
        { id: '   ' },
      ],
    });

    runner.assertEqual(entries, [
      { id: 'gpt-4.1' },
      { id: 'grok-4.3', label: 'Grok 4.3', contextWindow: 256000 },
      { id: 'grok-4', label: 'Grok 4', contextWindow: 256000 },
    ]);
  });

  await runner.test('extractModelEntries falls back to models array or raw array', () => {
    runner.assertEqual(extractModelEntries({ models: ['grok-4'] }), [{ id: 'grok-4' }]);
    runner.assertEqual(extractModelEntries(['grok-build-0.1']), [{ id: 'grok-build-0.1' }]);
    runner.assertEqual(extractModelEntries(null), []);
  });
}
