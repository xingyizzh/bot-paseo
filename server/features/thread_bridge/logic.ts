import type {
  AgentToolDefinition,
  PluginHookAgent,
  PluginHookResult,
  PluginSessionOpenRequest,
  PluginTurnOutcome,
} from "@getpaseo/plugin/server";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import type {
  BotRecord,
  DispatchedThread,
  InboxItem,
  InboxStatus,
  PersistedHubState,
} from "../../../shared/contracts";
import type { OutboxEnqueueEvent, RecordThreadInput, RolePolicy } from "./schema";

const COMPANION_TOOLS: readonly string[] = ["inbox_capture"];
const BUTLER_TOOLS: readonly string[] = [
  "bot_list",
  "inbox_capture",
  "inbox_list",
  "outbox_post",
  "bot_dispatch_thread",
  "thread_inspect",
];
const PROJECT_LEAD_TOOLS: readonly string[] = [
  "bot_dispatch_thread",
  "thread_inspect",
  "outbox_post",
];

export function buildRolePolicy(bot: BotRecord): RolePolicy {
  const persona = bot.personaPrompt.trim();
  if (bot.roleType === "companion") {
    return {
      roleType: "companion",
      allowedToolNames: COMPANION_TOOLS,
      systemPromptLines: [
        "ROLE GUARD [COMPANION]: Keep conversation warm, empathetic, and natural. STRICTLY FORBIDDEN: never output source code, stack traces, diffs, shell commands, or engineering diagnostics.",
        "TOOL ISOLATION: You only have inbox_capture to silently record spontaneous user thoughts verbatim; never attempt thread dispatch, inspection, or outbox management.",
        ...(persona ? [persona] : []),
      ],
    };
  }
  if (bot.roleType === "butler") {
    return {
      roleType: "butler",
      allowedToolNames: BUTLER_TOOLS,
      systemPromptLines: [
        "ROLE GUARD [BUTLER]: Triage inbox items, coordinate project leads, dispatch isolated worker threads, inspect execution timelines, and publish concise outbox decisions. Do not write application code directly.",
        ...(persona ? [persona] : []),
      ],
    };
  }
  return {
    roleType: "project_lead",
    allowedToolNames: PROJECT_LEAD_TOOLS,
    systemPromptLines: [
      `ROLE GUARD [PROJECT_LEAD]: Stay scoped to project workspace "${bot.defaultCwd}". Dispatch worker threads, inspect their timelines, and report decisions, blockers, or deliveries to Outbox.`,
      ...(persona ? [persona] : []),
    ],
  };
}

export function resolveBotByAgent(bots: readonly BotRecord[], agent: PluginHookAgent): BotRecord | undefined {
  const botId = agent.metadata?.["paseo-bot.botId"];
  return typeof botId === "string" ? bots.find((entry) => entry.id === botId) : undefined;
}

export function checkToolAllowed(bots: readonly BotRecord[], agent: PluginHookAgent, toolName: string): string | null {
  const bot = resolveBotByAgent(bots, agent);
  if (bot) {
    return buildRolePolicy(bot).allowedToolNames.includes(toolName)
      ? null
      : `Role "${bot.roleType}" is not allowed to call "${toolName}".`;
  }
  if (agent.metadata?.["paseo-bot.roleType"] === "companion" && toolName !== "inbox_capture") {
    return "Companion role is strictly limited to inbox_capture.";
  }
  return null;
}

export function buildAgentOpenPatch(
  request: PluginSessionOpenRequest,
  bots: readonly BotRecord[],
  definedTools: readonly AgentToolDefinition[] = [],
): PluginHookResult<"agent.open.before"> {
  if (request.metadata?.["paseo-bot.kind"] === "worker-thread") return undefined;
  const botId = request.metadata?.["paseo-bot.botId"];
  if (typeof botId !== "string" || !botId) return undefined;
  const bot = bots.find((entry) => entry.id === botId);
  if (!bot) return undefined;

  const policy = buildRolePolicy(bot);
  const allowed = new Set(policy.allowedToolNames);
  const filteredTools = new Map<string, AgentToolDefinition>();
  for (const tool of [...request.tools, ...definedTools]) {
    if (allowed.has(tool.name)) filteredTools.set(tool.name, tool);
  }

  const mergedPrompts = [...(request.appendSystemPrompt ?? [])];
  for (const line of policy.systemPromptLines) {
    if (line && !mergedPrompts.includes(line)) mergedPrompts.push(line);
  }
  return { ...request, tools: [...filteredTools.values()], appendSystemPrompt: mergedPrompts };
}

