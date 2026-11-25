import type { PaseoApi } from "@getpaseo/client";
import {
  defineAgentTool,
  type AgentToolContext,
  type AgentToolDefinition,
  type AgentToolResult,
  type PluginHookContext,
} from "@getpaseo/plugin/server";
import type { z } from "zod";
import {
  DomainError,
  ERROR_CODES,
  type BotRecord,
  type DispatchedThread,
  type InboxCaptureEvent,
  type InboxItem,
  type InboxMarkDispatchedEvent,
  type OutboxAckByAgentEvent,
  type OutboxEnqueueEvent,
  type OutboxItem,
} from "../../../shared/contracts";
import { threadDispatchRpc, threadInspectRpc } from "../../../shared/rpc";
import type { PaseoPort } from "../../adapters/paseo-adapter";
import type { FeatureManifest, ServerFeature, ServerKernel } from "../../core/kernel";
import {
  buildAgentOpenPatch,
  buildPermissionOutboxPayload,
  buildTurnOutboxPayload,
  canInspectThread,
  checkToolAllowed,
  filterInboxForTool,
  recordDispatchedThread,
  resolveBotByAgent,
  summarizeBotsForTool,
  updateDispatchedThreadStatus,
} from "./logic";
import {
  BotListToolInput,
  DispatchThreadToolInput,
  InboxCaptureToolInput,
  InboxListToolInput,
  InspectThreadToolInput,
  OutboxPostToolInput,
} from "./schema";

export const THREAD_BRIDGE_MANIFEST: FeatureManifest = {
  id: "thread_bridge",
  name: "Thread Bridge & Role Guard",
};

function guardedTool<Input extends z.ZodType>(
  kernel: ServerKernel,
  spec: {
    name: string;
    description: string;
    input: Input;
    run(input: z.output<Input>, ctx: AgentToolContext): AgentToolResult | Promise<AgentToolResult>;
  },
): AgentToolDefinition {
  return defineAgentTool({
    name: spec.name,
    description: spec.description,
    input: spec.input,
    execute(input, ctx) {
      const denied = checkToolAllowed(kernel.store.read().bots, ctx.agent, spec.name);
      return denied ? { text: denied, isError: true } : spec.run(input, ctx);
    },
  });
}

async function executeDispatch(
  kernel: ServerKernel,
  adapter: PaseoPort,
  paseo: PaseoApi,
  params: {
    botId: string;
    title: string;
    prompt: string;
    cwd?: string;
    worktree: boolean;
    inboxId: string | null;
    callerBot?: BotRecord;
  },
): Promise<{ thread: DispatchedThread; agentId: string }> {
  const id = THREAD_BRIDGE_MANIFEST.id;
  const targetBot = kernel.store.read().bots.find((entry) => entry.id === params.botId);
  if (!targetBot) throw new DomainError(id, "dispatchThread", ERROR_CODES.NOT_FOUND, `Bot not found: ${params.botId}`);
  if (targetBot.roleType === "companion") {
    throw new DomainError(id, "dispatchThread", ERROR_CODES.PERMISSION_DENIED, "Companion bots cannot dispatch worker threads");
  }
  if (params.callerBot?.roleType === "project_lead" && params.callerBot.id !== targetBot.id) {
    throw new DomainError(id, "dispatchThread", ERROR_CODES.PERMISSION_DENIED, "Project lead can only dispatch worker threads under itself");
  }

  const cwd = params.cwd?.trim() || targetBot.defaultCwd;
  const created = await adapter.dispatchThread(paseo, { bot: targetBot, title: params.title, prompt: params.prompt, cwd, worktree: params.worktree });
  const thread = await kernel.commitState(id, (state) => {
    const { nextState, thread: saved } = recordDispatchedThread(state, {
      agentId: created.agentId,
      botId: targetBot.id,
      title: params.title,
      cwd,
      worktree: params.worktree,
      inboxId: params.inboxId,
      status: "running",
    });
    return { nextState, result: saved };
  });

  if (params.inboxId) {
    await kernel.events.emitWithAck<void, InboxMarkDispatchedEvent>("inbox.markDispatched", {
      inboxId: params.inboxId,
      botId: targetBot.id,
      agentId: created.agentId,
      title: params.title,
    });
  }
  return { thread, agentId: created.agentId };
}

