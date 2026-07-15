import { PROVIDER_REGISTRY } from '../../../packages/extension/ai/providers/registry.js';
import { OAUTH_PROVIDERS } from '../../../packages/extension/oauth/providers.js';
import { type TestRunner, log } from '../shared/runner.js';

export async function runXaiOauthConfigSuite(runner: TestRunner) {
  log('\n=== Testing xAI / Grok OAuth Runtime Config ===', 'info');

  await runner.test('xAI OAuth provider detection works', () => {
    runner.assertTrue(PROVIDER_REGISTRY['xai-oauth'] !== undefined);
    runner.assertTrue(OAUTH_PROVIDERS.xai !== undefined);
  });

  await runner.test('xAI OAuth provider options are correct', () => {
    const def = PROVIDER_REGISTRY['xai-oauth'];
    runner.assertEqual(def?.defaultBaseUrl, 'https://api.x.ai/v1');
    runner.assertEqual(def?.modelsEndpoint, '/models');
    runner.assertEqual(def?.sdkType, 'openai-compatible');
    runner.assertEqual(def?.type, 'oauth');
    runner.assertEqual(def?.authHeaderStyle, 'bearer');
    runner.assertEqual(def?.supportsModelListing, true);
    runner.assertEqual(def?.oauth?.key, 'xai');
  });

  await runner.test('xAI OAuth static model list is correct', () => {
    const models = OAUTH_PROVIDERS.xai.models.map((m) => m.id);
    runner.assertTrue(models.includes('grok-build-0.1'));
    runner.assertTrue(models.includes('grok-4.3'));
    runner.assertTrue(models.includes('grok-4'));
    runner.assertEqual(models.length, 3);
  });
}
