import { z } from "zod";

export const BotRoleTypeSchema = z.enum(["companion", "butler", "project_lead"]);
export type BotRoleType = z.infer<typeof BotRoleTypeSchema>;

export const BotPermissionModeSchema = z.enum(["readonly", "workspace", "full"]);
export type BotPermissionMode = z.infer<typeof BotPermissionModeSchema>;

export const BotSectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  collapsed: z.boolean(),
  order: z.number().int(),
  color: z.string().nullable(),
});
export type BotSection = z.infer<typeof BotSectionSchema>;

export const BotRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  roleType: BotRoleTypeSchema,
  bio: z.string().max(160),
  personaPrompt: z.string().max(4000),
  iconName: z.string().min(1),
  avatarColor: z.string().min(4),
  provider: z.string().min(1),
  defaultCwd: z.string().min(1),
  permissionMode: BotPermissionModeSchema,
  sectionId: z.string().nullable(),
  pinned: z.boolean(),
  agentId: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BotRecord = z.infer<typeof BotRecordSchema>;

export const InboxStatusSchema = z.enum(["captured", "triaged", "dispatched", "done", "dropped"]);
export type InboxStatus = z.infer<typeof InboxStatusSchema>;

export const InboxSourceSchema = z.enum(["user", "mobile", "companion", "butler", "hq_import"]);
export type InboxSource = z.infer<typeof InboxSourceSchema>;

export const InboxNoteSchema = z.object({
  at: z.string(),
  text: z.string(),
});

export const InboxItemSchema = z.object({
  id: z.string().min(1),
  rawText: z.string().min(1),
  source: InboxSourceSchema,
  status: InboxStatusSchema,
  targetBotId: z.string().nullable(),
  targetProject: z.string().nullable(),
  linkedAgentId: z.string().nullable(),
  destination: z.string().nullable(),
  tags: z.array(z.string()),
  notes: z.array(InboxNoteSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const OutboxKindSchema = z.enum(["needs_decision", "blocked", "delivered"]);
export type OutboxKind = z.infer<typeof OutboxKindSchema>;

export const OutboxStatusSchema = z.enum(["pending", "delivered", "acked"]);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export const OutboxItemSchema = z.object({
  id: z.string().min(1),
  kind: OutboxKindSchema,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(2000),
  status: OutboxStatusSchema,
  botId: z.string().nullable(),
  agentId: z.string().nullable(),
  threadLink: z.string(),
  inboxId: z.string().nullable(),
  createdAt: z.string(),
  ackedAt: z.string().nullable(),
  ackNote: z.string().nullable(),
});
export type OutboxItem = z.infer<typeof OutboxItemSchema>;

export const DispatchedThreadSchema = z.object({
  agentId: z.string().min(1),
  botId: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().min(1),
  worktree: z.boolean(),
  inboxId: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DispatchedThread = z.infer<typeof DispatchedThreadSchema>;

export const PersistedHubStateSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  bots: z.array(BotRecordSchema),
  sections: z.array(BotSectionSchema),
  inbox: z.array(InboxItemSchema),
  outbox: z.array(OutboxItemSchema),
  threads: z.array(DispatchedThreadSchema),
  updatedAt: z.string(),
});
export type PersistedHubState = z.infer<typeof PersistedHubStateSchema>;

export const BotHubSnapshotSchema = PersistedHubStateSchema;
export type BotHubSnapshot = PersistedHubState;

export const ThreadMessageDigestSchema = z.object({
  role: z.string(),
  text: z.string(),
});
export type ThreadMessageDigest = z.infer<typeof ThreadMessageDigestSchema>;

export const ERROR_CODES = {
  VALIDATION: "ERR_VALIDATION",
  NOT_FOUND: "ERR_NOT_FOUND",
  PERMISSION_DENIED: "ERR_PERMISSION_DENIED",
  IMMUTABLE_FIELD: "ERR_IMMUTABLE_FIELD",
  ADAPTER_FAILURE: "ERR_ADAPTER_FAILURE",
  DUPLICATE_FEATURE: "ERR_DUPLICATE_FEATURE",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fingerprint: string;

  constructor(feature: string, step: string, code: ErrorCode, message: string) {
    const fingerprint = `[${feature}::${step}::${code}]`;
    super(`${fingerprint} ${message}`);
    this.name = "DomainError";
    this.code = code;
    this.fingerprint = fingerprint;
  }
}

export function createEmptyHubState(now = new Date().toISOString()): PersistedHubState {
  return {
    version: 1,
    revision: 0,
    bots: [],
    sections: [],
    inbox: [],
    outbox: [],
    threads: [],
    updatedAt: now,
  };
}
