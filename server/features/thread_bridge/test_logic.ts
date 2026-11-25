import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import {
  defineAgentTool,
  type AgentToolContext,
  type PluginHookAgent,
  type PluginHookContext,
  type PluginHooks,
  type PluginServerContext,
  type PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createEmptyHubState,
  type BotRecord,
} from "../../../shared/contracts";
import { threadDispatchRpc, threadInspectRpc } from "../../../shared/rpc";
import type { PaseoPort } from "../../adapters/paseo-adapter";
import { ServerKernel } from "../../core/kernel";
import { createLogger } from "../../core/logger";
import { createJsonStateStore } from "../../core/store";
import { threadBridgeFeature } from "./adapter";
import {
  buildAgentOpenPatch,
  buildRolePolicy,
  recordDispatchedThread,
} from "./logic";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeBot(overrides: Partial<BotRecord>): BotRecord {
  return {
    id: "bot-1",
    name: "Bot",
    roleType: "project_lead",
    bio: "",
    personaPrompt: "",
    iconName: "Compass",
    avatarColor: "#3B66F5",
    provider: "claude/sonnet",
    defaultCwd: "/tmp/repo",
    permissionMode: "workspace",
    sectionId: null,
    pinned: false,
    agentId: null,
    archivedAt: null,
    createdAt: "2026-11-25T00:00:00Z",
    updatedAt: "2026-11-25T00:00:00Z",
    ...overrides,
  };
}

function makeTool(name: string) {
  return defineAgentTool({
    name,
    description: name,
    input: z.object({}),
    execute: () => ({ text: name }),
  });
}

function makeOpenRequest(
  metadata: PluginSessionOpenRequest["metadata"],
  tools = [
    makeTool("bot_list"),
    makeTool("inbox_capture"),
    makeTool("inbox_list"),
    makeTool("outbox_post"),
    makeTool("bot_dispatch_thread"),
    makeTool("thread_inspect"),
  ],
  appendSystemPrompt?: string[],
): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: "ws-1",
    provider: "claude/sonnet",
    cwd: "/tmp/repo",
    reason: "create",
    purpose: "interactive",
    title: "Session",
    background: false,
    labels: {},
    metadata,
    appendSystemPrompt,
    tools,
    env: {},
    mcpServers: {},
  };
}

