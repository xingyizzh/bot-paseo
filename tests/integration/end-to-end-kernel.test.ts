import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type {
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
} from "../../shared/contracts";
import {
  botSnapshotRpc,
  botUpsertRpc,
  hubSubscribe,
  inboxAddRpc,
  threadDispatchRpc,
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

  const createdAgents: { id: string; cwd: string; metadata?: Record<string, unknown> }[] = [];
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
    },
    agents: {
      async create(opts: { cwd: string; metadata?: Record<string, unknown> }) {
        seq += 1;
        const created = { id: `agent-${seq}`, cwd: opts.cwd, metadata: opts.metadata };
        createdAgents.push(created);
        return created;
      },
      ref(agentId: string) {
        return {
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

  return { server, hooks, createdAgents, invokeRpc, emitHook, subscribeHub };
}

describe("end-to-end server plugin kernel", () => {
  it("coordinates all four decoupled features through EventBus, hooks, and cleanup", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-bot-e2e-"));
    tempDirs.push(dataDir);
    process.env.PASEO_BOT_DATA_DIR = dataDir;

    const h = createHarness();
    const dispose = contributeServer(h.server);

    const initial = (await h.invokeRpc(botSnapshotRpc.name, {})) as BotHubSnapshot;
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
      "outbox_post",
      "thread_inspect",
    ]);

    await h.emitHook("agent.permission.before", {
      agent: {
        id: dispatched.agentId,
        workspaceId: "ws-1",
        parentAgentId: null,
        provider: "claude/sonnet",
        cwd: "/tmp/default-workspace",
        title: "Build Feature",
        background: false,
        metadata: { "paseo-bot.botId": lead.id, "paseo-bot.kind": "worker-thread" },
      },
      request: {
        id: "perm-1",
        provider: "claude",
        name: "Bash",
        kind: "tool",
        title: "Run tests",
      },
    });

    await h.emitHook("agent.turn.after", {
      agent: {
        id: dispatched.agentId,
        workspaceId: "ws-1",
        parentAgentId: null,
        provider: "claude/sonnet",
        cwd: "/tmp/default-workspace",
        title: "Build Feature",
        background: false,
        metadata: { "paseo-bot.botId": lead.id, "paseo-bot.kind": "worker-thread" },
      },
      turnId: "turn-1",
      outcome: { kind: "completed" },
    });

    // Wait one microtask tick for fire-and-forget event listeners to commit store writes.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const latest = (await h.invokeRpc(botSnapshotRpc.name, {})) as BotHubSnapshot;
    const updatedInbox = latest.inbox.find((item) => item.id === inbox.id);
    expect(updatedInbox?.status).toBe("dispatched");
    expect(updatedInbox?.rawText).toBe("Keep original user thought intact across dispatch");
    expect(latest.outbox.some((item) => item.kind === "needs_decision" && item.inboxId === inbox.id)).toBe(true);
    expect(latest.outbox.some((item) => item.kind === "delivered" && item.inboxId === inbox.id)).toBe(true);
    expect(sub.snapshots.length).toBeGreaterThan(2);

    sub.abort();
    await sub.done;
    dispose();
    expect(h.hooks.size).toBe(0);
  });
});
