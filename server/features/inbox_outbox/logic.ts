import {
  DomainError,
  ERROR_CODES,
  sortOutboxItems,
  type InboxItem,
  type OutboxItem,
  type OutboxKind,
  type PersistedHubState,
} from "../../../shared/contracts";
import {
  HqInboxRecordSchema,
  HqOutboxRecordSchema,
  type AddInboxItemInput,
  type AddOutboxItemInput,
  type InboxUpdateInput,
  type OutboxAckInput,
} from "./schema";

export { sortOutboxItems };

function extractDateStamp(now: string): string {
  const m = now.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const parsed = new Date(now);
  const iso = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  return iso.slice(0, 10).replace(/-/g, "");
}

function nextDatedId(prefix: "in" | "out", existingIds: readonly string[], now: string): string {
  const day = extractDateStamp(now);
  const head = `${prefix}-${day}-`;
  const used = new Set(existingIds);
  let maxSeq = 0;
  for (const id of existingIds) {
    if (!id.startsWith(head)) continue;
    const seq = Number.parseInt(id.slice(head.length), 10);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }
  let seq = maxSeq + 1;
  while (used.has(`${head}${String(seq).padStart(4, "0")}`)) {
    seq += 1;
  }
  return `${head}${String(seq).padStart(4, "0")}`;
}

