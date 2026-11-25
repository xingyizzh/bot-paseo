import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineRpc } from "@getpaseo/plugin";
import type { PluginHookContext, PluginHooks, PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PaseoPort } from "../../server/adapters/paseo-adapter";
import { ServerKernel, type ServerFeature } from "../../server/core/kernel";
import { createLogger } from "../../server/core/logger";
import { createJsonStateStore } from "../../server/core/store";
import { botRegistryFeature } from "../../server/features/bot_registry/adapter";
import { botSnapshotRpc, botUpsertRpc } from "../../shared/rpc";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createMockContext() {
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
  return { server, handlers, hooks };
}

function createProbeFeature(): {
  feature: ServerFeature;
  rpc: ReturnType<typeof defineRpc<z.ZodObject<{ delta: z.ZodNumber }>, z.ZodObject<{ count: z.ZodNumber }>>>;
  getCount: () => number;
} {
  let count = 0;
  const rpc = defineRpc({
    name: "probe.counter.inc",
    input: z.object({ delta: z.number().int() }),
    output: z.object({ count: z.number().int() }),
  });
  return {
    rpc,
    getCount: () => count,
    feature: {
      manifest: { id: "probe_counter", name: "Probe Counter" },
      register(kernel) {
        kernel.handleRpc("probe_counter", rpc, async (input) => {
          count += input.delta;
          return { count };
        });
      },
    },
  };
}

describe("microkernel dual-unit stateful isolation & resilience", () => {
  it("runs bot_registry and probe_counter concurrently with zero interference", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-bot-iso-"));
    tempDirs.push(dir);
    const { server, handlers } = createMockContext();
    const logger = createLogger("test");
    const store = createJsonStateStore(dir);
    const adapter: PaseoPort = {
      async resolveDefaultWorkspaceDir() {
        return dir;
      },
      async ensureBotAgent() {
        return { agentId: "a-1", created: true };
      },
      async reloadBotAgent() {},
      async dispatchThread() {
        return { agentId: "a-2" };
      },
      async inspectThread() {
        return { agentId: "a-2", status: "idle", title: null, cwd: dir, digests: [] };
      },
    };

    const kernel = new ServerKernel({ server, store, logger, adapter });
    const probe = createProbeFeature();
    kernel.register(botRegistryFeature);
    kernel.register(probe.feature);

    const eventsSeen: number[] = [];
    kernel.events.on("state.changed", (snap: { revision: number }) => {
      eventsSeen.push(snap.revision);
    });

    const invoke = (name: string, input: unknown) => {
      const fn = handlers.get(name);
      if (!fn) throw new Error(`Missing handler ${name}`);
      return fn(input, { paseo: {} });
    };

    const [snap, probe1] = await Promise.all([
      invoke(botSnapshotRpc.name, {}),
      invoke(probe.rpc.name, { delta: 3 }),
    ]);

    expect((snap as { bots: unknown[]; revision: number }).bots).toHaveLength(2);
    expect((snap as { revision: number }).revision).toBe(1);
    expect(probe1).toEqual({ count: 3 });

    const [botRes, probe2] = await Promise.all([
      invoke(botUpsertRpc.name, {
        name: "项目主管",
        roleType: "project_lead",
        bio: "只负责代码仓",
        personaPrompt: "",
        provider: "claude/sonnet",
        defaultCwd: dir,
        permissionMode: "workspace",
        sectionId: null,
        pinned: false,
      }),
      invoke(probe.rpc.name, { delta: 4 }),
    ]);

    expect((botRes as { name: string }).name).toBe("项目主管");
    expect(probe2).toEqual({ count: 7 });
    expect(probe.getCount()).toBe(7);
    expect(eventsSeen).toEqual([1, 2]);
    expect(store.read().bots).toHaveLength(3);

    kernel.dispose();
  });

  it("recovers from corrupt hub-state.json with backup and isolates failing event/hook listeners", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-bot-corrupt-"));
    tempDirs.push(dir);
    const errors: string[] = [];
    const store = createJsonStateStore(dir, (msg) => errors.push(msg));
    fs.writeFileSync(store.statePath, "{not valid json", "utf8");

    const recovered = store.read();
    expect(recovered.bots).toEqual([]);
    expect(recovered.revision).toBe(0);
    expect(errors).toHaveLength(1);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith("hub-state.corrupt."));
    expect(backups).toHaveLength(1);

    const commit = await store.update((state) => ({
      nextState: { ...state, updatedAt: "2026-11-25T12:00:00Z" },
      result: "ok",
    }));
    expect(commit.changed).toBe(true);
    expect(commit.state.revision).toBe(1);

    const { server, hooks } = createMockContext();
    const logErr = vi.fn();
    const kernel = new ServerKernel({
      server,
      store,
      logger: { info: vi.fn(), warn: vi.fn(), error: logErr },
      adapter: {},
    });

    const seen: string[] = [];
    kernel.events.on("ping", () => {
      throw new Error("boom-1");
    });
    kernel.events.on("ping", (v: string) => {
      seen.push(v);
    });
    kernel.events.emit("ping", "ok");
    expect(seen).toEqual(["ok"]);
    expect(logErr).toHaveBeenCalled();

    kernel.events.on<{ ackAccepted?: () => void }>("hang", (p) => {
      p.ackAccepted?.();
    });
    await expect(kernel.events.emitWithAck("hang", {}, 25)).rejects.toThrow(/timed out/i);

    const hookOrder: string[] = [];
    const off1 = kernel.addHook("agent.turn.after", async () => {
      throw new Error("hook-boom");
    });
    const off2 = kernel.addHook("agent.turn.after", async () => {
      hookOrder.push("second");
    });
    await hooks.get("agent.turn.after")?.({}, {} as PluginHookContext);
    expect(hookOrder).toEqual(["second"]);

    off1();
    expect(hooks.has("agent.turn.after")).toBe(true);
    off2();
    expect(hooks.has("agent.turn.after")).toBe(false);

    kernel.dispose();
  });
});
