import type { BotHubSnapshot } from "../../../shared/contracts";
import { hubSubscribe } from "../../../shared/rpc";
import type { FeatureManifest, ServerFeature } from "../../core/kernel";

export const REALTIME_SYNC_MANIFEST: FeatureManifest = {
  id: "realtime_sync",
  name: "Realtime Hub Snapshot Sync",
};

export const realtimeSyncFeature: ServerFeature = {
  manifest: REALTIME_SYNC_MANIFEST,
  register(kernel) {
    const id = REALTIME_SYNC_MANIFEST.id;
    const cleanups = new Set<() => void>();

    kernel.handleSubscription(id, hubSubscribe, (_input, context) => {
      if (context.signal.aborted) return;

      const pushSnapshot = (snapshot: BotHubSnapshot) => {
        if (context.signal.aborted) return;
        void context.push(snapshot).catch((err) => {
          if (!context.signal.aborted) {
            kernel.logger.warn(id, "push", String(err));
          }
        });
      };

      const offStateChanged = kernel.events.on<BotHubSnapshot>("state.changed", (snapshot) => {
        pushSnapshot(snapshot);
      });

      pushSnapshot(kernel.store.read());

      return new Promise<void>((resolve) => {
        const cleanup = () => {
          cleanups.delete(cleanup);
          offStateChanged();
          context.signal.removeEventListener("abort", cleanup);
          resolve();
        };
        cleanups.add(cleanup);
        if (context.signal.aborted) {
          cleanup();
          return;
        }
        context.signal.addEventListener("abort", cleanup, { once: true });
      });
    });

    return () => {
      for (const cleanup of [...cleanups]) {
        cleanup();
      }
    };
  },
};
