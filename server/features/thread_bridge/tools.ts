import { defineAgentTool, type AgentToolContext, type AgentToolDefinition, type AgentToolResult } from "@getpaseo/plugin/server";
import type { z } from "zod";
import {
  DomainError, ERROR_CODES,
  type BotRecord, type DispatchedThread, type InboxCaptureEvent, type InboxItem,
  type InboxMarkDispatchedEvent, type OutboxAckByIdEvent, type OutboxEnqueueEvent,
  type OutboxItem, type OutboxListEvent,
} from "../../../shared/contracts";
import type { ExecutionPort } from "../../adapters/execution-port";
import type { ServerKernel } from "../../core/kernel";
import {
  canInspectThread, checkToolAllowed, filterInboxForTool,
  recordDispatchedThread, resolveBotByAgent, summarizeBotsForTool,
} from "./logic";
import {
  BotListToolInput, DispatchThreadToolInput, InboxCaptureToolInput, InboxListToolInput,
  InspectThreadToolInput, OutboxAckToolInput, OutboxListToolInput, OutboxPostToolInput,
} from "./schema";

export const THREAD_BRIDGE_ID = "thread_bridge";
export const THREADS_DISABLED_MSG = "Paseo 线程后端已关闭（纯 Bot 模式）";

export function isThreadsEnabled(kernel: ServerKernel, adapter: ExecutionPort): boolean {
  return kernel.store.read().settings.paseoEnabled && adapter.capabilities.threads;
}

function guardedTool<Input extends z.ZodType>(
  kernel: ServerKernel,
  adapter: ExecutionPort,
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
      const denied = checkToolAllowed(kernel.store.read().bots, ctx.agent, spec.name, isThreadsEnabled(kernel, adapter));
      return denied ? { text: denied, isError: true } : spec.run(input, ctx);
    },
  });
}

export async function executeDispatch(
  kernel: ServerKernel,
  adapter: ExecutionPort,
  host: unknown,
  params: { botId: string; title: string; prompt: string; cwd?: string; worktree: boolean; inboxId: string | null; callerBot?: BotRecord },
): Promise<{ thread: DispatchedThread; agentId: string }> {
  if (!isThreadsEnabled(kernel, adapter)) {
    throw new DomainError(THREAD_BRIDGE_ID, "dispatchThread", ERROR_CODES.PERMISSION_DENIED, THREADS_DISABLED_MSG);
  }
  const targetBot = kernel.store.read().bots.find((entry) => entry.id === params.botId);
  if (!targetBot) throw new DomainError(THREAD_BRIDGE_ID, "dispatchThread", ERROR_CODES.NOT_FOUND, `Bot not found: ${params.botId}`);
  if (targetBot.roleType === "companion") {
    throw new DomainError(THREAD_BRIDGE_ID, "dispatchThread", ERROR_CODES.PERMISSION_DENIED, "Companion bots cannot dispatch worker threads");
  }
  if (params.callerBot?.roleType === "project_lead" && params.callerBot.id !== targetBot.id) {
    throw new DomainError(THREAD_BRIDGE_ID, "dispatchThread", ERROR_CODES.PERMISSION_DENIED, "Project lead can only dispatch worker threads under itself");
  }

  const cwd = params.cwd?.trim() || targetBot.defaultCwd;
  const created = await adapter.dispatchThread(host, { bot: targetBot, title: params.title, prompt: params.prompt, cwd, worktree: params.worktree });
  const thread = await kernel.commitState(THREAD_BRIDGE_ID, (state) => {
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

export function buildBridgeTools(kernel: ServerKernel, adapter: ExecutionPort): AgentToolDefinition[] {
  return [
    guardedTool(kernel, adapter, {
      name: "bot_list",
      description: "List configured bots with their roleType, bio, defaultCwd, and agentId.",
      input: BotListToolInput,
      run(input) {
        const bots = summarizeBotsForTool(kernel.store.read().bots, input.includeArchived);
        return { text: JSON.stringify(bots, null, 2), structuredContent: { bots } };
      },
    }),
    guardedTool(kernel, adapter, {
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
    guardedTool(kernel, adapter, {
      name: "inbox_list",
      description: "List Inbox items (optionally filtered by status) for triage or dispatch.",
      input: InboxListToolInput,
      run(input) {
        const items = filterInboxForTool(kernel.store.read().inbox, input.status, input.limit);
        return { text: JSON.stringify(items, null, 2), structuredContent: { items } };
      },
    }),
    guardedTool(kernel, adapter, {
      name: "outbox_post",
      description: "Post a concise, quality-verified needs_decision, blocked, or delivered item to the Outbox (pass threadAgentId when reporting a worker thread).",
      input: OutboxPostToolInput,
      async run(input, ctx) {
        const state = kernel.store.read();
        if (input.threadAgentId) {
          const scopeErr = canInspectThread(state, resolveBotByAgent(state.bots, ctx.agent), input.threadAgentId);
          if (scopeErr) return { text: scopeErr, isError: true };
        }
        const botId = typeof ctx.agent.metadata?.["paseo-bot.botId"] === "string" ? ctx.agent.metadata["paseo-bot.botId"] : null;
        const item = await kernel.events.emitWithAck<OutboxItem, OutboxEnqueueEvent>("outbox.enqueue", {
          kind: input.kind,
          title: input.title,
          summary: input.summary,
          status: input.kind === "delivered" ? "delivered" : "pending",
          botId,
          agentId: input.threadAgentId ?? ctx.agent.id,
          threadLink: input.threadLink ?? "",
          inboxId: input.inboxId ?? null,
        });
        return item ? { text: `Posted outbox item ${item.id}`, structuredContent: item } : { text: "Queued into Outbox" };
      },
    }),
    guardedTool(kernel, adapter, {
      name: "outbox_list",
      description: "List Outbox items ordered by priority (needs_decision, blocked, delivered) for unified Butler reporting.",
      input: OutboxListToolInput,
      async run(input) {
        const items = (await kernel.events.emitWithAck<OutboxItem[], OutboxListEvent>("outbox.list", input)) ?? [];
        return { text: JSON.stringify(items, null, 2), structuredContent: { items } };
      },
    }),
    guardedTool(kernel, adapter, {
      name: "outbox_ack",
      description: "Acknowledge a summarized delivered Outbox item by id after reporting it to the user.",
      input: OutboxAckToolInput,
      async run(input) {
        try {
          const item = await kernel.events.emitWithAck<OutboxItem, OutboxAckByIdEvent>("outbox.ack", input);
          return item ? { text: `Acked outbox item ${item.id}`, structuredContent: item } : { text: "Outbox ack unavailable", isError: true };
        } catch (err) {
          return { text: err instanceof Error ? err.message : String(err), isError: true };
        }
      },
    }),
    guardedTool(kernel, adapter, {
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
    guardedTool(kernel, adapter, {
      name: "thread_inspect",
      description: "Read a worker thread's live status and recent timeline messages directly.",
      input: InspectThreadToolInput,
      async run(input, ctx) {
        if (!isThreadsEnabled(kernel, adapter)) return { text: THREADS_DISABLED_MSG, isError: true };
        const state = kernel.store.read();
        const scopeErr = canInspectThread(state, resolveBotByAgent(state.bots, ctx.agent), input.agentId);
        if (scopeErr) return { text: scopeErr, isError: true };
        const result = await adapter.inspectThread(ctx.paseo, input.agentId, input.limit);
        return { text: JSON.stringify(result, null, 2), structuredContent: result };
      },
    }),
  ];
}
