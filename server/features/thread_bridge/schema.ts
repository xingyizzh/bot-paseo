import type { RpcInput } from "@getpaseo/plugin";
import { z } from "zod";
import {
  InboxStatusSchema,
  OutboxKindSchema,
  type BotRoleType,
} from "../../../shared/contracts";
import { threadDispatchRpc, threadInspectRpc } from "../../../shared/rpc";

export type ThreadDispatchInput = RpcInput<typeof threadDispatchRpc>;
export type ThreadInspectInput = RpcInput<typeof threadInspectRpc>;

export interface RolePolicy {
  readonly roleType: BotRoleType;
  readonly allowedToolNames: readonly string[];
  readonly systemPromptLines: readonly string[];
}

export interface RecordThreadInput {
  agentId: string;
  botId: string;
  title: string;
  cwd: string;
  worktree: boolean;
  inboxId?: string | null;
  status?: string;
}

export const BotListToolInput = z.object({
  includeArchived: z.boolean().default(false),
});

export const InboxCaptureToolInput = z.object({
  rawText: z.string().min(1),
  targetBotId: z.string().nullable().optional(),
  targetProject: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  note: z.string().optional(),
});

export const InboxListToolInput = z.object({
  status: InboxStatusSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const OutboxPostToolInput = z.object({
  kind: OutboxKindSchema,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(2000),
  inboxId: z.string().nullable().optional(),
  threadLink: z.string().optional(),
});

export const DispatchThreadToolInput = z.object({
  botId: z.string().min(1).optional(),
  title: z.string().min(1).max(80),
  prompt: z.string().min(1),
  cwd: z.string().optional(),
  worktree: z.boolean().default(true),
  inboxId: z.string().nullable().optional(),
});

export const InspectThreadToolInput = z.object({
  agentId: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(8),
});
