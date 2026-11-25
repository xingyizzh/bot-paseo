import type { RpcInput } from "@getpaseo/plugin";
import { z } from "zod";
import {
  InboxNoteSchema,
  InboxSourceSchema,
  InboxStatusSchema,
  OutboxKindSchema,
  OutboxStatusSchema,
  type InboxItem,
  type InboxSource,
  type OutboxItem,
  type OutboxKind,
  type OutboxStatus,
} from "../../../shared/contracts";
import {
  inboxAddRpc,
  inboxImportHqRpc,
  inboxUpdateRpc,
  outboxAckRpc,
  outboxAddRpc,
} from "../../../shared/rpc";

export type InboxAddInput = RpcInput<typeof inboxAddRpc>;
export type InboxUpdateInput = RpcInput<typeof inboxUpdateRpc>;
export type InboxImportHqInput = RpcInput<typeof inboxImportHqRpc>;
export type OutboxAddInput = RpcInput<typeof outboxAddRpc>;
export type OutboxAckInput = RpcInput<typeof outboxAckRpc>;

export interface AddInboxItemInput {
  rawText: string;
  source?: InboxSource;
  targetBotId?: string | null;
  targetProject?: string | null;
  tags?: string[];
  note?: string;
}

export interface AddOutboxItemInput {
  kind: OutboxKind;
  title: string;
  summary: string;
  status?: OutboxStatus;
  botId?: string | null;
  agentId?: string | null;
  threadLink?: string;
  inboxId?: string | null;
}

export const HqInboxRecordSchema = z.object({
  id: z.string().min(1),
  rawText: z.string().min(1),
  source: InboxSourceSchema.catch("hq_import"),
  status: InboxStatusSchema.catch("captured"),
  targetBotId: z.string().nullable().optional(),
  targetProject: z.string().nullable().optional(),
  linkedAgentId: z.string().nullable().optional(),
  linkedThreadId: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.array(InboxNoteSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const HqOutboxRecordSchema = z.object({
  id: z.string().min(1),
  kind: OutboxKindSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  status: OutboxStatusSchema.catch("pending"),
  botId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  threadLink: z.string().optional(),
  inboxId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  ackedAt: z.string().nullable().optional(),
  ackNote: z.string().nullable().optional(),
});

export interface InboxCaptureEvent {
  rawText: string;
  source?: InboxSource;
  targetBotId?: string | null;
  targetProject?: string | null;
  tags?: string[];
  note?: string;
  ackAccepted?: () => void;
  resolve?: (item: InboxItem) => void;
  reject?: (err: unknown) => void;
}

export interface InboxMarkDispatchedEvent {
  inboxId: string;
  botId: string;
  agentId: string;
  title: string;
  ackAccepted?: () => void;
  resolve?: () => void;
  reject?: (err: unknown) => void;
}

export interface OutboxEnqueueEvent {
  kind: OutboxKind;
  title: string;
  summary: string;
  status?: OutboxStatus;
  botId?: string | null;
  agentId?: string | null;
  threadLink?: string;
  inboxId?: string | null;
  ackAccepted?: () => void;
  resolve?: (item: OutboxItem) => void;
  reject?: (err: unknown) => void;
}
