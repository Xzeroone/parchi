import type { ToolDefinition } from '@parchi/shared';
import { ADVANCED_BROWSER_TOOL_DEFINITIONS } from './browser-tool-definitions-advanced.js';
import { INTERACTION_TOOLS } from './browser-tool-definitions-interaction.js';
import { NAVIGATION_TOOLS } from './browser-tool-definitions-nav.js';
import { READ_TOOLS } from './browser-tool-definitions-read.js';
import { TAB_TOOLS } from './browser-tool-definitions-tab.js';
import { VIDEO_TOOLS } from './browser-tool-definitions-video.js';

/** All browser tool definitions combined */
export const BASE_BROWSER_TOOL_DEFINITIONS = [
  ...NAVIGATION_TOOLS,
  ...INTERACTION_TOOLS,
  ...READ_TOOLS,
  ...TAB_TOOLS,
  ...VIDEO_TOOLS,
  ...ADVANCED_BROWSER_TOOL_DEFINITIONS,
] as const satisfies readonly ToolDefinition[];

/** Union type of all browser tool names */
export type BrowserToolName = (typeof BASE_BROWSER_TOOL_DEFINITIONS)[number]['name'];

/** Get tool definitions, optionally filtering by platform support */
export function getBrowserToolDefinitions(supportsTabGroups: boolean, supportsDebugger = true): ToolDefinition[] {
  let tools: ToolDefinition[] = [...BASE_BROWSER_TOOL_DEFINITIONS];
  if (!supportsTabGroups) {
    tools = tools.filter((t) => t.name !== 'groupTabs');
  }
  if (!supportsDebugger) {
    tools = tools.filter((t) => t.name !== 'watchNetwork' && t.name !== 'getNetworkLog');
  }
  return tools;
}

/** Get a map of available tool names for quick lookup */
export function getBrowserToolMap(
  supportsTabGroups: boolean,
  supportsDebugger = true,
): Partial<Record<BrowserToolName, true>> {
  return Object.fromEntries(
    getBrowserToolDefinitions(supportsTabGroups, supportsDebugger).map((t) => [t.name, true] as const),
  );
}
