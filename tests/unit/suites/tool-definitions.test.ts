import { getToolsForSession } from '../../../packages/extension/background/tools/tool-catalog.js';
import { MIN_WAIT_POLL_INTERVAL_MS } from '../../../packages/extension/tools/browser-eval-shared.js';
import {
  BASE_BROWSER_TOOL_DEFINITIONS,
  getBrowserToolDefinitions,
  getBrowserToolMap,
} from '../../../packages/extension/tools/browser-tool-definitions.js';
import { createToolHandlers } from '../../../packages/extension/tools/browser-tool-handlers.js';
import type { BrowserToolsDelegate } from '../../../packages/extension/tools/browser-tool-shared.js';
import { type TestRunner, log } from '../shared/runner.js';

function stubDelegate(): BrowserToolsDelegate {
  return {
    sessionTabs: new Map(),
    currentSessionTabId: null,
    supportsTabGroups: true,
    supportsDebugger: true,
    screenshotQuality: undefined,
    maxSessionTabs: 5,
    resolveTabId: async () => null,
    sendOverlay: async () => {},
    runInTab: async () => null,
    runInAllFrames: async () => null,
    runUserScript: async () => ({
      success: false,
      error: 'userScripts not available in test environment',
      code: 'userScripts_api_missing',
    }),
    getCurrentSessionTabId: () => null,
    getSessionTabSummaries: () => [],
    getSessionState: () => ({ tabs: [], activeTabId: null, maxTabs: 5, groupTitle: '' }),
  } as unknown as BrowserToolsDelegate;
}

export async function runToolDefinitionsSuite(runner: TestRunner) {
  log('\n=== Testing Tool Definitions ===', 'info');

  await runner.test('Real browser tool definitions have required fields', () => {
    const definitions = getBrowserToolDefinitions(true);
    definitions.forEach((tool) => {
      runner.assertTrue(tool.name, 'Tool must have name');
      runner.assertTrue(tool.description, 'Tool must have description');
      runner.assertTrue(tool.input_schema, 'Tool must have input_schema');
      runner.assertTrue(tool.input_schema?.type === 'object', 'Schema type must be object');
      runner.assertTrue(tool.input_schema?.properties, 'Schema must have properties');
    });
  });

  await runner.test('Tool availability map matches real definitions', () => {
    const definitions = getBrowserToolDefinitions(true);
    const toolMap = getBrowserToolMap(true);
    const definitionNames = definitions.map((tool) => tool.name).sort();
    const mapNames = Object.keys(toolMap).sort();

    runner.assertEqual(JSON.stringify(mapNames), JSON.stringify(definitionNames), 'Tool map should mirror definitions');
  });

  await runner.test('Schema names and handlers form a closed contract', () => {
    const fullDefinitions = getBrowserToolDefinitions(true, true);
    const definitionNames = fullDefinitions.map((tool) => tool.name).sort();
    const handlers = createToolHandlers(stubDelegate());
    const handlerNames = Object.keys(handlers).sort();

    runner.assertEqual(
      JSON.stringify(handlerNames),
      JSON.stringify(definitionNames),
      'Every schema tool must have a handler and every handler a schema entry',
    );

    const baseNames = BASE_BROWSER_TOOL_DEFINITIONS.map((tool) => tool.name).sort();
    runner.assertEqual(
      JSON.stringify(baseNames),
      JSON.stringify(definitionNames),
      'Base definition catalog must match the full Chrome capability set',
    );
  });

  await runner.test('waitFor pollIntervalMs schema documents the minimum clamp', () => {
    const waitFor = getBrowserToolDefinitions(true).find((tool) => tool.name === 'waitFor');
    const pollProp = waitFor?.input_schema?.properties?.pollIntervalMs as { description?: string } | undefined;
    const description = pollProp?.description || '';
    runner.assertTrue(
      description.includes(String(MIN_WAIT_POLL_INTERVAL_MS)),
      `pollIntervalMs description should mention minimum ${MIN_WAIT_POLL_INTERVAL_MS}`,
    );
  });

  await runner.test('Debugger-constrained definition set omits network tools', () => {
    const definitions = getBrowserToolDefinitions(true, false);
    runner.assertFalse(
      definitions.some((tool) => tool.name === 'watchNetwork'),
      'watchNetwork should be omitted without debugger support',
    );
    runner.assertFalse(
      definitions.some((tool) => tool.name === 'getNetworkLog'),
      'getNetworkLog should be omitted without debugger support',
    );
    runner.assertTrue(
      definitions.some((tool) => tool.name === 'getContent'),
      'other tools should remain available without debugger support',
    );
  });

  await runner.test('Vision tools are included in the real tool map', () => {
    const toolMap = getBrowserToolMap(true);
    runner.assertTrue(toolMap.watchVideo === true, 'watchVideo should be executable');
    runner.assertTrue(toolMap.getVideoInfo === true, 'getVideoInfo should be executable');
  });

  await runner.test('Tab-group constrained definition set omits groupTabs', () => {
    const definitions = getBrowserToolDefinitions(false);
    runner.assertFalse(
      definitions.some((tool) => tool.name === 'groupTabs'),
      'groupTabs should be omitted when unsupported',
    );
  });

  await runner.test('Screenshot remains available without vision tools when screenshots are enabled', () => {
    const tools = getToolsForSession(
      {
        getToolDefinitions: () => getBrowserToolDefinitions(true),
      },
      { enableScreenshots: true },
      false,
      [],
      false,
    );

    runner.assertTrue(
      tools.some((tool) => tool.name === 'screenshot'),
      'screenshot should stay available',
    );
    runner.assertFalse(
      tools.some((tool) => tool.name === 'watchVideo'),
      'watchVideo should be hidden',
    );
    runner.assertFalse(
      tools.some((tool) => tool.name === 'getVideoInfo'),
      'getVideoInfo should be hidden',
    );
  });

  await runner.test('Screenshot is removed only when screenshots are explicitly disabled', () => {
    const tools = getToolsForSession(
      {
        getToolDefinitions: () => getBrowserToolDefinitions(true),
      },
      { enableScreenshots: false },
      false,
      [],
      true,
    );

    runner.assertFalse(
      tools.some((tool) => tool.name === 'screenshot'),
      'screenshot should be disabled',
    );
    runner.assertTrue(
      tools.some((tool) => tool.name === 'watchVideo'),
      'vision tools stay when includeVisionTools is true',
    );
  });

  await runner.test('Vision tools stay gated by session catalog flag even when base definitions include them', () => {
    // No separate Firefox capability gate is needed for watchVideo/getVideoInfo: both use
    // page-context canvas/DOM via executeScript. Session-level includeVisionTools is the filter.
    const withoutVision = getToolsForSession(
      { getToolDefinitions: () => getBrowserToolDefinitions(true, true) },
      { enableScreenshots: true },
      false,
      [],
      false,
    );
    const withVision = getToolsForSession(
      { getToolDefinitions: () => getBrowserToolDefinitions(true, true) },
      { enableScreenshots: true },
      false,
      [],
      true,
    );
    runner.assertFalse(withoutVision.some((tool) => tool.name === 'watchVideo'));
    runner.assertTrue(withVision.some((tool) => tool.name === 'watchVideo'));
    runner.assertTrue(withVision.some((tool) => tool.name === 'getVideoInfo'));
  });
}
