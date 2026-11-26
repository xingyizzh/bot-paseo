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
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createEmptyHubState,
  ERROR_CODES,
  type BotRecord,
  type DispatchedThread,
  type OutboxAckByIdEvent,
  type OutboxItem,
  type OutboxListEvent,
} from "../../../shared/contracts";
import { outboxDigestToButlerRpc, threadDispatchRpc, threadInspectRpc } from "../../../shared/rpc";
import type { ExecutionPort } from "../../adapters/execution-port";
import { ServerKernel } from "../../core/kernel";
import { createLogger } from "../../core/logger";
import { createJsonStateStore } from "../../core/store";
import { threadBridgeFeature } from "./adapter";
import { buildOutboxDigestPrompt, buildWorkerReviewPrompt } from "./digest";
import {
  buildAgentOpenPatch,
  buildRolePolicy,
  checkToolAllowed,
  recordDispatchedThread,
  resolveOwnPluginToolName,
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
  mcpServers: PluginSessionOpenRequest["mcpServers"] = {},
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
    mcpServers,
  };
}

describe("thread_bridge pure logic", () => {
  it("enforces strict companion dual-brain isolation and clears mcpServers", () => {
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
      makeOpenRequest(
        { "paseo-bot.botId": "companion" },
        [makeTool("github_search"), makeTool("bot_list")],
        ["Existing host instruction"],
        { github: { type: "stdio", command: "npx", args: ["-y", "mcp-github"] } },
      ),
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
    expect(patched?.mcpServers).toEqual({});
    expect(patched?.appendSystemPrompt?.[0]).toBe("Existing host instruction");
    expect(patched?.appendSystemPrompt?.some((line) => line.includes("ROLE GUARD [COMPANION]"))).toBe(true);
  });

  it("grants butler all 6 tools, project_lead dispatch/inspect/outbox, and preserves third-party tools", () => {
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
      "outbox_list",
      "outbox_ack",
      "bot_dispatch_thread",
      "thread_inspect",
    ]);
    expect(buildRolePolicy(butler, false).allowedToolNames).toEqual([
      "bot_list",
      "inbox_capture",
      "inbox_list",
      "outbox_post",
      "outbox_list",
      "outbox_ack",
    ]);
    expect(buildRolePolicy(lead).allowedToolNames).toEqual([
      "bot_dispatch_thread",
      "thread_inspect",
      "outbox_post",
    ]);
    expect(buildRolePolicy(lead, false).allowedToolNames).toEqual(["outbox_post"]);

    const requestToolsWithThirdParty = [
      makeTool("third_party_search"),
      makeTool("bot_list"),
      makeTool("inbox_capture"),
      makeTool("inbox_list"),
      makeTool("outbox_post"),
      makeTool("outbox_list"),
      makeTool("outbox_ack"),
      makeTool("bot_dispatch_thread"),
      makeTool("thread_inspect"),
    ];

    const butlerPatch = buildAgentOpenPatch(
      makeOpenRequest({ "paseo-bot.botId": "butler" }, requestToolsWithThirdParty),
      [butler, lead],
    );
    expect(butlerPatch?.tools.map((t) => t.name)).toEqual([
      "third_party_search",
      "bot_list",
      "inbox_capture",
      "inbox_list",
      "outbox_post",
      "outbox_list",
      "outbox_ack",
      "bot_dispatch_thread",
      "thread_inspect",
    ]);

    const butlerDisabledPatch = buildAgentOpenPatch(
      makeOpenRequest({ "paseo-bot.botId": "butler" }, requestToolsWithThirdParty),
      [butler, lead],
      [],
      false,
    );
    expect(butlerDisabledPatch?.tools.map((t) => t.name)).toEqual([
      "third_party_search",
      "bot_list",
      "inbox_capture",
      "inbox_list",
      "outbox_post",
      "outbox_list",
      "outbox_ack",
    ]);

    const leadPatch = buildAgentOpenPatch(
      makeOpenRequest({ "paseo-bot.botId": "lead-a" }, requestToolsWithThirdParty),
      [butler, lead],
    );
    expect(leadPatch?.tools.map((t) => t.name)).toEqual([
      "third_party_search",
      "outbox_post",
      "bot_dispatch_thread",
      "thread_inspect",
    ]);
    expect(leadPatch?.appendSystemPrompt?.some((line) => line.includes("/tmp/project-a"))).toBe(true);
  });

  it("rejects outbox_list/outbox_ack for non-butler roles and thread tools when threadsEnabled is false", () => {
    const companion = makeBot({ id: "companion", roleType: "companion", permissionMode: "readonly" });
    const butler = makeBot({ id: "butler", roleType: "butler" });
    const lead = makeBot({ id: "lead-a", roleType: "project_lead" });
    const bots = [companion, butler, lead];
    const makeHookAgent = (botId: string, roleType: BotRecord["roleType"]): PluginHookAgent => ({
      id: `${botId}-home`,
      workspaceId: "ws-1",
      parentAgentId: null,
      provider: "claude/sonnet",
      cwd: "/tmp/repo",
      title: botId,
      background: false,
      metadata: { "paseo-bot.botId": botId, "paseo-bot.roleType": roleType },
    });

    expect(checkToolAllowed(bots, makeHookAgent("butler", "butler"), "outbox_list")).toBeNull();
    expect(checkToolAllowed(bots, makeHookAgent("butler", "butler"), "outbox_ack")).toBeNull();
    expect(checkToolAllowed(bots, makeHookAgent("companion", "companion"), "outbox_list")).toBeTruthy();
    expect(checkToolAllowed(bots, makeHookAgent("companion", "companion"), "outbox_ack")).toBeTruthy();
    expect(checkToolAllowed(bots, makeHookAgent("lead-a", "project_lead"), "outbox_list")).toBeTruthy();
    expect(checkToolAllowed(bots, makeHookAgent("lead-a", "project_lead"), "outbox_ack")).toBeTruthy();
    expect(checkToolAllowed(bots, makeHookAgent("butler", "butler"), "bot_dispatch_thread", false)).toContain("纯 Bot 模式");
    expect(checkToolAllowed(bots, makeHookAgent("lead-a", "project_lead"), "thread_inspect", false)).toContain("纯 Bot 模式");
  });

  it("resolves only own plugin tool names with optional mcp__paseo__ prefix", () => {
    expect(resolveOwnPluginToolName("mcp__paseo__inbox_capture")).toBe("inbox_capture");
    expect(resolveOwnPluginToolName("outbox_list")).toBe("outbox_list");
    expect(resolveOwnPluginToolName("mcp__paseo__create_agent")).toBeNull();
    expect(resolveOwnPluginToolName("Bash")).toBeNull();
  });

  it("builds grouped Muse-style outbox digest prompt with optional thread references", () => {
    const bots = [
      makeBot({ id: "butler", name: "管家总管", roleType: "butler" }),
      makeBot({ id: "lead-a", name: "后端主管", roleType: "project_lead" }),
    ];
    const threads: DispatchedThread[] = [
      {
        agentId: "worker-1",
        botId: "lead-a",
        title: "修复登录态",
        cwd: "/tmp/repo",
        worktree: true,
        inboxId: null,
        status: "completed",
        createdAt: "2026-11-25T00:00:00Z",
        updatedAt: "2026-11-25T00:00:00Z",
      },
    ];
    const items: OutboxItem[] = [
      {
        id: "out-20261125-0001",
        kind: "needs_decision",
        title: "数据库选型",
        summary: "需要确认使用 SQLite 还是 JSON。",
        status: "pending",
        botId: "lead-a",
        agentId: "worker-1",
        threadLink: "",
        inboxId: null,
        createdAt: "2026-11-25T01:00:00Z",
        ackedAt: null,
        ackNote: null,
      },
      {
        id: "out-20261125-0002",
        kind: "blocked",
        title: "缺少 API Key",
        summary: "等待配置测试环境变量。",
        status: "pending",
        botId: "lead-a",
        agentId: "worker-2",
        threadLink: "",
        inboxId: null,
        createdAt: "2026-11-25T02:00:00Z",
        ackedAt: null,
        ackNote: null,
      },
      {
        id: "out-20261125-0003",
        kind: "delivered",
        title: "登录模块完成",
        summary: "单测全部通过。",
        status: "delivered",
        botId: "lead-a",
        agentId: "worker-1",
        threadLink: "",
        inboxId: null,
        createdAt: "2026-11-25T03:00:00Z",
        ackedAt: null,
        ackNote: null,
      },
    ];

    const promptWithThreads = buildOutboxDigestPrompt(items, bots, threads, true);
    expect(promptWithThreads).toContain("[out-20261125-0001]");
    expect(promptWithThreads).toContain("后端主管");
    expect(promptWithThreads).toContain("修复登录态");
    expect(promptWithThreads).toContain("worker-2");
    expect(promptWithThreads).toContain("outbox_ack");
    expect(promptWithThreads.indexOf("needs_decision")).toBeLessThan(promptWithThreads.indexOf("blocked"));
    expect(promptWithThreads.indexOf("blocked")).toBeLessThan(promptWithThreads.indexOf("delivered"));

    const promptNoThreads = buildOutboxDigestPrompt(items, bots, threads, false);
    expect(promptNoThreads).not.toContain("修复登录态");
    expect(promptNoThreads).not.toContain("worker-2");
    expect(promptNoThreads).toContain("[out-20261125-0003]");

    const reviewPrompt = buildWorkerReviewPrompt({
      ownerBot: bots[1]!,
      threadTitle: "修复登录态",
      threadAgentId: "worker-1",
      outcomeKind: "completed",
      tailSummary: "All auth tests green",
      inboxId: "in-20261125-0001",
    });
    expect(reviewPrompt).toContain("后端主管");
    expect(reviewPrompt).toContain('thread_inspect(agentId="worker-1")');
    expect(reviewPrompt).toContain('threadAgentId="worker-1"');
    expect(reviewPrompt).toContain('inboxId="in-20261125-0001"');
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
  it("runs tools, scoped thread_inspect, dispatch/inspect RPCs, and permission/turn hooks", async () => {
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
          makeBot({ id: "lead-1", roleType: "project_lead", defaultCwd: dir, agentId: "lead-1-home" }),
          makeBot({ id: "lead-2", roleType: "project_lead", defaultCwd: dir, agentId: "lead-2-home" }),
        ],
        threads: [
          {
            agentId: "other-worker",
            botId: "lead-2",
            title: "Other lead task",
            cwd: dir,
            worktree: false,
            inboxId: null,
            status: "running",
            createdAt: "2026-11-25T00:00:00Z",
            updatedAt: "2026-11-25T00:00:00Z",
          },
        ],
      },
      result: null,
    }));

    const ensuredCalls: Array<{ botId: string; prompt: string }> = [];
    const adapter: ExecutionPort = {
      kind: "paseo",
      capabilities: { threads: true, worktree: true, inspect: true },
      async resolveDefaultWorkspaceDir() {
        return dir;
      },
      async ensureBotAgent(_paseo, bot, initialPrompt) {
        if (initialPrompt) ensuredCalls.push({ botId: bot.id, prompt: initialPrompt });
        return { agentId: `${bot.id}-home`, created: true };
      },
      async reloadBotAgent() {},
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
    const ackedByAgent: Array<{ agentId: string; kind?: string; note?: string }> = [];
    const ackedByIds: Array<{ id: string; note?: string }> = [];
    const sampleOutbox: OutboxItem = {
      id: "out-sample-1",
      kind: "delivered",
      title: "Done",
      summary: "Summary",
      status: "delivered",
      botId: "lead-1",
      agentId: "worker-1",
      threadLink: "",
      inboxId: null,
      createdAt: "2026-11-25T00:00:00Z",
      ackedAt: null,
      ackNote: null,
    };
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
    kernel.events.on<{ agentId: string; kind?: string; note?: string; ackAccepted?: () => void; resolve?: (n: number) => void }>(
      "outbox.ackByAgent",
      (p) => {
        p.ackAccepted?.();
        ackedByAgent.push({ agentId: p.agentId, kind: p.kind, note: p.note });
        p.resolve?.(1);
      },
    );
    kernel.events.on<OutboxListEvent>("outbox.list", (p) => {
      p.ackAccepted?.();
      p.resolve?.([sampleOutbox]);
    });
    kernel.events.on<OutboxAckByIdEvent>("outbox.ack", (p) => {
      p.ackAccepted?.();
      ackedByIds.push({ id: p.id, note: p.note });
      p.resolve?.({ ...sampleOutbox, status: "acked", ackedAt: "2026-11-25T01:00:00Z", ackNote: p.note ?? null });
    });

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
    expect(butlerOpen.tools).toHaveLength(8);

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
    const lead1Agent: PluginHookAgent = {
      ...butlerAgent,
      id: "lead-1-home",
      metadata: { "paseo-bot.botId": "lead-1", "paseo-bot.roleType": "project_lead" },
    };
    const toolCtx: AgentToolContext = {
      agent: butlerAgent,
      paseo: {} as unknown as PaseoApi,
      signal: new AbortController().signal,
    };

    const listRes = await toolMap.get("bot_list")!.execute({ includeArchived: false }, toolCtx);
    expect((listRes.structuredContent as { bots: unknown[] }).bots).toHaveLength(4);

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

    // Butler can inspect any thread; lead-1 can inspect worker-1 (owned) and itself, but NOT other-worker.
    const toolInspectRes = await toolMap.get("thread_inspect")!.execute({ agentId: "other-worker", limit: 5 }, toolCtx);
    expect((toolInspectRes.structuredContent as { digests: unknown[] }).digests).toHaveLength(1);

    const leadInspectOwn = await toolMap.get("thread_inspect")!.execute(
      { agentId: "worker-1", limit: 5 },
      { ...toolCtx, agent: lead1Agent },
    );
    expect(leadInspectOwn.isError).toBeUndefined();

    const leadInspectOther = await toolMap.get("thread_inspect")!.execute(
      { agentId: "other-worker", limit: 5 },
      { ...toolCtx, agent: lead1Agent },
    );
    expect(leadInspectOther.isError).toBe(true);

    const dispatchRes = await handlers.get(threadDispatchRpc.name)?.(
      { botId: "lead-1", title: "Fix bug", prompt: "Fix it", worktree: true, inboxId: "in-20261125-0001" },
      { paseo: {} },
    );
    expect((dispatchRes as { agentId: string }).agentId).toBe("worker-1");
    expect(dispatchedInbox).toEqual(["in-20261125-0001", "in-20261125-0001"]);
    expect(store.read().threads).toHaveLength(2);

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
    const butlerWorkerAgent: PluginHookAgent = {
      ...workerAgent,
      id: "butler-worker-1",
      title: "Direct butler check",
      metadata: { "paseo-bot.botId": "butler", "paseo-bot.kind": "worker-thread" },
    };

    await hooks.get("agent.permission.before")?.(
      {
        agent: workerAgent,
        request: { id: "perm-1", provider: "claude", name: "Bash", kind: "tool", title: "Run tests" },
      },
      hookCtx,
    );
    await hooks.get("agent.permission.after")?.(
      {
        agent: workerAgent,
        requestId: "perm-1",
        resolution: { behavior: "allow" },
      },
      hookCtx,
    );
    // Project-lead owned worker completion/failure routes to owner Bot QA, NOT directly to Outbox
    await hooks.get("agent.turn.after")?.(
      { agent: workerAgent, turnId: "t-1", outcome: { kind: "completed" } },
      hookCtx,
    );
    await hooks.get("agent.turn.after")?.(
      { agent: workerAgent, turnId: "t-2", outcome: { kind: "failed", error: { message: "Build failed" } } },
      hookCtx,
    );
    expect(ensuredCalls.filter((c) => c.botId === "lead-1")).toHaveLength(2);
    expect(ensuredCalls[0]?.prompt).toContain('thread_inspect(agentId="worker-1")');

    // Lead inspects and formally escalates verified result via outbox_post(threadAgentId)
    const leadPostOwn = await toolMap.get("outbox_post")!.execute(
      { kind: "delivered", title: "QA verified", summary: "Checked all tests", threadAgentId: "worker-1" },
      { ...toolCtx, agent: lead1Agent },
    );
    expect(leadPostOwn.isError).toBeUndefined();
    const leadPostForeign = await toolMap.get("outbox_post")!.execute(
      { kind: "delivered", title: "Cross-lead", summary: "Should block", threadAgentId: "other-worker" },
      { ...toolCtx, agent: lead1Agent },
    );
    expect(leadPostForeign.isError).toBe(true);

    // Direct butler-owned worker still reports straight to Outbox
    await hooks.get("agent.turn.after")?.(
      { agent: butlerWorkerAgent, turnId: "t-3", outcome: { kind: "failed", error: { message: "Lint failed" } } },
      hookCtx,
    );
    // Failed project_lead bot-home QA turn also escalates to Outbox as blocked so errors are not swallowed
    await hooks.get("agent.turn.after")?.(
      { agent: { ...lead1Agent, metadata: { "paseo-bot.botId": "lead-1", "paseo-bot.kind": "bot-home", "paseo-bot.roleType": "project_lead" } }, turnId: "t-4", outcome: { kind: "failed", error: { message: "QA provider timeout" } } },
      hookCtx,
    );

    expect(ackedByAgent).toEqual([{ agentId: "worker-1", kind: "needs_decision", note: "Resolved in Paseo" }]);
    expect(outboxEvents).toEqual([
      { kind: "delivered", agentId: "butler-home" },
      { kind: "needs_decision", agentId: "worker-1" },
      { kind: "delivered", agentId: "worker-1" },
      { kind: "blocked", agentId: "butler-worker-1" },
      { kind: "blocked", agentId: "lead-1-home" },
    ]);

    const outListRes = await toolMap.get("outbox_list")!.execute({ includeAcked: false, limit: 10 }, toolCtx);
    expect((outListRes.structuredContent as { items: OutboxItem[] }).items).toHaveLength(1);
    const outAckRes = await toolMap.get("outbox_ack")!.execute({ id: "out-sample-1", note: "User notified" }, toolCtx);
    expect(outAckRes.isError).toBeUndefined();
    expect(ackedByIds).toEqual([{ id: "out-sample-1", note: "User notified" }]);

    const leadOutListDenied = await toolMap.get("outbox_list")!.execute(
      { includeAcked: false, limit: 10 },
      { ...toolCtx, agent: lead1Agent },
    );
    expect(leadOutListDenied.isError).toBe(true);

    // outboxDigestToButlerRpc validation & happy path
    await expect(handlers.get(outboxDigestToButlerRpc.name)?.({}, { paseo: {} })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION,
    });

    await store.update((s) => ({
      nextState: { ...s, outbox: [sampleOutbox] },
      result: null,
    }));
    await expect(
      handlers.get(outboxDigestToButlerRpc.name)?.({ botId: "companion" }, { paseo: {} }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    await expect(
      handlers.get(outboxDigestToButlerRpc.name)?.({ botId: "missing-bot" }, { paseo: {} }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });

    const digestResult = (await handlers.get(outboxDigestToButlerRpc.name)?.({}, { paseo: {} })) as {
      agentId: string;
      botId: string;
      itemCount: number;
      promptPreview: string;
    };
    expect(digestResult).toMatchObject({ agentId: "butler-home", botId: "butler", itemCount: 1 });
    expect(ensuredCalls.filter((c) => c.botId === "butler")).toHaveLength(1);
    expect(store.read().bots.find((b) => b.id === "butler")?.agentId).toBe("butler-home");

    // Disable Paseo thread backend -> blocks dispatch/inspect RPCs and strips thread tools
    await store.update((s) => ({
      nextState: { ...s, settings: { paseoEnabled: false } },
      result: null,
    }));
    const butlerPureOpen = (await hooks.get("agent.open.before")?.(
      { request: makeOpenRequest({ "paseo-bot.botId": "butler" }, []) },
      hookCtx,
    )) as PluginSessionOpenRequest;
    expect(butlerPureOpen.tools.map((t) => t.name)).not.toContain("bot_dispatch_thread");
    expect(butlerPureOpen.tools.map((t) => t.name)).not.toContain("thread_inspect");

    await expect(
      handlers.get(threadDispatchRpc.name)?.(
        { botId: "lead-1", title: "Blocked", prompt: "go", worktree: false },
        { paseo: {} },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    await expect(
      handlers.get(threadInspectRpc.name)?.({ agentId: "worker-1", limit: 5 }, { paseo: {} }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });

    const disabledToolDispatch = await toolMap.get("bot_dispatch_thread")!.execute(
      { botId: "lead-1", title: "Blocked", prompt: "go", worktree: false },
      toolCtx,
    );
    expect(disabledToolDispatch.isError).toBe(true);
    const disabledToolInspect = await toolMap.get("thread_inspect")!.execute(
      { agentId: "worker-1", limit: 5 },
      toolCtx,
    );
    expect(disabledToolInspect.isError).toBe(true);

    // Auto-approve / auto-deny own plugin MCP tools in agent.permission.before without Outbox noise
    const outboxCountBeforeAuto = outboxEvents.length;
    const permResponses: Array<{ agentId: string; options: unknown }> = [];
    const permHookCtx = {
      paseo: {
        agents: {
          ref(agentId: string) {
            return {
              respondToPermission: vi.fn(async (options: unknown) => {
                permResponses.push({ agentId, options });
              }),
            };
          },
        },
      },
      signal: new AbortController().signal,
    } as unknown as PluginHookContext;
    const compPermAgent: PluginHookAgent = {
      id: "comp-home",
      workspaceId: "ws-1",
      parentAgentId: null,
      provider: "claude/sonnet",
      cwd: dir,
      title: "Companion",
      background: false,
      metadata: { "paseo-bot.botId": "companion", "paseo-bot.roleType": "companion" },
    };

    await hooks.get("agent.permission.before")?.(
      {
        agent: compPermAgent,
        request: {
          id: "perm-comp-1",
          provider: "claude",
          name: "mcp__paseo__inbox_capture",
          kind: "tool",
          title: "Capture idea",
          input: { text: "hello" },
        },
      },
      permHookCtx,
    );
    expect(permResponses[0]).toEqual({
      agentId: "comp-home",
      options: {
        requestId: "perm-comp-1",
        response: { behavior: "allow", updatedInput: { text: "hello" } },
      },
    });
    expect(outboxEvents).toHaveLength(outboxCountBeforeAuto);

    await hooks.get("agent.permission.before")?.(
      {
        agent: compPermAgent,
        request: { id: "perm-comp-2", provider: "claude", name: "mcp__paseo__outbox_list", kind: "tool", title: "List outbox" },
      },
      permHookCtx,
    );
    expect(permResponses[1]).toMatchObject({
      agentId: "comp-home",
      options: {
        requestId: "perm-comp-2",
        response: { behavior: "deny" },
      },
    });
    expect(outboxEvents).toHaveLength(outboxCountBeforeAuto);

    await hooks.get("agent.permission.before")?.(
      {
        agent: workerAgent,
        request: { id: "perm-bash-2", provider: "claude", name: "Bash", kind: "tool", title: "Run tests" },
      },
      permHookCtx,
    );
    expect(permResponses).toHaveLength(2);
    expect(outboxEvents).toHaveLength(outboxCountBeforeAuto + 1);
    expect(outboxEvents[outboxEvents.length - 1]).toEqual({ kind: "needs_decision", agentId: "worker-1" });

    kernel.dispose();
  });
});