describe("thread_bridge pure logic", () => {
  it("enforces strict companion dual-brain isolation", () => {
    const companion = makeBot({
      id: "companion",
      name: "陪伴主位",
      roleType: "companion",
      permissionMode: "readonly",
      personaPrompt: "Keep it warm.",
    });

    const policy = buildRolePolicy(companion);
    expect(policy.allowedToolNames).toEqual(["inbox_capture"]);
    const promptBlock = policy.systemPromptLines.join("\n").toLowerCase();
    expect(promptBlock).toContain("code");
    expect(promptBlock).toContain("stack trace");
    expect(promptBlock).toContain("keep it warm.");

    const patched = buildAgentOpenPatch(
      makeOpenRequest({ "paseo-bot.botId": "companion" }, [], ["Existing host instruction"]),
      [companion],
      [
        makeTool("bot_list"),
        makeTool("inbox_capture"),
        makeTool("inbox_list"),
        makeTool("outbox_post"),
        makeTool("bot_dispatch_thread"),
        makeTool("thread_inspect"),
      ],
    );

    expect(patched).toBeDefined();
    expect(patched?.tools.map((t) => t.name)).toEqual(["inbox_capture"]);
    expect(patched?.appendSystemPrompt?.[0]).toBe("Existing host instruction");
    expect(patched?.appendSystemPrompt?.some((line) => line.includes("ROLE GUARD [COMPANION]"))).toBe(true);
  });

  it("grants butler all 6 tools and project_lead only dispatch/inspect/outbox", () => {
    const butler = makeBot({ id: "butler", roleType: "butler", personaPrompt: "Steward rule" });
    const lead = makeBot({
      id: "lead-a",
      roleType: "project_lead",
      defaultCwd: "/tmp/project-a",
      personaPrompt: "Lead rule",
    });

    expect(buildRolePolicy(butler).allowedToolNames).toEqual([
      "bot_list",
      "inbox_capture",
      "inbox_list",
      "outbox_post",
      "bot_dispatch_thread",
      "thread_inspect",
    ]);
    expect(buildRolePolicy(lead).allowedToolNames).toEqual([
      "bot_dispatch_thread",
      "thread_inspect",
      "outbox_post",
    ]);

    const butlerPatch = buildAgentOpenPatch(makeOpenRequest({ "paseo-bot.botId": "butler" }), [butler, lead]);
    expect(butlerPatch?.tools.map((t) => t.name)).toEqual([
      "bot_list",
      "inbox_capture",
      "inbox_list",
      "outbox_post",
      "bot_dispatch_thread",
      "thread_inspect",
    ]);

    const leadPatch = buildAgentOpenPatch(makeOpenRequest({ "paseo-bot.botId": "lead-a" }), [butler, lead]);
    expect(leadPatch?.tools.map((t) => t.name)).toEqual([
      "outbox_post",
      "bot_dispatch_thread",
      "thread_inspect",
    ]);
    expect(leadPatch?.appendSystemPrompt?.some((line) => line.includes("/tmp/project-a"))).toBe(true);
  });

  it("ignores non-bot agents, unknown bots, and worker-thread sessions in buildAgentOpenPatch", () => {
    const butler = makeBot({ id: "butler", roleType: "butler" });
    expect(buildAgentOpenPatch(makeOpenRequest({}), [butler])).toBeUndefined();
    expect(buildAgentOpenPatch(makeOpenRequest({ "paseo-bot.botId": "missing" }), [butler])).toBeUndefined();
    expect(
      buildAgentOpenPatch(
        makeOpenRequest({ "paseo-bot.botId": "butler", "paseo-bot.kind": "worker-thread" }),
        [butler],
      ),
    ).toBeUndefined();
  });

  it("records and updates dispatched threads in state", () => {
    const empty = createEmptyHubState("2026-11-25T00:00:00Z");
    const first = recordDispatchedThread(
      empty,
      {
        agentId: "agent-worker-1",
        botId: "lead-a",
        title: "Build UI",
        cwd: "/tmp/repo",
        worktree: true,
        inboxId: "in-20261125-0001",
      },
      "2026-11-25T01:00:00Z",
    );
    expect(first.thread.status).toBe("running");
    expect(first.nextState.threads).toHaveLength(1);

    const updated = recordDispatchedThread(
      first.nextState,
      {
        agentId: "agent-worker-1",
        botId: "lead-a",
        title: "Build UI",
        cwd: "/tmp/repo",
        worktree: true,
        status: "completed",
      },
      "2026-11-25T02:00:00Z",
    );
    expect(updated.nextState.threads).toHaveLength(1);
    expect(updated.thread.createdAt).toBe("2026-11-25T01:00:00Z");
    expect(updated.thread.updatedAt).toBe("2026-11-25T02:00:00Z");
    expect(updated.thread.inboxId).toBe("in-20261125-0001");
    expect(updated.thread.status).toBe("completed");
  });
});

