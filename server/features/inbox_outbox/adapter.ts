import fs from "node:fs";
import path from "node:path";
import { ERROR_CODES } from "../../../shared/contracts";
import {
  inboxAddRpc,
  inboxImportHqRpc,
  inboxUpdateRpc,
  outboxAckRpc,
  outboxAddRpc,
} from "../../../shared/rpc";
import type { ServerFeature } from "../../core/kernel";
import type { Logger } from "../../core/logger";
import {
  ackOutboxItem,
  addInboxItem,
  addOutboxItem,
  mergeImportedHq,
  updateInboxItem,
} from "./logic";
import { INBOX_OUTBOX_MANIFEST } from "./manifest";
import type {
  InboxCaptureEvent,
  InboxMarkDispatchedEvent,
  OutboxEnqueueEvent,
} from "./schema";

function readJsonlSafe(filePath: string, logger: Logger, featureId: string): unknown[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const rows: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as unknown);
    } catch (err) {
      logger.warn(featureId, "readJsonlSafe", `Skipped invalid JSONL line in ${filePath}: ${String(err)}`);
    }
  }
  return rows;
}

export const inboxOutboxFeature: ServerFeature = {
  manifest: INBOX_OUTBOX_MANIFEST,
  register(kernel) {
    const id = INBOX_OUTBOX_MANIFEST.id;

    kernel.handleRpc(id, inboxAddRpc, async (input) => {
      const item = await kernel.store.update((state) => {
        const { nextState, item: created } = addInboxItem(state, input);
        return { nextState, result: created };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return item;
    });

    kernel.handleRpc(id, inboxUpdateRpc, async (input) => {
      const item = await kernel.store.update((state) => {
        const { nextState, item: updated } = updateInboxItem(state, input);
        return { nextState, result: updated };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return item;
    });

    kernel.handleRpc(id, inboxImportHqRpc, async (input) => {
      const hqInbox = readJsonlSafe(path.join(input.hqDir, "inbox", "items.jsonl"), kernel.logger, id);
      const hqOutbox = readJsonlSafe(path.join(input.hqDir, "outbox", "items.jsonl"), kernel.logger, id);
      const summary = await kernel.store.update((state) => {
        const { nextState, importedInbox, importedOutbox } = mergeImportedHq(state, hqInbox, hqOutbox);
        return { nextState, result: { importedInbox, importedOutbox } };
      });
      if (summary.importedInbox > 0 || summary.importedOutbox > 0) {
        kernel.events.emit("state.changed", kernel.store.read());
      }
      return summary;
    });

    kernel.handleRpc(id, outboxAddRpc, async (input) => {
      const item = await kernel.store.update((state) => {
        const { nextState, item: created } = addOutboxItem(state, input);
        return { nextState, result: created };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return item;
    });

    kernel.handleRpc(id, outboxAckRpc, async (input) => {
      const item = await kernel.store.update((state) => {
        const { nextState, item: acked } = ackOutboxItem(state, input);
        return { nextState, result: acked };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return item;
    });

    const offCapture = kernel.events.on<InboxCaptureEvent>("inbox.capture", (payload) => {
      payload.ackAccepted?.();
      void kernel.store
        .update((state) => {
          const { nextState, item } = addInboxItem(state, {
            rawText: payload.rawText,
            source: payload.source ?? "user",
            targetBotId: payload.targetBotId ?? null,
            targetProject: payload.targetProject ?? null,
            tags: payload.tags ?? [],
            note: payload.note,
          });
          return { nextState, result: item };
        })
        .then((item) => {
          kernel.events.emit("state.changed", kernel.store.read());
          payload.resolve?.(item);
        })
        .catch((err) => {
          kernel.logger.error(id, "inbox.capture", ERROR_CODES.ADAPTER_FAILURE, String(err));
          payload.reject?.(err);
        });
    });

    const offDispatched = kernel.events.on<InboxMarkDispatchedEvent>("inbox.markDispatched", (payload) => {
      payload.ackAccepted?.();
      void kernel.store
        .update((state) => {
          if (!state.inbox.some((entry) => entry.id === payload.inboxId)) {
            return { nextState: state, result: false };
          }
          const { nextState } = updateInboxItem(state, {
            id: payload.inboxId,
            status: "dispatched",
            targetBotId: payload.botId,
            linkedAgentId: payload.agentId,
            destination: payload.title,
            note: `Dispatched thread "${payload.title}" (${payload.agentId})`,
          });
          return { nextState, result: true };
        })
        .then((updated) => {
          if (updated) {
            kernel.events.emit("state.changed", kernel.store.read());
          } else {
            kernel.logger.warn(id, "inbox.markDispatched", `Inbox item not found: ${payload.inboxId}`);
          }
          payload.resolve?.();
        })
        .catch((err) => {
          kernel.logger.error(id, "inbox.markDispatched", ERROR_CODES.ADAPTER_FAILURE, String(err));
          payload.reject?.(err);
        });
    });

    const offOutbox = kernel.events.on<OutboxEnqueueEvent>("outbox.enqueue", (payload) => {
      payload.ackAccepted?.();
      void kernel.store
        .update((state) => {
          const { nextState, item } = addOutboxItem(state, {
            kind: payload.kind,
            title: payload.title,
            summary: payload.summary,
            status: payload.status ?? "pending",
            botId: payload.botId ?? null,
            agentId: payload.agentId ?? null,
            threadLink: payload.threadLink ?? "",
            inboxId: payload.inboxId ?? null,
          });
          return { nextState, result: item };
        })
        .then((item) => {
          kernel.events.emit("state.changed", kernel.store.read());
          payload.resolve?.(item);
        })
        .catch((err) => {
          kernel.logger.error(id, "outbox.enqueue", ERROR_CODES.ADAPTER_FAILURE, String(err));
          payload.reject?.(err);
        });
    });

    return () => {
      offCapture();
      offDispatched();
      offOutbox();
    };
  },
};