function buildBridgeTools(kernel: ServerKernel, adapter: PaseoPort): AgentToolDefinition[] {
  return [
    guardedTool(kernel, {
      name: "bot_list",
      description: "List configured bots with their roleType, bio, defaultCwd, and agentId.",
      input: BotListToolInput,
      run(input) {
        const bots = summarizeBotsForTool(kernel.store.read().bots, input.includeArchived);
        return { text: JSON.stringify(bots, null, 2), structuredContent: { bots } };
      },
    }),
    guardedTool(kernel, {
      name: "inbox_capture",
      description: "Silently capture a raw thought, task, or idea verbatim into the Inbox.",
      input: InboxCaptureToolInput,
      async run(input, ctx) {
        const role = ctx.agent.metadata?.["paseo-bot.roleType"];
        const source = role === "companion" ? "companion" : role === "butler" ? "butler" : "user";
        const item = await kernel.events.emitWithAck<InboxItem, InboxCaptureEvent>("inbox.capture", {
          rawText: input.rawText,
          source,
          targetBotId: input.targetBotId ?? null,
          targetProject: input.targetProject ?? null,
          tags: input.tags,
          note: input.note,
        });
        return item ? { text: `Captured inbox item ${item.id}`, structuredContent: item } : { text: "Queued into Inbox" };
      },
    }),
    guardedTool(kernel, {
      name: "inbox_list",
      description: "List Inbox items (optionally filtered by status) for triage or dispatch.",
      input: InboxListToolInput,
      run(input) {
        const items = filterInboxForTool(kernel.store.read().inbox, input.status, input.limit);
        return { text: JSON.stringify(items, null, 2), structuredContent: { items } };
      },
    }),
    guardedTool(kernel, {
      name: "outbox_post",
      description: "Post a concise needs_decision, blocked, or delivered item to the Outbox.",
      input: OutboxPostToolInput,
      async run(input, ctx) {
        const botId = typeof ctx.agent.metadata?.["paseo-bot.botId"] === "string" ? ctx.agent.metadata["paseo-bot.botId"] : null;
        const item = await kernel.events.emitWithAck<OutboxItem, OutboxEnqueueEvent>("outbox.enqueue", {
          kind: input.kind,
          title: input.title,
          summary: input.summary,
          status: input.kind === "delivered" ? "delivered" : "pending",
          botId,
          agentId: ctx.agent.id,
          threadLink: input.threadLink ?? "",
          inboxId: input.inboxId ?? null,
        });
        return item ? { text: `Posted outbox item ${item.id}`, structuredContent: item } : { text: "Queued into Outbox" };
      },
    }),
    guardedTool(kernel, {
      name: "bot_dispatch_thread",
      description: "Dispatch an isolated worker thread under a target bot and optionally link an Inbox item.",
      input: DispatchThreadToolInput,
      async run(input, ctx) {
        const callerBot = resolveBotByAgent(kernel.store.read().bots, ctx.agent);
        try {
          const result = await executeDispatch(kernel, adapter, ctx.paseo, {
            botId: input.botId ?? callerBot?.id ?? "",
            title: input.title,
            prompt: input.prompt,
            cwd: input.cwd,
            worktree: input.worktree,
            inboxId: input.inboxId ?? null,
            callerBot,
          });
          return { text: `Dispatched thread ${result.agentId} (${result.thread.title})`, structuredContent: result };
        } catch (err) {
          return { text: err instanceof Error ? err.message : String(err), isError: true };
        }
      },
    }),
    guardedTool(kernel, {
      name: "thread_inspect",
      description: "Read a worker thread's live status and recent timeline messages directly.",
      input: InspectThreadToolInput,
      async run(input, ctx) {
        const state = kernel.store.read();
        const callerBot = resolveBotByAgent(state.bots, ctx.agent);
        const scopeErr = canInspectThread(state, callerBot, input.agentId);
        if (scopeErr) return { text: scopeErr, isError: true };
        const result = await adapter.inspectThread(ctx.paseo, input.agentId, input.limit);
        return { text: JSON.stringify(result, null, 2), structuredContent: result };
      },
    }),
  ];
}

