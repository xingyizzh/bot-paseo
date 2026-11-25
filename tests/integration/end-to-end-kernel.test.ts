import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type {
  AgentToolContext,
  PluginHookContext,
  PluginHooks,
  PluginHookPayload,
  PluginServerContext,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
import contributeServer from "../../index.server";
import {
  DomainError,
  ERROR_CODES,
  type BotHubSnapshot,
  type HubSettings,
} from "../../shared/contracts";
import {
  botOpenSessionRpc,
  botSnapshotRpc,
  botUpsertRpc,
  hubSubscribe,
  inboxAddRpc,
  outboxDigestToButlerRpc,
  settingsUpdateRpc,
  threadDispatchRpc,
  threadInspectRpc,
} from "../../shared/rpc";

const tempDirs: string[] = [];
const prevDataDir = process.env.PASEO_BOT_DATA_DIR;

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.PASEO_BOT_DATA_DIR;
  else process.env.PASEO_BOT_DATA_DIR = prevDataDir;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createHarness() {
  const rpcs = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
  const subs = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown> | void>();
  const hooks = new Map<string, ((payload: unknown, ctx: PluginHookContext) => Promise<unknown>)[]>();

  const server = {
    handle(contract: { name: string }, handler: (input: unknown, ctx: unknown) => Promise<unknown>) {
      if (contract.name === hubSubscribe.name) subs.set(contract.name, handler);
      else rpcs.set(contract.name, handler);
    },
    addHook(name: keyof PluginHooks, fn: (payload: unknown, ctx: PluginHookContext) => Promise<unknown>) {
      const list = hooks.get(name) ?? [];
      list.push(fn);
      hooks.set(name, list);
      return () => {
        const next = (hooks.get(name) ?? []).filter((entry) => entry !== fn);
        if (next.length === 0) hooks.delete(name);
        else hooks.set(name, next);
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

  const createdAgents: { id: string; cwd: string; prompt?: string; metadata?: Record<string, unknown> }[] = [];
  let seq = 0;

  const paseo = {
    projects: {
      async list() {
        return { projects: [{ projectRootPath: "/tmp/default-workspace" }] };
      },
    },
    providers: {
      async snapshot() {
        return {
          entries: [{ provider: "claude", enabled: true, status: "ready", models: [{ id: "sonnet" }] }],
        };
      },
      async listModes() {
        return {
          modes: [
            { id: "plan", label: "Plan" },
            { id: "acceptEdits", label: "Accept Edits" },
            { id: "bypassPermissions", label: "Bypass" },
          ],
        };
      },
    },
    agents: {
      async list() {
        return { entries: [] };
      },
      async create(opts: { cwd: string; prompt?: string; metadata?: Record<string, unknown> }) {
        seq += 1;
        const created = { id: `agent-${seq}`, cwd: opts.cwd, prompt: opts.prompt, metadata: opts.metadata };
        createdAgents.push(created);
        return created;
      },
      ref(agentId: string) {
        return {
          async refresh() {
            return { agent: { id: agentId, archivedAt: null } };
          },
          async reload() {
            return { agent: { id: agentId, archivedAt: null } };
          },
          async send() {},
          timeline: {
            async refetch() {
              return {
                agent: { id: agentId, status: "idle", title: "Worker", cwd: "/tmp/default-workspace" },
                entries: [
                  { item: { type: "assistant_message", text: "Worker finished cleanly with all checks green." } },
                ],
              };
            },
          },
        };
      },
    },
  } as unknown as PaseoApi;

  const invokeRpc = (name: string, input: unknown) => {
    const fn = rpcs.get(name);
    if (!fn) throw new Error(`Missing RPC handler: ${name}`);
    return fn(input, { paseo });
  };

  const emitHook = async <Name extends keyof PluginHooks>(name: Name, payload: PluginHookPayload<Name>) => {
    const list = hooks.get(name) ?? [];
    let last: unknown;
    for (const fn of list) {
      last = await fn(payload, { paseo, signal: new AbortController().signal });
    }
    return last;
  };

  const subscribeHub = () => {
    const fn = subs.get(hubSubscribe.name);
    if (!fn) throw new Error("Missing hub subscription handler");
    const controller = new AbortController();
    const snapshots: BotHubSnapshot[] = [];
    const done = Promise.resolve(
      fn(
        {},
        {
          paseo,
          signal: controller.signal,
          async push(event: BotHubSnapshot) {
            snapshots.push(event);
          },
        },
      ),
    );
    return { snapshots, abort: () => controller.abort(), done };
  };

  return { server, hooks, paseo, createdAgents, invokeRpc, emitHook, subscribeHub };
}

describe("end-to-end server plugin kernel", () => {
  it("coordinates all four decoupled features through EventBus, hooks, and cleanup", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-bot-e2e-"));
    tempDirs.push(dataDir);
    process.env.PASEO_BOT_DATA_DIR = dataDir;

    const h = createHarness();
    const dispose = contributeServer(h.server);

    const initial = (await h.invokeRpc(botSnapshotRpc.name, {})) as BotHubSnapshot;
    expect(initial.revision).toBe(1);
    expect(initial.bots.map((b) => b.id)).toEqual(["butler", "companion"]);

    const sub = h.subscribeHub();
    expect(sub.snapshots.length).toBe(1);

    const lead = (await h.invokeRpc(botUpsertRpc.name, {
      name: "Project Lead",
      roleType: "project_lead",
      bio: "Owns runtime workspace",
      personaPrompt: "",
      provider: "claude/sonnet",
      defaultCwd: "",
      permissionMode: "workspace",
      sectionId: null,
      pinned: false,
    })) as { id: string; defaultCwd: string };
    expect(lead.defaultCwd).toBe("/tmp/default-workspace");

    await expect(
      h.invokeRpc(botUpsertRpc.name, {
        id: "companion",
        name: "陪伴主位",
        roleType: "companion",
        bio: "",
        personaPrompt: "",
        provider: "claude/sonnet",
        defaultCwd: "",
        permissionMode: "full",
        sectionId: null,
        pinned: true,
      }),
    ).rejects.toThrow(DomainError);

    try {
      await h.invokeRpc(botUpsertRpc.name, {
        name: "Rogue Companion",
        roleType: "companion",
        bio: "",
        personaPrompt: "",
        provider: "claude/sonnet",
        defaultCwd: "",
        permissionMode: "full",
        sectionId: null,
        pinned: false,
      });
    } catch (err) {
      expect((err as DomainError).code).toBe(ERROR_CODES.PERMISSION_DENIED);
    }

    const inbox = (await h.invokeRpc(inboxAddRpc.name, {
      rawText: "Keep original user thought intact across dispatch",
      source: "user",
      tags: ["idea"],
    })) as { id: string; rawText: string };

    const dispatched = (await h.invokeRpc(threadDispatchRpc.name, {
      botId: lead.id,
      title: "Build Feature",
      prompt: "Implement feature",
      worktree: false,
      inboxId: inbox.id,
    })) as { agentId: string; thread: { botId: string } };
    expect(dispatched.thread.botId).toBe(lead.id);

    const companionPatch = (await h.emitHook("agent.open.before", {
      request: {
        agentId: "comp-agent",
        workspaceId: null,
        provider: "claude/sonnet",
        cwd: "/tmp/default-workspace",
        reason: "create",
        purpose: "interactive",
        title: "陪伴主位",
        background: false,
        labels: {},
        metadata: { "paseo-bot.botId": "companion" },
        tools: [],
        env: {},
        mcpServers: {},
      } satisfies PluginSessionOpenRequest,
    })) as PluginSessionOpenRequest;
    expect(companionPatch.tools.map((t) => t.name)).toEqual(["inbox_capture"]);
    expect(companionPatch.mcpServers).toEqual({});

    const butlerPatch = (await h.emitHook("agent.open.before", {
      request: {
        agentId: "butler-agent",
        workspaceId: null,
        provider: "claude/sonnet",
        cwd: "/tmp/default-workspace",
        reason: "create",
        purpose: "interactive",
        title: "管家总管",
        background: false,
        labels: {},
        metadata: { "paseo-bot.botId": "butler" },
        tools: [],
        env: {},
        mcpServers: {},
      } satisfies PluginSessionOpenRequest,
    })) as PluginSessionOpenRequest;
    expect(butlerPatch.tools.map((t) => t.name).sort()).toEqual([
      "bot_dispatch_thread",
      "bot_list",
      "inbox_capture",
      "inbox_list",
      "outbox_ack",
      "outbox_list",
      "outbox_post",
      "thread_inspect",
    ]);

    const workerHookAgent = {
      id: dispatched.agentId,
      workspaceId: "ws-1",
      parentAgentId: null,
      provider: "claude/sonnet",
      cwd: "/tmp/default-workspace",
      title: "Build Feature",
      background: false,
      metadata: { "paseo-bot.botId": lead.id, "paseo-bot.kind": "worker-thread" },
    };

    await h.emitHook("agent.permission.before", {
      agent: workerHookAgent,
      request: {
        id: "perm-1",
        provider: "claude",
        name: "Bash",
        kind: "tool",
        title: "Run tests",
      },
    });

    await h.emitHook("agent.permission.after", {
      agent: workerHookAgent,
      requestId: "perm-1",
      resolution: { behavior: "allow" },
    });

    await h.emitHook("agent.turn.after", {
      agent: workerHookAgent,
      turnId: "turn-1",
      outcome: { kind: "completed" },
    });

    // Sub-bot QA gate: worker turn.after wakes the owning project_lead instead of bypassing straight into Outbox
    const leadHomeAgent = h.createdAgents.find((a) => a.metadata?.["paseo-bot.botId"] === lead.id && a.metadata?.["paseo-bot.kind"] === "bot-home");
    expect(leadHomeAgent).toBeDefined();
    expect(leadHomeAgent?.prompt).toContain(dispatched.agentId);

    const beforeQaSnap = (await h.invokeRpc(botSnapshotRpc.name, {})) as BotHubSnapshot;
    expect(beforeQaSnap.outbox.some((item) => item.kind === "delivered")).toBe(false);

    // Owner project_lead inspects worker and formally escalates via outbox_post(threadAgentId)
    const leadPatch = (await h.emitHook("agent.open.before", {
      request: {
        agentId: leadHomeAgent!.id,
        workspaceId: null,
        provider: "claude/sonnet",
        cwd: "/tmp/default-workspace",
        reason: "create",
        purpose: "interactive",
        title: "Project Lead",
        background: false,
        labels: {},
        metadata: { "paseo-bot.botId": lead.id },
        tools: [],
        env: {},
        mcpServers: {},
      } satisfies PluginSessionOpenRequest,
    })) as PluginSessionOpenRequest;
    const leadToolMap = new Map(leadPatch.tools.map((t) => [t.name, t]));
    const leadToolCtx: AgentToolContext = {
      agent: {
        id: leadHomeAgent!.id,
        workspaceId: "ws-1",
        parentAgentId: null,
        provider: "claude/sonnet",
        cwd: "/tmp/default-workspace",
        title: "Project Lead",
        background: false,
        metadata: { "paseo-bot.botId": lead.id, "paseo-bot.roleType": "project_lead" },
      },
      paseo: h.paseo,
      signal: new AbortController().signal,
    };
    const leadInspectRes = await leadToolMap.get("thread_inspect")!.execute({ agentId: dispatched.agentId, limit: 5 }, leadToolCtx);
    expect(leadInspectRes.isError).toBeUndefined();
    const leadPostRes = await leadToolMap.get("outbox_post")!.execute(
      {
        kind: "delivered",
        title: "Feature verified",
        summary: "Reviewed worker output and tests passed",
        threadAgentId: dispatched.agentId,
        inboxId: inbox.id,
      },
      leadToolCtx,
    );
    expect(leadPostRes.isError).toBeUndefined();

    const latest = (await h.invokeRpc(botSnapshotRpc.name, {})) as BotHubSnapshot;
    const updatedInbox = latest.inbox.find((item) => item.id === inbox.id);
    expect(updatedInbox?.status).toBe("dispatched");
    expect(updatedInbox?.rawText).toBe("Keep original user thought intact across dispatch");
    const permOutbox = latest.outbox.find((item) => item.kind === "needs_decision" && item.inboxId === inbox.id);
    expect(permOutbox?.status).toBe("acked");
    expect(permOutbox?.ackNote).toBe("Resolved in Paseo");
    const deliveredOutbox = latest.outbox.find((item) => item.kind === "delivered" && item.inboxId === inbox.id);
    expect(deliveredOutbox).toBeDefined();
    expect(deliveredOutbox?.agentId).toBe(dispatched.agentId);

    // Digest outbox to butler -> butler uses outbox_list and outbox_ack
    const digestRes = (await h.invokeRpc(outboxDigestToButlerRpc.name, {})) as {
      agentId: string;
      botId: string;
      itemCount: number;
      promptPreview: string;
    };
    expect(digestRes.botId).toBe("butler");
    expect(digestRes.itemCount).toBe(1);
    expect(digestRes.promptPreview).toContain(deliveredOutbox!.id);

    const butlerToolMap = new Map(butlerPatch.tools.map((t) => [t.name, t]));
    const butlerToolCtx: AgentToolContext = {
      agent: {
        id: digestRes.agentId,
        workspaceId: "ws-1",
        parentAgentId: null,
        provider: "claude/sonnet",
        cwd: "/tmp/default-workspace",
        title: "管家总管",
        background: false,
        metadata: { "paseo-bot.botId": "butler", "paseo-bot.roleType": "butler" },
      },
      paseo: {} as unknown as PaseoApi,
      signal: new AbortController().signal,
    };

    const outboxListRes = await butlerToolMap.get("outbox_list")!.execute({ includeAcked: false, limit: 20 }, butlerToolCtx);
    expect((outboxListRes.structuredContent as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([
      deliveredOutbox!.id,
    ]);

    const outboxAckRes = await butlerToolMap.get("outbox_ack")!.execute(
      { id: deliveredOutbox!.id, note: "Summarized to user" },
      butlerToolCtx,
    );
    expect(outboxAckRes.isError).toBeUndefined();

    // Runtime toggle: disable Paseo thread backend -> blocks dispatch/inspect, keeps bot sessions/inbox/outbox/digest alive
    const offSettings = (await h.invokeRpc(settingsUpdateRpc.name, { paseoEnabled: false })) as HubSettings;
    expect(offSettings.paseoEnabled).toBe(false);

    await expect(
      h.invokeRpc(threadDispatchRpc.name, {
        botId: lead.id,
        title: "Blocked dispatch",
        prompt: "Should reject",
        worktree: false,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });

    await expect(
      h.invokeRpc(threadInspectRpc.name, { agentId: dispatched.agentId, limit: 5 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });

    const pureBotSession = (await h.invokeRpc(botOpenSessionRpc.name, { botId: "companion" })) as { agentId: string };
    expect(pureBotSession.agentId).toBeTruthy();

    const pureBotInbox = (await h.invokeRpc(inboxAddRpc.name, {
      rawText: "Thought captured in pure Bot mode",
      source: "user",
      tags: [],
    })) as { id: string };
    expect(pureBotInbox.id).toMatch(/^in-/);

    const pureBotDispatchTool = await butlerToolMap.get("bot_dispatch_thread")!.execute(
      { botId: lead.id, title: "Tool blocked", prompt: "Should fail", worktree: false },
      butlerToolCtx,
    );
    expect(pureBotDispatchTool.isError).toBe(true);

    // Re-enable Paseo thread backend -> restores dispatch and inspect
    const onSettings = (await h.invokeRpc(settingsUpdateRpc.name, { paseoEnabled: true })) as HubSettings;
    expect(onSettings.paseoEnabled).toBe(true);

    const restoredDispatch = (await h.invokeRpc(threadDispatchRpc.name, {
      botId: lead.id,
      title: "Restored dispatch",
      prompt: "Run again",
      worktree: false,
    })) as { agentId: string };
    const restoredInspect = (await h.invokeRpc(threadInspectRpc.name, {
      agentId: restoredDispatch.agentId,
      limit: 5,
    })) as { agentId: string };
    expect(restoredInspect.agentId).toBe(restoredDispatch.agentId);

    expect(sub.snapshots.length).toBeGreaterThan(2);

    sub.abort();
    await sub.done;
    dispose();
    expect(h.hooks.size).toBe(0);
  });
});
