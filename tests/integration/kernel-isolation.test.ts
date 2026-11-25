import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineRpc } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
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
  const server = {
    handle(contract: { name: string }, handler: (input: unknown, ctx: unknown) => Promise<unknown>) {
      handlers.set(contract.name, handler);
    },
    addHook() {
      return () => {};
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
  return { server, handlers };
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

describe("microkernel dual-unit stateful isolation", () => {
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

    expect((snap as { bots: unknown[] }).bots).toHaveLength(2);
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
    expect(eventsSeen.length).toBeGreaterThanOrEqual(1);
    expect(store.read().bots).toHaveLength(3);

    kernel.dispose();
  });
});
