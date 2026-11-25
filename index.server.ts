import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createPaseoAdapter } from "./server/adapters/paseo-adapter";
import { ServerKernel } from "./server/core/kernel";
import { createLogger } from "./server/core/logger";
import { createJsonStateStore } from "./server/core/store";
import { botRegistryFeature } from "./server/features/bot_registry/adapter";
import { inboxOutboxFeature } from "./server/features/inbox_outbox/adapter";
import { realtimeSyncFeature } from "./server/features/realtime_sync/adapter";
import { threadBridgeFeature } from "./server/features/thread_bridge/adapter";
import { ERROR_CODES } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const logger = createLogger("paseo-bot");
  const store = createJsonStateStore(undefined, (msg) => {
    logger.error("store", "read", ERROR_CODES.ADAPTER_FAILURE, msg);
  });
  const adapter = createPaseoAdapter(logger);
  const kernel = new ServerKernel({ server, store, logger, adapter });

  kernel.register(botRegistryFeature);
  kernel.register(inboxOutboxFeature);
  kernel.register(threadBridgeFeature);
  kernel.register(realtimeSyncFeature);

  return () => kernel.dispose();
}
