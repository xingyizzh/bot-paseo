import type { PluginHookContext } from "@getpaseo/plugin/server";
import {
  DomainError,
  ERROR_CODES,
  filterOutboxItems,
  type OutboxAckByAgentEvent,
  type OutboxEnqueueEvent,
  type OutboxItem,
} from "../../../shared/contracts";
import { outboxDigestToButlerRpc, threadDispatchRpc, threadInspectRpc } from "../../../shared/rpc";
import type { ExecutionPort } from "../../adapters/execution-port";
import type { FeatureManifest, ServerFeature, ServerKernel } from "../../core/kernel";
import { buildOutboxDigestPrompt, buildWorkerReviewPrompt } from "./digest";
import {
  buildAgentOpenPatch,
  buildPermissionOutboxPayload,
  buildTurnOutboxPayload,
  checkToolAllowed,
  resolveOwnPluginToolName,
  updateDispatchedThreadStatus,
} from "./logic";
import {
  buildBridgeTools,
  executeDispatch,
  isThreadsEnabled,
  THREAD_BRIDGE_ID,
  THREADS_DISABLED_MSG,
} from "./tools";

export const THREAD_BRIDGE_MANIFEST: FeatureManifest = {
  id: THREAD_BRIDGE_ID,
  name: "Thread Bridge & Role Guard",
};

async function bindBotAgentIfChanged(
  kernel: ServerKernel,
  featureId: string,
  botId: string,
  nextAgentId: string,
  currentAgentId: string | null,
): Promise<void> {
  if (nextAgentId === currentAgentId) return;
  const now = new Date().toISOString();
  await kernel.commitState(featureId, (latest) => ({
    nextState: {
      ...latest,
      bots: latest.bots.map((b) => (b.id === botId ? { ...b, agentId: nextAgentId, updatedAt: now } : b)),
    },
    result: null,
  }));
}

