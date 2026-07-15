// Re-export provider model utilities from ai/providers for backward compatibility
export {
  normalizeProviderModels,
  mergeProviderModels,
  mergeProviderModelsWithOptions,
} from '../ai/providers/instance-models.js';
export type { MergeProviderModelsOptions } from '../ai/providers/instance-models.js';