export function recordDispatchedThread(
  state: PersistedHubState,
  input: RecordThreadInput,
  now = new Date().toISOString(),
): { nextState: PersistedHubState; thread: DispatchedThread } {
  const existing = state.threads.find((entry) => entry.agentId === input.agentId);
  const thread: DispatchedThread = {
    agentId: input.agentId,
    botId: input.botId,
    title: input.title,
    cwd: input.cwd,
    worktree: input.worktree,
    inboxId: input.inboxId !== undefined ? input.inboxId : (existing?.inboxId ?? null),
    status: input.status ?? existing?.status ?? "running",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const threads = existing
    ? state.threads.map((entry) => (entry.agentId === thread.agentId ? thread : entry))
    : [...state.threads, thread];
  return { nextState: { ...state, threads }, thread };
}

export function updateDispatchedThreadStatus(
  state: PersistedHubState,
  agentId: string,
  status: string,
  now = new Date().toISOString(),
): PersistedHubState {
  if (!state.threads.some((entry) => entry.agentId === agentId)) return state;
  return {
    ...state,
    threads: state.threads.map((entry) => (entry.agentId === agentId ? { ...entry, status, updatedAt: now } : entry)),
  };
}

export function buildPermissionOutboxPayload(
  agent: PluginHookAgent,
  request: AgentPermissionRequest,
  inboxId: string | null,
): Omit<OutboxEnqueueEvent, "ackAccepted" | "resolve" | "reject"> | null {
  const botId = agent.metadata?.["paseo-bot.botId"];
  if (typeof botId !== "string" || !botId) return null;
  const title = (request.title?.trim() || `Permission needed: ${request.name}`).slice(0, 120);
  const summary = (
    request.description?.trim() ||
    `${agent.title ?? agent.id} requested "${request.name}" (${request.kind})`
  ).slice(0, 2000);
  return { kind: "needs_decision", title, summary, status: "pending", botId, agentId: agent.id, threadLink: "", inboxId };
}

export function buildTurnOutboxPayload(
  agent: PluginHookAgent,
  outcome: PluginTurnOutcome,
  threadTitle: string,
  inboxId: string | null,
  completedSummary: string,
): Omit<OutboxEnqueueEvent, "ackAccepted" | "resolve" | "reject"> | null {
  if (agent.metadata?.["paseo-bot.kind"] !== "worker-thread") return null;
  if (outcome.kind !== "completed" && outcome.kind !== "failed") return null;
  const botId = typeof agent.metadata?.["paseo-bot.botId"] === "string" ? agent.metadata["paseo-bot.botId"] : null;
  if (outcome.kind === "completed") {
    return {
      kind: "delivered",
      title: `Delivered: ${threadTitle}`.slice(0, 120),
      summary: completedSummary.slice(0, 2000),
      status: "delivered",
      botId,
      agentId: agent.id,
      threadLink: "",
      inboxId,
    };
  }
  return {
    kind: "blocked",
    title: `Blocked: ${threadTitle}`.slice(0, 120),
    summary: (outcome.error.message?.trim() || `Worker thread "${threadTitle}" failed.`).slice(0, 2000),
    status: "pending",
    botId,
    agentId: agent.id,
    threadLink: "",
    inboxId,
  };
}

export function summarizeBotsForTool(bots: readonly BotRecord[], includeArchived: boolean) {
  return bots
    .filter((entry) => includeArchived || entry.archivedAt === null)
    .map(({ id, name, roleType, bio, defaultCwd, permissionMode, agentId, archivedAt }) => ({
      id, name, roleType, bio, defaultCwd, permissionMode, agentId, archivedAt,
    }));
}

export function filterInboxForTool(inbox: readonly InboxItem[], status: InboxStatus | undefined, limit: number) {
  const filtered = status ? inbox.filter((entry) => entry.status === status) : inbox;
  return filtered.slice(-limit).reverse();
}
