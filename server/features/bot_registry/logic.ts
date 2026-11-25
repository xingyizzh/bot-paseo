import type { RpcInput } from "@getpaseo/plugin";
import { pickNextColor } from "../../../shared/avatars";
import {
  DomainError,
  ERROR_CODES,
  type BotRecord,
  type BotSection,
  type PersistedHubState,
} from "../../../shared/contracts";
import {
  botArchiveRpc,
  botOpenSessionRpc,
  botSectionDeleteRpc,
  botSectionUpsertRpc,
  botSnapshotRpc,
  botUpsertRpc,
} from "../../../shared/rpc";

export type BotSnapshotInput = RpcInput<typeof botSnapshotRpc>;
export type BotUpsertInput = RpcInput<typeof botUpsertRpc>;
export type BotArchiveInput = RpcInput<typeof botArchiveRpc>;
export type BotSectionUpsertInput = RpcInput<typeof botSectionUpsertRpc>;
export type BotSectionDeleteInput = RpcInput<typeof botSectionDeleteRpc>;
export type BotOpenSessionInput = RpcInput<typeof botOpenSessionRpc>;

function makeId(prefix: string, existingIds: Set<string>, seedBase: string): string {
  const slug = seedBase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const base = slug ? `${prefix}-${slug}` : `${prefix}-item`;
  if (!existingIds.has(base)) return base;
  let seq = 2;
  while (existingIds.has(`${base}-${seq}`)) seq += 1;
  return `${base}-${seq}`;
}