export function addInboxItem(
  state: PersistedHubState,
  input: AddInboxItemInput,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; item: InboxItem } {
  if (input.rawText.length === 0) {
    throw new DomainError(
      "inbox_outbox",
      "addInboxItem",
      ERROR_CODES.VALIDATION,
      "Inbox rawText must not be empty",
    );
  }
  const noteText = input.note?.trim();
  const item: InboxItem = {
    id: nextDatedId("in", state.inbox.map((entry) => entry.id), now),
    rawText: input.rawText,
    source: input.source ?? "user",
    status: "captured",
    targetBotId: input.targetBotId ?? null,
    targetProject: input.targetProject ?? null,
    linkedAgentId: null,
    destination: null,
    tags: [...(input.tags ?? [])],
    notes: noteText ? [{ at: now, text: noteText }] : [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    nextState: { ...state, inbox: [...state.inbox, item] },
    item,
  };
}

export function updateInboxItem(
  state: PersistedHubState,
  input: InboxUpdateInput,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; item: InboxItem } {
  const existing = state.inbox.find((entry) => entry.id === input.id);
  if (!existing) {
    throw new DomainError(
      "inbox_outbox",
      "updateInboxItem",
      ERROR_CODES.NOT_FOUND,
      `Inbox item not found: ${input.id}`,
    );
  }
  if ("rawText" in input) {
    const candidateRaw = (input as { rawText?: unknown }).rawText;
    if (candidateRaw !== undefined && candidateRaw !== existing.rawText) {
      throw new DomainError(
        "inbox_outbox",
        "updateInboxItem",
        ERROR_CODES.IMMUTABLE_FIELD,
        "Inbox rawText is immutable",
      );
    }
  }
  const noteText = input.note?.trim();
  const item: InboxItem = {
    ...existing,
    rawText: existing.rawText,
    status: input.status ?? existing.status,
    targetBotId: input.targetBotId !== undefined ? input.targetBotId : existing.targetBotId,
    targetProject: input.targetProject !== undefined ? input.targetProject : existing.targetProject,
    linkedAgentId: input.linkedAgentId !== undefined ? input.linkedAgentId : existing.linkedAgentId,
    destination: input.destination !== undefined ? input.destination : existing.destination,
    notes: noteText ? [...existing.notes, { at: now, text: noteText }] : existing.notes,
    updatedAt: now,
  };
  return {
    nextState: {
      ...state,
      inbox: state.inbox.map((entry) => (entry.id === item.id ? item : entry)),
    },
    item,
  };
}

export function addOutboxItem(
  state: PersistedHubState,
  input: AddOutboxItemInput,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; item: OutboxItem } {
  const title = input.title.trim().slice(0, 120);
  const summary = input.summary.trim().slice(0, 2000);
  if (!title || !summary) {
    throw new DomainError(
      "inbox_outbox",
      "addOutboxItem",
      ERROR_CODES.VALIDATION,
      "Outbox title and summary must not be empty",
    );
  }
  const status = input.status ?? "pending";
  const item: OutboxItem = {
    id: nextDatedId("out", state.outbox.map((entry) => entry.id), now),
    kind: input.kind,
    title,
    summary,
    status,
    botId: input.botId ?? null,
    agentId: input.agentId ?? null,
    threadLink: input.threadLink ?? "",
    inboxId: input.inboxId ?? null,
    createdAt: now,
    ackedAt: status === "acked" ? now : null,
    ackNote: null,
  };
  return {
    nextState: { ...state, outbox: [...state.outbox, item] },
    item,
  };
}

export function ackOutboxItem(
  state: PersistedHubState,
  input: OutboxAckInput,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; item: OutboxItem } {
  const existing = state.outbox.find((entry) => entry.id === input.id);
  if (!existing) {
    throw new DomainError(
      "inbox_outbox",
      "ackOutboxItem",
      ERROR_CODES.NOT_FOUND,
      `Outbox item not found: ${input.id}`,
    );
  }
  if (existing.status === "acked" && existing.ackedAt !== null) {
    return { nextState: state, item: existing };
  }
  const item: OutboxItem = {
    ...existing,
    status: "acked",
    ackedAt: existing.ackedAt ?? now,
    ackNote: input.note !== undefined ? input.note : existing.ackNote,
  };
  return {
    nextState: {
      ...state,
      outbox: state.outbox.map((entry) => (entry.id === item.id ? item : entry)),
    },
    item,
  };
}

export function ackOutboxByAgent(
  state: PersistedHubState,
  input: { agentId: string; kind?: OutboxKind; note?: string },
  now = new Date().toISOString(),
): { nextState: PersistedHubState; count: number } {
  let count = 0;
  const outbox = state.outbox.map((entry) => {
    if (entry.agentId !== input.agentId) return entry;
    if (input.kind && entry.kind !== input.kind) return entry;
    if (entry.status === "acked") return entry;
    count += 1;
    return {
      ...entry,
      status: "acked" as const,
      ackedAt: entry.ackedAt ?? now,
      ackNote: input.note !== undefined ? input.note : entry.ackNote,
    };
  });
  if (count === 0) return { nextState: state, count: 0 };
  return { nextState: { ...state, outbox }, count };
}

export function mergeImportedHq(
  state: PersistedHubState,
  hqInbox: readonly unknown[],
  hqOutbox: readonly unknown[],
  now = new Date().toISOString(),
): { nextState: PersistedHubState; importedInbox: number; importedOutbox: number } {
  const seenInbox = new Set(state.inbox.map((entry) => entry.id));
  const addedInbox: InboxItem[] = [];
  for (const raw of hqInbox) {
    const parsed = HqInboxRecordSchema.safeParse(raw);
    if (!parsed.success || seenInbox.has(parsed.data.id)) continue;
    const row = parsed.data;
    seenInbox.add(row.id);
    addedInbox.push({
      id: row.id,
      rawText: row.rawText,
      source: row.source,
      status: row.status,
      targetBotId: row.targetBotId ?? null,
      targetProject: row.targetProject ?? null,
      linkedAgentId: row.linkedAgentId ?? row.linkedThreadId ?? null,
      destination: row.destination ?? null,
      tags: row.tags,
      notes: row.notes,
      createdAt: row.createdAt ?? now,
      updatedAt: row.updatedAt ?? row.createdAt ?? now,
    });
  }

  const seenOutbox = new Set(state.outbox.map((entry) => entry.id));
  const addedOutbox: OutboxItem[] = [];
  for (const raw of hqOutbox) {
    const parsed = HqOutboxRecordSchema.safeParse(raw);
    if (!parsed.success || seenOutbox.has(parsed.data.id)) continue;
    const row = parsed.data;
    seenOutbox.add(row.id);
    addedOutbox.push({
      id: row.id,
      kind: row.kind,
      title: row.title.slice(0, 120),
      summary: row.summary.slice(0, 2000),
      status: row.status,
      botId: row.botId ?? null,
      agentId: row.agentId ?? row.threadId ?? null,
      threadLink: row.threadLink ?? "",
      inboxId: row.inboxId ?? null,
      createdAt: row.createdAt ?? now,
      ackedAt: row.ackedAt ?? null,
      ackNote: row.ackNote ?? null,
    });
  }

  if (addedInbox.length === 0 && addedOutbox.length === 0) {
    return { nextState: state, importedInbox: 0, importedOutbox: 0 };
  }
  return {
    nextState: {
      ...state,
      inbox: [...state.inbox, ...addedInbox],
      outbox: [...state.outbox, ...addedOutbox],
    },
    importedInbox: addedInbox.length,
    importedOutbox: addedOutbox.length,
  };
}