async function readTurnCompletionSummary(
  ctx: PluginHookContext,
  agentId: string,
  turnId: string | null,
  fallback: string,
): Promise<string> {
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
    const adapter = kernel.adapter as ExecutionPort;
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

    kernel.handleRpc(id, threadInspectRpc, (input, ctx) => {
      if (!isThreadsEnabled(kernel, adapter)) {
        throw new DomainError(id, "inspectThread", ERROR_CODES.PERMISSION_DENIED, THREADS_DISABLED_MSG);
      }
      return adapter.inspectThread(ctx.paseo, input.agentId, input.limit);
    });

    kernel.handleRpc(id, outboxDigestToButlerRpc, async (input, ctx) => {
      const state = kernel.store.read();
      const butler = input.botId
        ? state.bots.find((b) => b.id === input.botId)
        : state.bots.find((b) => b.roleType === "butler" && b.archivedAt === null);
      if (!butler) {
        throw new DomainError(id, "digestToButler", ERROR_CODES.NOT_FOUND, input.botId ? `Bot not found: ${input.botId}` : "No active butler bot found");
      }
      if (butler.archivedAt !== null) {
        throw new DomainError(id, "digestToButler", ERROR_CODES.PERMISSION_DENIED, `Cannot digest outbox to archived bot: ${butler.id}`);
      }
      if (butler.roleType === "companion") {
        throw new DomainError(id, "digestToButler", ERROR_CODES.PERMISSION_DENIED, "Companion bots cannot receive outbox digests");
      }

      const unacked = filterOutboxItems(state.outbox, { includeAcked: false, limit: 30 });
      if (unacked.length === 0) {
        throw new DomainError(id, "digestToButler", ERROR_CODES.VALIDATION, "当前没有未汇报的 Outbox 条目");
      }

      const prompt = buildOutboxDigestPrompt(unacked, state.bots, state.threads, isThreadsEnabled(kernel, adapter));
      const ensured = await adapter.ensureBotAgent(ctx.paseo, butler, prompt);
      await bindBotAgentIfChanged(kernel, id, butler.id, ensured.agentId, butler.agentId);
      return {
        agentId: ensured.agentId,
        botId: butler.id,
        itemCount: unacked.length,
        promptPreview: prompt.slice(0, 200),
      };
    });

    const offOpen = kernel.addHook("agent.open.before", async (payload) =>
      buildAgentOpenPatch(payload.request, kernel.store.read().bots, tools, isThreadsEnabled(kernel, adapter)),
    );
    const offPerm = kernel.addHook("agent.permission.before", async (payload, ctx) => {
      const ownTool = resolveOwnPluginToolName(payload.request.name);
      if (ownTool && ctx.paseo?.agents?.ref) {
        const denied = checkToolAllowed(
          kernel.store.read().bots,
          payload.agent,
          ownTool,
          isThreadsEnabled(kernel, adapter),
        );
        try {
          await ctx.paseo.agents.ref(payload.agent.id).respondToPermission({
            requestId: payload.request.id,
            response:
              denied === null
                ? {
                    behavior: "allow",
                    ...(payload.request.input && typeof payload.request.input === "object"
                      ? { updatedInput: payload.request.input as Record<string, unknown> }
                      : {}),
                  }
                : { behavior: "deny", message: denied },
          });
          return;
        } catch (err) {
          kernel.logger.warn(
            "thread_bridge",
            "agent.permission.before",
            `Auto permission response failed for ${payload.agent.id} (${ownTool}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
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
      const kind = payload.agent.metadata?.["paseo-bot.kind"];
      if (
        kind === "bot-home" &&
        payload.agent.metadata?.["paseo-bot.roleType"] === "project_lead" &&
        payload.outcome.kind === "failed"
      ) {
        const metaId = payload.agent.metadata?.["paseo-bot.botId"];
        const botId = typeof metaId === "string" && metaId ? metaId : null;
        const botName =
          (botId ? kernel.store.read().bots.find((b) => b.id === botId)?.name : null) ||
          payload.agent.title?.trim() ||
          botId ||
          "项目主管";
        const errText = payload.outcome.error.message?.trim() || `Project lead "${botName}" failed its turn.`;
        await kernel.events.emitWithAck<OutboxItem, OutboxEnqueueEvent>("outbox.enqueue", {
          kind: "blocked",
          title: `项目主管异常: ${botName}`.slice(0, 120),
          summary: errText.slice(0, 2000),
          status: "pending",
          botId,
          agentId: payload.agent.id,
          threadLink: "",
          inboxId: null,
        });
        return;
      }
      if (kind !== "worker-thread") return;
      if (payload.outcome.kind !== "completed" && payload.outcome.kind !== "failed") return;
      const latestState = kernel.store.read();
      const matched = latestState.threads.find((entry) => entry.agentId === payload.agent.id);
      const threadTitle = payload.agent.title?.trim() || matched?.title || payload.agent.id;
      await kernel.commitState(id, (state) => ({
        nextState: updateDispatchedThreadStatus(state, payload.agent.id, payload.outcome.kind),
        result: null,
      }));
      const tailSummary = payload.outcome.kind === "completed"
        ? await readTurnCompletionSummary(ctx, payload.agent.id, payload.turnId, `Worker thread "${threadTitle}" completed its turn.`)
        : (payload.outcome.error.message?.trim() || `Worker thread "${threadTitle}" failed.`);

      const metaBotId = payload.agent.metadata?.["paseo-bot.botId"];
      const ownerBotId = typeof metaBotId === "string" && metaBotId ? metaBotId : matched?.botId;
      const ownerBot = ownerBotId ? kernel.store.read().bots.find((b) => b.id === ownerBotId) : undefined;
      if (ownerBot && ownerBot.roleType === "project_lead" && ownerBot.archivedAt === null) {
        try {
          const reviewPrompt = buildWorkerReviewPrompt({
            ownerBot,
            threadTitle,
            threadAgentId: payload.agent.id,
            outcomeKind: payload.outcome.kind,
            tailSummary,
            inboxId: matched?.inboxId ?? null,
          });
          const ensured = await adapter.ensureBotAgent(ctx.paseo, ownerBot, reviewPrompt);
          await bindBotAgentIfChanged(kernel, id, ownerBot.id, ensured.agentId, ownerBot.agentId);
          return;
        } catch (err) {
          kernel.logger.warn(id, "turnAfter.notifyOwner", `Falling back to direct Outbox: ${String(err)}`);
        }
      }

      const outbox = buildTurnOutboxPayload(payload.agent, payload.outcome, threadTitle, matched?.inboxId ?? null, tailSummary);
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