export function seedDefaultBots(
  state: PersistedHubState,
  defaultCwd: string,
  now = new Date().toISOString(),
): PersistedHubState {
  if (state.bots.length > 0) return state;
  const safeCwd = defaultCwd.trim() || ".";
  const butler: BotRecord = {
    id: "butler",
    name: "管家总管",
    roleType: "butler",
    bio: "拆解需求、统筹项目主管、穿透查看执行线程并收口 Outbox",
    personaPrompt: "你是工作总管家，只做拆解、分派与穿透验收，不亲自堆叠业务代码。",
    iconName: "Crown",
    avatarColor: "#3B66F5",
    provider: "claude/sonnet",
    defaultCwd: safeCwd,
    permissionMode: "workspace",
    sectionId: null,
    pinned: true,
    agentId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const companion: BotRecord = {
    id: "companion",
    name: "陪伴主位",
    roleType: "companion",
    bio: "纯粹有温度的日常陪伴对话，随手把闪现灵感静默记入 Inbox",
    personaPrompt: "你是陪伴主位，只进行自然有人情味的对话，绝不输出代码堆栈或工程术语。",
    iconName: "Sparkles",
    avatarColor: "#6D28D9",
    provider: "claude/sonnet",
    defaultCwd: safeCwd,
    permissionMode: "readonly",
    sectionId: null,
    pinned: true,
    agentId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, bots: [butler, companion] };
}

export function upsertBot(
  state: PersistedHubState,
  input: BotUpsertInput,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; bot: BotRecord } {
  if (input.roleType === "companion" && input.permissionMode !== "readonly") {
    throw new DomainError(
      "bot_registry",
      "upsertBot",
      ERROR_CODES.PERMISSION_DENIED,
      "Companion role is locked to readonly permissions",
    );
  }

  const existing = input.id ? state.bots.find((b) => b.id === input.id) : undefined;
  if (input.id && !existing) {
    throw new DomainError(
      "bot_registry",
      "upsertBot",
      ERROR_CODES.NOT_FOUND,
      `Bot not found: ${input.id}`,
    );
  }

  const normalizedSectionId =
    input.roleType === "butler" || input.roleType === "companion" || input.pinned
      ? null
      : input.sectionId;

  if (normalizedSectionId && !state.sections.some((s) => s.id === normalizedSectionId)) {
    throw new DomainError(
      "bot_registry",
      "upsertBot",
      ERROR_CODES.NOT_FOUND,
      `Section not found: ${normalizedSectionId}`,
    );
  }

  const usedColors = state.bots.filter((b) => b.id !== existing?.id).map((b) => b.avatarColor);
  const existingIds = new Set(state.bots.map((b) => b.id));
  const defaultIcon = input.roleType === "butler" ? "Crown" : input.roleType === "companion" ? "Sparkles" : "Compass";

  const bot: BotRecord = {
    id: existing?.id ?? makeId("bot", existingIds, input.name),
    name: input.name.trim(),
    roleType: input.roleType,
    bio: input.bio.trim(),
    personaPrompt: input.personaPrompt.trim(),
    iconName: input.iconName ?? existing?.iconName ?? defaultIcon,
    avatarColor: input.avatarColor ?? existing?.avatarColor ?? pickNextColor(usedColors),
    provider: input.provider,
    defaultCwd: input.defaultCwd,
    permissionMode: input.roleType === "companion" ? "readonly" : input.permissionMode,
    sectionId: normalizedSectionId,
    pinned: input.pinned,
    agentId: input.agentId !== undefined ? input.agentId : (existing?.agentId ?? null),
    archivedAt: existing?.archivedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const bots = existing
    ? state.bots.map((b) => (b.id === bot.id ? bot : b))
    : [...state.bots, bot];

  return { nextState: { ...state, bots }, bot };
}

export function archiveBot(
  state: PersistedHubState,
  input: BotArchiveInput,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; bot: BotRecord } {
  const existing = state.bots.find((b) => b.id === input.botId);
  if (!existing) {
    throw new DomainError(
      "bot_registry",
      "archiveBot",
      ERROR_CODES.NOT_FOUND,
      `Bot not found: ${input.botId}`,
    );
  }
  const bot: BotRecord = {
    ...existing,
    archivedAt: input.archived ? now : null,
    updatedAt: now,
  };
  return {
    nextState: { ...state, bots: state.bots.map((b) => (b.id === bot.id ? bot : b)) },
    bot,
  };
}

export function upsertSection(
  state: PersistedHubState,
  input: BotSectionUpsertInput,
): { nextState: PersistedHubState; section: BotSection } {
  const existing = input.id ? state.sections.find((s) => s.id === input.id) : undefined;
  if (input.id && !existing) {
    throw new DomainError(
      "bot_registry",
      "upsertSection",
      ERROR_CODES.NOT_FOUND,
      `Section not found: ${input.id}`,
    );
  }
  const existingIds = new Set(state.sections.map((s) => s.id));
  const maxOrder = state.sections.reduce((acc, s) => Math.max(acc, s.order), -1);
  const section: BotSection = {
    id: existing?.id ?? makeId("sec", existingIds, input.name),
    name: input.name.trim(),
    collapsed: input.collapsed,
    order: input.order ?? existing?.order ?? maxOrder + 1,
    color: input.color,
  };
  const sections = existing
    ? state.sections.map((s) => (s.id === section.id ? section : s))
    : [...state.sections, section];
  return { nextState: { ...state, sections }, section };
}

export function deleteSection(
  state: PersistedHubState,
  input: BotSectionDeleteInput,
): { nextState: PersistedHubState; deleted: boolean } {
  const exists = state.sections.some((s) => s.id === input.sectionId);
  if (!exists) return { nextState: state, deleted: false };
  return {
    nextState: {
      ...state,
      sections: state.sections.filter((s) => s.id !== input.sectionId),
      bots: state.bots.map((b) => (b.sectionId === input.sectionId ? { ...b, sectionId: null } : b)),
    },
    deleted: true,
  };
}

export function bindBotAgent(
  state: PersistedHubState,
  botId: string,
  agentId: string,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; bot: BotRecord } {
  const existing = state.bots.find((b) => b.id === botId);
  if (!existing) {
    throw new DomainError(
      "bot_registry",
      "bindBotAgent",
      ERROR_CODES.NOT_FOUND,
      `Bot not found: ${botId}`,
    );
  }
  const bot: BotRecord = { ...existing, agentId, updatedAt: now };
  return {
    nextState: { ...state, bots: state.bots.map((b) => (b.id === botId ? bot : b)) },
    bot,
  };
}

export function updateHubSettings(
  state: PersistedHubState,
  input: { paseoEnabled: boolean },
): PersistedHubState {
  if (state.settings.paseoEnabled === input.paseoEnabled) return state;
  return {
    ...state,
    settings: { ...state.settings, paseoEnabled: input.paseoEnabled },
  };
}
