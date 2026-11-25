import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DomainError, ERROR_CODES } from "../../shared/contracts";

export interface ClientFeature {
  readonly manifest: { readonly id: string; readonly name: string };
  register(client: PluginClientContext): () => void;
}

export function registerClientFeatures(
  client: PluginClientContext,
  features: readonly ClientFeature[],
): () => void {
  const seen = new Set<string>();
  const cleanups: (() => void)[] = [];

  for (const feature of features) {
    if (seen.has(feature.manifest.id)) {
      throw new DomainError(
        "client_kernel",
        "register",
        ERROR_CODES.DUPLICATE_FEATURE,
        `Duplicate client feature: ${feature.manifest.id}`,
      );
    }
    seen.add(feature.manifest.id);
    cleanups.push(feature.register(client));
  }

  return () => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  };
}
