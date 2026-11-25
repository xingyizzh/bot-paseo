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

export const HubSettingsSchema = z.object({
  paseoEnabled: z.boolean().default(true),
});
export type HubSettings = z.infer<typeof HubSettingsSchema>;

export const ExecutionCapabilitiesSchema = z.object({
  threads: z.boolean(),
  worktree: z.boolean(),
  inspect: z.boolean(),
});
export type ExecutionCapabilities = z.infer<typeof ExecutionCapabilitiesSchema>;

export function resolveExecutionCapabilities(settings?: HubSettings | null): ExecutionCapabilities {
  const enabled = settings?.paseoEnabled ?? true;
  return { threads: enabled, worktree: enabled, inspect: enabled };
}

export const PersistedHubStateSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  settings: HubSettingsSchema.default({ paseoEnabled: true }),
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
    settings: { paseoEnabled: true },
    bots: [],
    sections: [],
    inbox: [],
    outbox: [],
    threads: [],
    updatedAt: now,
  };
}

export const PASEO_BOT_TOOL_NAMES = [
  "bot_list",
  "inbox_capture",
  "inbox_list",
  "outbox_post",
  "outbox_list",
  "outbox_ack",
  "bot_dispatch_thread",
  "thread_inspect",
] as const;

export type PaseoBotToolName = (typeof PASEO_BOT_TOOL_NAMES)[number];

export const BOT_ROLE_OPTIONS: readonly { value: BotRoleType; label: string }[] = [
  { value: "project_lead", label: "项目主管" },
  { value: "butler", label: "管家总管" },
  { value: "companion", label: "陪伴主位" },
];

export const BOT_PERMISSION_OPTIONS: readonly { value: BotPermissionMode; label: string }[] = [
  { value: "readonly", label: "只读" },
  { value: "workspace", label: "工作区" },
  { value: "full", label: "完全" },
];

const OUTBOX_KIND_RANK: Record<OutboxKind, number> = {
  needs_decision: 0,
  blocked: 1,
  delivered: 2,
};

export function sortOutboxItems(items: readonly OutboxItem[]): OutboxItem[] {
  return [...items].sort((a, b) => {
    const ackDiff = Number(a.status === "acked") - Number(b.status === "acked");
    if (ackDiff !== 0) return ackDiff;
    const rankDiff = OUTBOX_KIND_RANK[a.kind] - OUTBOX_KIND_RANK[b.kind];
    if (rankDiff !== 0) return rankDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function filterOutboxItems(
  items: readonly OutboxItem[],
  opts?: { includeAcked?: boolean; kind?: OutboxKind; limit?: number },
): OutboxItem[] {
  const includeAcked = opts?.includeAcked ?? false;
  const filtered = items.filter((item) => {
    if (!includeAcked && item.status === "acked") return false;
    if (opts?.kind && item.kind !== opts.kind) return false;
    return true;
  });
  const sorted = sortOutboxItems(filtered);
  return opts?.limit !== undefined ? sorted.slice(0, Math.max(0, opts.limit)) : sorted;
}

export interface AckEventBase<Result = void> {
  ackAccepted?: () => void;
  resolve?: (value: Result) => void;
  reject?: (err: unknown) => void;
}

export interface InboxCaptureEvent extends AckEventBase<InboxItem> {
  rawText: string;
  source?: InboxSource;
  targetBotId?: string | null;
  targetProject?: string | null;
  tags?: string[];
  note?: string;
}

export interface InboxMarkDispatchedEvent extends AckEventBase<void> {
  inboxId: string;
  botId: string;
  agentId: string;
  title: string;
}

export interface OutboxEnqueueEvent extends AckEventBase<OutboxItem> {
  kind: OutboxKind;
  title: string;
  summary: string;
  status?: OutboxStatus;
  botId?: string | null;
  agentId?: string | null;
  threadLink?: string;
  inboxId?: string | null;
}

export interface OutboxAckByAgentEvent extends AckEventBase<number> {
  agentId: string;
  kind?: OutboxKind;
  note?: string;
}

export interface OutboxListEvent extends AckEventBase<OutboxItem[]> {
  includeAcked?: boolean;
  kind?: OutboxKind;
  limit?: number;
}

export interface OutboxAckByIdEvent extends AckEventBase<OutboxItem> {
  id: string;
  note?: string;
}
