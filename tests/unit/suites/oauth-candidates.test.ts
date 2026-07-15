import {
  isLikelyTextGenerationModelId,
  prioritizeOAuthModelCandidates,
} from '../../../packages/extension/oauth/model-candidates.js';
import { type TestRunner, log } from '../shared/runner.js';

export async function runOauthCandidatesSuite(runner: TestRunner) {
  log('\n=== Testing OAuth Model Candidate Prioritization ===', 'info');

  await runner.test('Non-text model IDs are filtered out', () => {
    runner.assertFalse(isLikelyTextGenerationModelId('xai', 'text-embedding-3-large'));
    runner.assertTrue(isLikelyTextGenerationModelId('xai', 'grok-4'));
  });

  await runner.test('Known supported OAuth models are prioritized when discovered list is noisy', () => {
    const prioritized = prioritizeOAuthModelCandidates(
      'xai',
      ['text-embedding-3-small', 'grok-4', 'grok-4.3'],
      ['grok-4', 'grok-4.3', 'grok-build-0.1'],
    );
    runner.assertEqual(prioritized[0], 'grok-4');
    runner.assertTrue(prioritized.includes('grok-4.3'));
    runner.assertFalse(prioritized.includes('text-embedding-3-small'));
  });

  await runner.test('Provider-specific text heuristics and dedupe behavior cover fallback branches', () => {
    runner.assertTrue(isLikelyTextGenerationModelId('xai-oauth', 'grok-4'));
    runner.assertTrue(isLikelyTextGenerationModelId('xai', 'grok-build-0.1'));
    runner.assertFalse(isLikelyTextGenerationModelId('xai-oauth', 'audio-preview'));
    runner.assertFalse(isLikelyTextGenerationModelId('xai-oauth', ''));
    runner.assertTrue(isLikelyTextGenerationModelId('unknown-oauth', 'custom-chat-model'));

    runner.assertEqual(prioritizeOAuthModelCandidates('xai', [], ['grok-4', 'grok-4']), ['grok-4']);
  });
}
