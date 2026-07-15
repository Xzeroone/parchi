// Provider model normalization and merging utilities
import type { ProviderModelEntry } from '@parchi/shared';
import { OAUTH_PROVIDERS } from '../../oauth/providers.js';
import type { OAuthProviderKey } from '../../oauth/types.js';
import { getProviderDefinition } from './definitions.js';

const asString = (value: unknown) => String(value || '').trim();

export const normalizeProviderModels = (models: unknown, fallbackModelId = ''): ProviderModelEntry[] => {
  const out: ProviderModelEntry[] = [];
  const seen = new Set<string>();
  const pushModel = (entry: ProviderModelEntry | null | undefined) => {
    const id = asString(entry?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      label: asString(entry?.label) || undefined,
      contextWindow: Number.isFinite(Number(entry?.contextWindow)) ? Number(entry?.contextWindow) : undefined,
      supportsVision: entry?.supportsVision === true,
      addedManually: entry?.addedManually === true,
    });
  };

  if (Array.isArray(models)) {
    for (const model of models) {
      if (typeof model === 'string') {
        pushModel({ id: model });
        continue;
      }
      pushModel(model as ProviderModelEntry);
    }
  }

  if (fallbackModelId) {
    pushModel({ id: fallbackModelId, addedManually: true });
  }

  return out;
};

const getDefinitionModelsForProviderType = (providerType: string): ProviderModelEntry[] => {
  const normalizedProviderType = asString(providerType).toLowerCase();
  if (!normalizedProviderType) return [];
  const baseKey = normalizedProviderType.replace(/-oauth$/, '') as OAuthProviderKey;
  const def = getProviderDefinition(normalizedProviderType);
  const oauthDef = OAUTH_PROVIDERS[baseKey];
  return normalizeProviderModels(def?.models || oauthDef?.models);
};

export interface MergeProviderModelsOptions {
  /**
   * When true, at least one live source succeeded and its models are
   * authoritative: static-definition-only models are dropped (unless they
   * were manually added by the user). When false (default / legacy
   * behaviour), static models are always seeded first and live sources are
   * merged on top.
   */
  liveSourcePresent?: boolean;
}

/**
 * Merge model lists for a provider.
 *
 * Sources are processed in order. The first source is always the static
 * definition/OAuth catalog (fallback/bootstrap). Subsequent sources are
 * live API responses, previously persisted models, or manually-added entries.
 *
 * When `liveSourcePresent` is true, the merge is **live-first**: the static
 * seed is only used to enrich live entries with metadata (label, context
 * window, vision) and to preserve manually-added models. Static-only models
 * that do not appear in any live source are dropped, so the catalog reflects
 * what the provider actually serves.
 */
export const mergeProviderModels = (providerType: string, ...sources: unknown[]): ProviderModelEntry[] => {
  return mergeProviderModelsWithOptions(providerType, sources);
};

export const mergeProviderModelsWithOptions = (
  providerType: string,
  sources: unknown[],
  options: MergeProviderModelsOptions = {},
): ProviderModelEntry[] => {
  const staticModels = getDefinitionModelsForProviderType(providerType);

  // Without a live source, fall back to legacy behaviour: seed static first,
  // then merge everything else on top.
  if (!options.liveSourcePresent) {
    return mergeEntries([staticModels, ...sources]);
  }

  // Live-first: collect every model that appears in a live source. Static
  // metadata is overlaid for enrichment, but static-only models are dropped
  // unless they were manually added.
  const staticById = new Map<string, ProviderModelEntry>();
  for (const model of staticModels) staticById.set(model.id.toLowerCase(), model);

  const liveEntries: ProviderModelEntry[] = [];
  const liveIds = new Set<string>();
  const manualEntries: ProviderModelEntry[] = [];

  for (const source of sources) {
    for (const model of normalizeProviderModels(source)) {
      const lowerId = model.id.toLowerCase();
      if (model.addedManually) {
        manualEntries.push(model);
        continue;
      }
      if (!liveIds.has(lowerId)) {
        liveIds.add(lowerId);
        liveEntries.push(model);
      } else {
        // merge into the existing live entry (later wins for metadata)
        const existing = liveEntries.find((e) => e.id.toLowerCase() === lowerId);
        if (existing) {
          Object.assign(existing, mergeEntryFields(existing, model));
        }
      }
    }
  }

  // Enrich live entries with static metadata where the live source omitted it.
  for (const entry of liveEntries) {
    const staticEntry = staticById.get(entry.id.toLowerCase());
    if (!staticEntry) continue;
    if (!entry.label && staticEntry.label) entry.label = staticEntry.label;
    if (entry.contextWindow == null && staticEntry.contextWindow != null) {
      entry.contextWindow = staticEntry.contextWindow;
    }
    if (!entry.supportsVision && staticEntry.supportsVision) {
      entry.supportsVision = staticEntry.supportsVision;
    }
  }

  // Preserve manually-added models even in live-first mode (user intent).
  const result = [...liveEntries];
  const seenIds = new Set(liveEntries.map((e) => e.id.toLowerCase()));
  for (const manual of manualEntries) {
    const lowerId = manual.id.toLowerCase();
    if (seenIds.has(lowerId)) continue;
    seenIds.add(lowerId);
    result.push(manual);
  }

  return result;
};

const mergeEntryFields = (existing: ProviderModelEntry, model: ProviderModelEntry) => ({
  label: existing.label || model.label,
  contextWindow: model.contextWindow ?? existing.contextWindow,
  supportsVision: existing.supportsVision === true || model.supportsVision === true,
  addedManually: existing.addedManually === true || model.addedManually === true,
});

const mergeEntries = (sources: unknown[]): ProviderModelEntry[] => {
  const merged: ProviderModelEntry[] = [];
  const indexById = new Map<string, number>();

  for (const source of sources) {
    for (const model of normalizeProviderModels(source)) {
      const existingIndex = indexById.get(model.id);
      if (existingIndex === undefined) {
        indexById.set(model.id, merged.length);
        merged.push(model);
        continue;
      }

      const existing = merged[existingIndex];
      merged[existingIndex] = { ...existing, ...mergeEntryFields(existing, model) };
    }
  }

  return merged;
};
