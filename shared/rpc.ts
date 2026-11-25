import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";
import {
  BotHubSnapshotSchema,
  BotPermissionModeSchema,
  BotRecordSchema,
  BotRoleTypeSchema,
  BotSectionSchema,
  DispatchedThreadSchema,
  InboxItemSchema,
  InboxSourceSchema,
  InboxStatusSchema,
  OutboxItemSchema,
  OutboxKindSchema,
  OutboxStatusSchema,
  ThreadMessageDigestSchema,
} from "./contracts";

export const botSnapshotRpc = defineRpc({
  name: "paseo-bot.snapshot",
  input: z.object({}),
  output: BotHubSnapshotSchema,
});

export const botUpsertRpc = defineRpc({
  name: "paseo-bot.bot.upsert",
  input: z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(40),
    roleType: BotRoleTypeSchema,
    bio: z.string().max(160).default(""),
    personaPrompt: z.string().max(4000).default(""),
    iconName: z.string().min(1).optional(),
    avatarColor: z.string().min(4).optional(),
    provider: z.string().min(1).default("claude/sonnet"),
    defaultCwd: z.string().min(1),
    permissionMode: BotPermissionModeSchema.default("workspace"),
    sectionId: z.string().nullable().default(null),
    pinned: z.boolean().default(false),
    agentId: z.string().nullable().optional(),
  }),
  output: BotRecordSchema,
});

export const botArchiveRpc = defineRpc({
  name: "paseo-bot.bot.archive",
  input: z.object({
    botId: z.string().min(1),
    archived: z.boolean().default(true),
  }),
  output: BotRecordSchema,
});

export const botSectionUpsertRpc = defineRpc({
  name: "paseo-bot.section.upsert",
  input: z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(40),
    collapsed: z.boolean().default(false),
    order: z.number().int().optional(),
    color: z.string().nullable().default(null),
  }),
  output: BotSectionSchema,
});

export const botSectionDeleteRpc = defineRpc({
  name: "paseo-bot.section.delete",
  input: z.object({ sectionId: z.string().min(1) }),
  output: z.object({ deleted: z.boolean() }),
});

export const botOpenSessionRpc = defineRpc({
  name: "paseo-bot.bot.open-session",
  input: z.object({
    botId: z.string().min(1),
    initialPrompt: z.string().optional(),
  }),
  output: z.object({
    bot: BotRecordSchema,
    agentId: z.string().min(1),
    created: z.boolean(),
  }),
});

export const inboxAddRpc = defineRpc({
  name: "paseo-bot.inbox.add",
  input: z.object({
    rawText: z.string().min(1),
    source: InboxSourceSchema.default("user"),
    targetBotId: z.string().nullable().optional(),
    targetProject: z.string().nullable().optional(),
    tags: z.array(z.string()).default([]),
    note: z.string().optional(),
  }),
  output: InboxItemSchema,
});

export const inboxUpdateRpc = defineRpc({
  name: "paseo-bot.inbox.update",
  input: z.object({
    id: z.string().min(1),
    status: InboxStatusSchema.optional(),
    targetBotId: z.string().nullable().optional(),
    targetProject: z.string().nullable().optional(),
    linkedAgentId: z.string().nullable().optional(),
    destination: z.string().nullable().optional(),
    note: z.string().optional(),
  }),
  output: InboxItemSchema,
});

export const inboxImportHqRpc = defineRpc({
  name: "paseo-bot.inbox.import-hq",
  input: z.object({
    hqDir: z.string().default("/Users/xingyi/ai/personal-hq"),
  }),
  output: z.object({
    importedInbox: z.number().int().nonnegative(),
    importedOutbox: z.number().int().nonnegative(),
  }),
});

export const outboxAddRpc = defineRpc({
  name: "paseo-bot.outbox.add",
  input: z.object({
    kind: OutboxKindSchema,
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(2000),
    status: OutboxStatusSchema.default("pending"),
    botId: z.string().nullable().default(null),
    agentId: z.string().nullable().default(null),
    threadLink: z.string().default(""),
    inboxId: z.string().nullable().default(null),
  }),
  output: OutboxItemSchema,
});

export const outboxAckRpc = defineRpc({
  name: "paseo-bot.outbox.ack",
  input: z.object({
    id: z.string().min(1),
    note: z.string().optional(),
  }),
  output: OutboxItemSchema,
});

export const threadDispatchRpc = defineRpc({
  name: "paseo-bot.thread.dispatch",
  input: z.object({
    botId: z.string().min(1),
    title: z.string().min(1).max(80),
    prompt: z.string().min(1),
    cwd: z.string().optional(),
    worktree: z.boolean().default(true),
    inboxId: z.string().nullable().optional(),
  }),
  output: z.object({
    thread: DispatchedThreadSchema,
    agentId: z.string().min(1),
  }),
});

export const threadInspectRpc = defineRpc({
  name: "paseo-bot.thread.inspect",
  input: z.object({
    agentId: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  output: z.object({
    agentId: z.string().min(1),
    status: z.string(),
    title: z.string().nullable(),
    cwd: z.string().nullable(),
    digests: z.array(ThreadMessageDigestSchema),
  }),
});

export const hubSubscribe = defineSubscription({
  name: "paseo-bot.hub.subscribe",
  input: z.object({}),
  event: BotHubSnapshotSchema,
});