describe("thread_bridge adapter RPC, tools & hooks", () => {
  it("runs tools, dispatch/inspect RPCs, and permission/turn hooks via kernel events", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-thread-bridge-"));
    tempDirs.push(dir);
    const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
    const hooks = new Map<keyof PluginHooks, (payload: unknown, ctx: PluginHookContext) => Promise<unknown>>();
    const server = {
      handle(contract: { name: string }, handler: (input: unknown, ctx: unknown) => Promise<unknown>) {
        handlers.set(contract.name, handler);
      },
      addHook(name: keyof PluginHooks, fn: (payload: unknown, ctx: PluginHookContext) => Promise<unknown>) {
        hooks.set(name, fn);
        return () => {
          hooks.delete(name);
        };
      },
      registerSettings() {
        throw new Error("unused");
      },
      registerProvider() {},
      registerUsageSource() {},
      registerWorktreeManager() {
        return () => {};
      },
    } as unknown as PluginServerContext;

    const store = createJsonStateStore(dir);
    await store.update((state) => ({
      nextState: {
        ...state,
        bots: [
          makeBot({ id: "companion", roleType: "companion", permissionMode: "readonly" }),
          makeBot({ id: "butler", roleType: "butler" }),
          makeBot({ id: "lead-1", roleType: "project_lead", defaultCwd: dir }),
        ],
      },
      result: null,
    }));

    const adapter: PaseoPort = {
      async resolveDefaultWorkspaceDir() {
        return dir;
      },
      async ensureBotAgent() {
        return { agentId: "home-1", created: true };
      },
      async dispatchThread() {
        return { agentId: "worker-1" };
      },
      async inspectThread(_paseo, agentId) {
        return { agentId, status: "running", title: "Task", cwd: dir, digests: [{ role: "assistant", text: "hi" }] };
      },
    };

    const kernel = new ServerKernel({ server, store, logger: createLogger("test"), adapter });
    kernel.register(threadBridgeFeature);

    const capturedRaw: string[] = [];
    const dispatchedInbox: string[] = [];
    const outboxEvents: Array<{ kind: string; agentId?: string | null }> = [];
    kernel.events.on<{ rawText: string; ackAccepted?: () => void; resolve?: (v: unknown) => void }>(
      "inbox.capture",
      (p) => {
        p.ackAccepted?.();
        capturedRaw.push(p.rawText);
        p.resolve?.({ id: "in-20261125-0001" });
      },
    );
    kernel.events.on<{ inboxId: string; ackAccepted?: () => void; resolve?: () => void }>("inbox.markDispatched", (p) => {
      p.ackAccepted?.();
      dispatchedInbox.push(p.inboxId);
      p.resolve?.();
    });
    kernel.events.on<{ kind: string; agentId?: string | null; ackAccepted?: () => void; resolve?: (v: unknown) => void }>(
      "outbox.enqueue",
      (p) => {
        p.ackAccepted?.();
        outboxEvents.push({ kind: p.kind, agentId: p.agentId });
        p.resolve?.({ id: "out-1" });
      },
    );

    const hookCtx = { paseo: {}, signal: new AbortController().signal } as unknown as PluginHookContext;
    const companionOpen = (await hooks.get("agent.open.before")?.(
      { request: makeOpenRequest({ "paseo-bot.botId": "companion" }, []) },
      hookCtx,
    )) as PluginSessionOpenRequest;
    expect(companionOpen.tools.map((t) => t.name)).toEqual(["inbox_capture"]);

    const butlerOpen = (await hooks.get("agent.open.before")?.(
      { request: makeOpenRequest({ "paseo-bot.botId": "butler" }, []) },
      hookCtx,
    )) as PluginSessionOpenRequest;
    expect(butlerOpen.tools).toHaveLength(6);

    const toolMap = new Map(butlerOpen.tools.map((t) => [t.name, t]));
    const butlerAgent: PluginHookAgent = {
      id: "butler-home",
      workspaceId: "ws-1",
      parentAgentId: null,
      provider: "claude/sonnet",
      cwd: dir,
      title: "Butler",
      background: false,
      metadata: { "paseo-bot.botId": "butler", "paseo-bot.roleType": "butler" },
    };
    const companionAgent: PluginHookAgent = {
      ...butlerAgent,
      id: "companion-home",
      metadata: { "paseo-bot.botId": "companion", "paseo-bot.roleType": "companion" },
    };
    const toolCtx: AgentToolContext = {
      agent: butlerAgent,
      paseo: {} as unknown as PaseoApi,
      signal: new AbortController().signal,
    };

    const listRes = await toolMap.get("bot_list")!.execute({ includeArchived: false }, toolCtx);
    expect((listRes.structuredContent as { bots: unknown[] }).bots).toHaveLength(3);

    const capRes = await toolMap.get("inbox_capture")!.execute(
      { rawText: "Flash idea", tags: [] },
      { ...toolCtx, agent: companionAgent },
    );
    expect(capRes.text).toContain("in-20261125-0001");
    expect(capturedRaw).toEqual(["Flash idea"]);

    const deniedRes = await toolMap.get("bot_dispatch_thread")!.execute(
      { botId: "lead-1", title: "Hack", prompt: "go", worktree: true },
      { ...toolCtx, agent: companionAgent },
    );
    expect(deniedRes.isError).toBe(true);

    const inboxListRes = await toolMap.get("inbox_list")!.execute({ limit: 10 }, toolCtx);
    expect((inboxListRes.structuredContent as { items: unknown[] }).items).toEqual([]);

    const outPostRes = await toolMap.get("outbox_post")!.execute(
      { kind: "delivered", title: "Ready", summary: "Summary" },
      toolCtx,
    );
    expect(outPostRes.text).toContain("out-1");

    const toolDispatchRes = await toolMap.get("bot_dispatch_thread")!.execute(
      { botId: "lead-1", title: "Tool task", prompt: "Do it", worktree: false, inboxId: "in-20261125-0001" },
      toolCtx,
    );
    expect(toolDispatchRes.isError).toBeUndefined();

    const toolInspectRes = await toolMap.get("thread_inspect")!.execute({ agentId: "worker-1", limit: 5 }, toolCtx);
    expect((toolInspectRes.structuredContent as { digests: unknown[] }).digests).toHaveLength(1);

    const dispatchRes = await handlers.get(threadDispatchRpc.name)?.(
      { botId: "lead-1", title: "Fix bug", prompt: "Fix it", worktree: true, inboxId: "in-20261125-0001" },
      { paseo: {} },
    );
    expect((dispatchRes as { agentId: string }).agentId).toBe("worker-1");
    expect(dispatchedInbox).toEqual(["in-20261125-0001", "in-20261125-0001"]);
    expect(store.read().threads).toHaveLength(1);

    const inspectRes = await handlers.get(threadInspectRpc.name)?.({ agentId: "worker-1", limit: 5 }, { paseo: {} });
    expect((inspectRes as { digests: unknown[] }).digests).toHaveLength(1);

    const workerAgent: PluginHookAgent = {
      id: "worker-1",
      workspaceId: "ws-1",
      parentAgentId: null,
      provider: "claude/sonnet",
      cwd: dir,
      title: "Fix bug",
      background: false,
      metadata: { "paseo-bot.botId": "lead-1", "paseo-bot.kind": "worker-thread" },
    };

    await hooks.get("agent.permission.before")?.(
      {
        agent: workerAgent,
        request: { id: "perm-1", provider: "claude", name: "Bash", kind: "tool", title: "Run tests" },
      },
      hookCtx,
    );
    await hooks.get("agent.turn.after")?.(
      { agent: workerAgent, turnId: "t-1", outcome: { kind: "completed" } },
      hookCtx,
    );
    await hooks.get("agent.turn.after")?.(
      { agent: workerAgent, turnId: "t-2", outcome: { kind: "failed", error: { message: "Build failed" } } },
      hookCtx,
    );

    expect(outboxEvents).toEqual([
      { kind: "delivered", agentId: "butler-home" },
      { kind: "needs_decision", agentId: "worker-1" },
      { kind: "delivered", agentId: "worker-1" },
      { kind: "blocked", agentId: "worker-1" },
    ]);

    kernel.dispose();
  });
});
