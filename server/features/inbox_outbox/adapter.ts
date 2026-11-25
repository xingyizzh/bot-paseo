import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ERROR_CODES,
  filterOutboxItems,
  type InboxCaptureEvent,
  type InboxMarkDispatchedEvent,
  type OutboxAckByAgentEvent,
  type OutboxAckByIdEvent,
  type OutboxEnqueueEvent,
  type OutboxListEvent,
} from "../../../shared/contracts";
import {
  inboxAddRpc,
  inboxImportHqRpc,
  inboxUpdateRpc,
  outboxAckRpc,
  outboxAddRpc,
} from "../../../shared/rpc";
import type { FeatureManifest, ServerFeature } from "../../core/kernel";
import type { Logger } from "../../core/logger";
import {
  ackOutboxByAgent,
  ackOutboxItem,
  addInboxItem,
  addOutboxItem,
  mergeImportedHq,
  updateInboxItem,
} from "./logic";

export const INBOX_OUTBOX_MANIFEST: FeatureManifest = {
  id: "inbox_outbox",
  name: "Inbox & Outbox Ledger",
};

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

    kernel.handleRpc(id, inboxAddRpc, async (input) =>
      kernel.commitState(id, (state) => {
        const { nextState, item } = addInboxItem(state, input);
        return { nextState, result: item };
      }),
    );

    kernel.handleRpc(id, inboxUpdateRpc, async (input) =>
      kernel.commitState(id, (state) => {
        const { nextState, item } = updateInboxItem(state, input);
        return { nextState, result: item };
      }),
    );

    kernel.handleRpc(id, inboxImportHqRpc, async (input) => {
      const hqDir =
        input.hqDir.trim() ||
        process.env.PASEO_BOT_HQ_DIR?.trim() ||
        path.join(os.homedir(), "ai", "personal-hq");
      const hqInbox = readJsonlSafe(path.join(hqDir, "inbox", "items.jsonl"), kernel.logger, id);
      const hqOutbox = readJsonlSafe(path.join(hqDir, "outbox", "items.jsonl"), kernel.logger, id);
      return kernel.commitState(id, (state) => {
        const { nextState, importedInbox, importedOutbox } = mergeImportedHq(state, hqInbox, hqOutbox);
        return { nextState, result: { importedInbox, importedOutbox } };
      });
    });

    kernel.handleRpc(id, outboxAddRpc, async (input) =>
      kernel.commitState(id, (state) => {
        const { nextState, item } = addOutboxItem(state, input);
        return { nextState, result: item };
      }),
    );

    kernel.handleRpc(id, outboxAckRpc, async (input) =>
      kernel.commitState(id, (state) => {
        const { nextState, item } = ackOutboxItem(state, input);
        return { nextState, result: item };
      }),
    );

    const offCapture = kernel.events.on<InboxCaptureEvent>("inbox.capture", (payload) => {
      payload.ackAccepted?.();
      void kernel
        .commitState(id, (state) => {
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
        .then((item) => payload.resolve?.(item))
        .catch((err) => {
          kernel.logger.error(id, "inbox.capture", ERROR_CODES.ADAPTER_FAILURE, String(err));
          payload.reject?.(err);
        });
    });

    const offDispatched = kernel.events.on<InboxMarkDispatchedEvent>("inbox.markDispatched", (payload) => {
      payload.ackAccepted?.();
      void kernel
        .commitState(id, (state) => {
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
          if (!updated) {
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
      void kernel
        .commitState(id, (state) => {
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
        .then((item) => payload.resolve?.(item))
        .catch((err) => {
          kernel.logger.error(id, "outbox.enqueue", ERROR_CODES.ADAPTER_FAILURE, String(err));
          payload.reject?.(err);
        });
    });

    const offAckByAgent = kernel.events.on<OutboxAckByAgentEvent>("outbox.ackByAgent", (payload) => {
      payload.ackAccepted?.();
      void kernel
        .commitState(id, (state) => {
          const { nextState, count } = ackOutboxByAgent(state, {
            agentId: payload.agentId,
            kind: payload.kind,
            note: payload.note,
          });
          return { nextState, result: count };
        })
        .then((count) => payload.resolve?.(count))
        .catch((err) => {
          kernel.logger.error(id, "outbox.ackByAgent", ERROR_CODES.ADAPTER_FAILURE, String(err));
          payload.reject?.(err);
        });
    });

    const offOutboxList = kernel.events.on<OutboxListEvent>("outbox.list", (payload) => {
      payload.ackAccepted?.();
      try {
        const items = filterOutboxItems(kernel.store.read().outbox, {
          includeAcked: payload.includeAcked,
          kind: payload.kind,
          limit: payload.limit,
        });
        payload.resolve?.(items);
      } catch (err) {
        kernel.logger.error(id, "outbox.list", ERROR_CODES.ADAPTER_FAILURE, String(err));
        payload.reject?.(err);
      }
    });

    const offOutboxAck = kernel.events.on<OutboxAckByIdEvent>("outbox.ack", (payload) => {
      payload.ackAccepted?.();
      void kernel
        .commitState(id, (state) => {
          const { nextState, item } = ackOutboxItem(state, { id: payload.id, note: payload.note });
          return { nextState, result: item };
        })
        .then((item) => payload.resolve?.(item))
        .catch((err) => {
          kernel.logger.error(id, "outbox.ack", ERROR_CODES.ADAPTER_FAILURE, String(err));
          payload.reject?.(err);
        });
    });

    return () => {
      offCapture();
      offDispatched();
      offOutbox();
      offAckByAgent();
      offOutboxList();
      offOutboxAck();
    };
  },
};
