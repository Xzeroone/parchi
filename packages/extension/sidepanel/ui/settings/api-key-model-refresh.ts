/**
 * Live-first model refresh for API-key providers (Ollama Cloud).
 * When /models succeeds, the catalog is replaced with live models only —
 * static/cached IDs that are no longer served are dropped (Hermes-style).
 */
import { PROVIDER_REGISTRY, fetchModelsForProviderDetailed } from '../../../ai/providers/registry.js';
import { mergeProviderModelsWithOptions } from '../../../state/provider-models.js';
import { listProviderInstances } from '../../../state/provider-registry.js';
import { SidePanelUI } from '../core/panel-ui.js';

const sidePanelProto = SidePanelUI.prototype as SidePanelUI & Record<string, unknown>;

sidePanelProto.refreshApiKeyProviderModels = async function refreshApiKeyProviderModels(providerId?: string) {
  const instances = listProviderInstances({ providers: this.providers }).filter(
    (p) => p.authType === 'api-key' && p.isConnected && p.apiKey && (!providerId || p.id === providerId),
  );

  let changed = false;
  for (const instance of instances) {
    const def = PROVIDER_REGISTRY[instance.provider];
    if (!def?.supportsModelListing) continue;

    try {
      const { models: fetched, live } = await fetchModelsForProviderDetailed(def, {
        type: def.type,
        apiKey: instance.apiKey,
        customEndpoint: instance.customEndpoint || def.defaultBaseUrl,
      });
      if (!live || fetched.length === 0) continue;

      // Only pass live results (+ manually added). Never re-feed prior cache.
      const manualOnly = (instance.models || []).filter((m) => m.addedManually === true);
      const nextModels = mergeProviderModelsWithOptions(instance.provider, [fetched, manualOnly], {
        liveSourcePresent: true,
      });

      const prevIds = (instance.models || []).map((m) => m.id).join('\0');
      const nextIds = nextModels.map((m) => m.id).join('\0');
      if (prevIds === nextIds) continue;

      this.providers = {
        ...(this.providers || {}),
        [instance.id]: { ...instance, models: nextModels, updatedAt: Date.now() },
      };
      changed = true;
    } catch {
      // Keep last known models on network failure.
    }
  }

  if (changed) {
    this.renderModelSelectorGrid?.();
    this.renderApiProviderGrid?.();
    this.populateModelSelect?.();
    void this.persistAllSettings?.({ silent: true });
  }
};