async function readTurnCompletionSummary(ctx: PluginHookContext, agentId: string, turnId: string | null, fallback: string): Promise<string> {
  if (!turnId || !ctx.paseo?.agents?.ref) return fallback;
  try {
    const page = await ctx.paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 5, wholeTurns: true });
    const last = [...page.entries].reverse().find((e) => e.item.type === "assistant_message");
    if (last?.item.type === "assistant_message" && last.item.text.trim()) return last.item.text.trim().slice(0, 2000);
  } catch {
    return fallback;
  }
  return fallback;
}

export const threadBridgeFeature: ServerFeature = {
  manifest: THREAD_BRIDGE_MANIFEST,
  register(kernel) {
    const adapter = kernel.adapter as PaseoPort;
    const id = THREAD_BRIDGE_MANIFEST.id;
    const tools = buildBridgeTools(kernel, adapter);

    kernel.handleRpc(id, threadDispatchRpc, (input, ctx) =>
      executeDispatch(kernel, adapter, ctx.paseo, {
        botId: input.botId,
        title: input.title,
        prompt: input.prompt,
        cwd: input.cwd,
        worktree: input.worktree,
        inboxId: input.inboxId ?? null,
      }),
    );

    kernel.handleRpc(id, threadInspectRpc, (input, ctx) => adapter.inspectThread(ctx.paseo, input.agentId, input.limit));

    const offOpen = kernel.addHook("agent.open.before", async (payload) =>
      buildAgentOpenPatch(payload.request, kernel.store.read().bots, tools),
    );
    const offPerm = kernel.addHook("agent.permission.before", async (payload) => {
      const matched = kernel.store.read().threads.find((entry) => entry.agentId === payload.agent.id);
      const outbox = buildPermissionOutboxPayload(payload.agent, payload.request, matched?.inboxId ?? null);
      if (outbox) await kernel.events.emitWithAck<OutboxItem, OutboxEnqueueEvent>("outbox.enqueue", outbox);
    });
    const offPermAfter = kernel.addHook("agent.permission.after", async (payload) => {
      await kernel.events.emitWithAck<number, OutboxAckByAgentEvent>("outbox.ackByAgent", {
        agentId: payload.agent.id,
        kind: "needs_decision",
        note: "Resolved in Paseo",
      });
    });
    const offTurn = kernel.addHook("agent.turn.after", async (payload, ctx) => {
      if (payload.agent.metadata?.["paseo-bot.kind"] !== "worker-thread") return;
      if (payload.outcome.kind !== "completed" && payload.outcome.kind !== "failed") return;
      const matched = kernel.store.read().threads.find((entry) => entry.agentId === payload.agent.id);
      const threadTitle = payload.agent.title?.trim() || matched?.title || payload.agent.id;
      const status = payload.outcome.kind;
      await kernel.commitState(id, (state) => ({ nextState: updateDispatchedThreadStatus(state, payload.agent.id, status), result: null }));
      const summary = payload.outcome.kind === "completed"
        ? await readTurnCompletionSummary(ctx, payload.agent.id, payload.turnId, `Worker thread "${threadTitle}" completed its turn.`)
        : "";
      const outbox = buildTurnOutboxPayload(payload.agent, payload.outcome, threadTitle, matched?.inboxId ?? null, summary);
      if (outbox) await kernel.events.emitWithAck<OutboxItem, OutboxEnqueueEvent>("outbox.enqueue", outbox);
    });

    return () => {
      offOpen();
      offPerm();
      offPermAfter();
      offTurn();
    };
  },
};
