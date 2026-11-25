import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyHubState,
  DomainError,
  ERROR_CODES,
  type BotHubSnapshot,
  type HubSettings,
} from "../../../shared/contracts";
import {
  botArchiveRpc,
  botOpenSessionRpc,
  botSnapshotRpc,
  botUpsertRpc,
  settingsUpdateRpc,
} from "../../../shared/rpc";
import type { ExecutionPort } from "../../adapters/execution-port";
import { createPaseoAdapter } from "../../adapters/paseo-adapter";
import { ServerKernel } from "../../core/kernel";
import { createLogger } from "../../core/logger";
import { createJsonStateStore } from "../../core/store";
import { botRegistryFeature } from "./adapter";
import {
  archiveBot,
  bindBotAgent,
  deleteSection,
  seedDefaultBots,
  updateHubSettings,
  upsertBot,
  upsertSection,
} from "./logic";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("bot_registry pure logic", () => {
  it("seeds default butler and companion bots once and guards blank defaultCwd", () => {
    const empty = createEmptyHubState("2026-11-25T00:00:00Z");
    const seeded = seedDefaultBots(empty, "/tmp/work", "2026-11-25T00:00:00Z");
    expect(seeded.bots.map((b) => b.id)).toEqual(["butler", "companion"]);
    expect(seeded.bots[1].permissionMode).toBe("readonly");
    expect(seedDefaultBots(seeded, "/tmp/other")).toBe(seeded);

    const blankCwdSeeded = seedDefaultBots(empty, "   ", "2026-11-25T00:00:00Z");
    expect(blankCwdSeeded.bots[0].defaultCwd).toBe(".");
    expect(blankCwdSeeded.bots[1].defaultCwd).toBe(".");
  });

  it("blocks elevating companion permission beyond readonly", () => {
    const state = seedDefaultBots(createEmptyHubState(), "/tmp/work");
    expect(() =>
      upsertBot(state, {
        id: "companion",
        name: "陪伴主位",
        roleType: "companion",
        bio: "",
        personaPrompt: "",
        provider: "claude/sonnet",
        defaultCwd: "/tmp/work",
        permissionMode: "full",
        sectionId: null,
        pinned: true,
      }),
    ).toThrowError(DomainError);

    try {
      upsertBot(state, {
        name: "另一个陪伴",
        roleType: "companion",
        bio: "",
        personaPrompt: "",
        provider: "claude/sonnet",
        defaultCwd: "/tmp/work",
        permissionMode: "workspace",
        sectionId: null,
        pinned: false,
      });
    } catch (err) {
      expect((err as DomainError).code).toBe(ERROR_CODES.PERMISSION_DENIED);
    }
  });

  it("assigns distinct colors and keeps bots when deleting a section", () => {
    let state = seedDefaultBots(createEmptyHubState(), "/tmp/work");
    const secRes = upsertSection(state, {
      name: "研发组",
      collapsed: false,
      color: "#3B66F5",
    });
    state = secRes.nextState;

    const leadRes = upsertBot(state, {
      name: "项目主管A",
      roleType: "project_lead",
      bio: "负责主仓库",
      personaPrompt: "",
      provider: "claude/sonnet",
      defaultCwd: "/tmp/work/repo",
      permissionMode: "workspace",
      sectionId: secRes.section.id,
      pinned: false,
    });
    state = leadRes.nextState;

    expect(leadRes.bot.avatarColor).not.toBe("#3B66F5");
    expect(leadRes.bot.sectionId).toBe(secRes.section.id);

    const delRes = deleteSection(state, { sectionId: secRes.section.id });
    expect(delRes.deleted).toBe(true);
    const preserved = delRes.nextState.bots.find((b) => b.id === leadRes.bot.id);
    expect(preserved?.sectionId).toBeNull();
  });

  it("archives, unarchives, and binds agentId without cross-bot contamination", () => {
    let state = seedDefaultBots(createEmptyHubState(), "/tmp/work");
    state = bindBotAgent(state, "butler", "agent-butler-1").nextState;
    expect(state.bots.find((b) => b.id === "companion")?.agentId).toBeNull();

    state = archiveBot(state, { botId: "butler", archived: true }).nextState;
    expect(state.bots.find((b) => b.id === "butler")?.archivedAt).toBeTruthy();

    state = archiveBot(state, { botId: "butler", archived: false }).nextState;
    expect(state.bots.find((b) => b.id === "butler")?.archivedAt).toBeNull();
  });

  it("updates hub settings idempotently when value is unchanged", () => {
    const initial = createEmptyHubState("2026-11-25T00:00:00Z");
    expect(initial.settings).toEqual({ paseoEnabled: true });
    expect(updateHubSettings(initial, { paseoEnabled: true })).toBe(initial);

    const disabled = updateHubSettings(initial, { paseoEnabled: false });
    expect(disabled).not.toBe(initial);
    expect(disabled.settings).toEqual({ paseoEnabled: false });
    expect(updateHubSettings(disabled, { paseoEnabled: false })).toBe(disabled);
  });

  it("defaults omitted settings to paseoEnabled=true when loading legacy hub-state.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-bot-legacy-settings-"));
    tempDirs.push(dir);
    const store = createJsonStateStore(dir);
    const legacy = {
      version: 1,
      revision: 3,
      bots: [],
      sections: [],
      inbox: [],
      outbox: [],
      threads: [],
      updatedAt: "2026-11-25T00:00:00Z",
    };
    fs.writeFileSync(store.statePath, JSON.stringify(legacy), "utf8");

    const loaded = store.read();
    expect(loaded.revision).toBe(3);
    expect(loaded.settings).toEqual({ paseoEnabled: true });
  });
});

describe("bot_registry adapter & paseo-adapter hardening", () => {
  it("commits seeded snapshot with revision 1, rejects archived openSession, and reloads updated bot agents", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-bot-reg-"));
    tempDirs.push(dir);
    const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
    const server = {
      handle(contract: { name: string }, handler: (input: unknown, ctx: unknown) => Promise<unknown>) {
        handlers.set(contract.name, handler);
      },
      addHook() {
        return () => {};
      },
    } as unknown as PluginServerContext;

    const reloadedIds: string[] = [];
    const adapter: ExecutionPort = {
      kind: "paseo",
      capabilities: { threads: true, worktree: true, inspect: true },
      async resolveDefaultWorkspaceDir() {
        return dir;
      },
      async ensureBotAgent() {
        return { agentId: "agent-butler", created: true };
      },
      async reloadBotAgent(_paseo, agentId) {
        reloadedIds.push(agentId);
      },
      async dispatchThread() {
        return { agentId: "worker-1" };
      },
      async inspectThread(_paseo, agentId) {
        return { agentId, status: "idle", title: null, cwd: dir, digests: [] };
      },
    };

    const kernel = new ServerKernel({ server, store: createJsonStateStore(dir), logger: createLogger("test"), adapter });
    kernel.register(botRegistryFeature);
    const emitted: number[] = [];
    kernel.events.on<BotHubSnapshot>("state.changed", (snap) => emitted.push(snap.revision));

    const invoke = (name: string, input: unknown) => handlers.get(name)!(input, { paseo: {} });

    const snap = (await invoke(botSnapshotRpc.name, {})) as BotHubSnapshot;
    expect(snap.revision).toBe(1);
    expect(emitted).toEqual([1]);

    await invoke(botOpenSessionRpc.name, { botId: "butler" });
    await invoke(botUpsertRpc.name, {
      id: "butler",
      name: "管家总管",
      roleType: "butler",
      bio: "Bio only",
      personaPrompt: "你是工作总管家，只做拆解、分派与穿透验收，不亲自堆叠业务代码。",
      provider: "claude/sonnet",
      defaultCwd: dir,
      permissionMode: "workspace",
      sectionId: null,
      pinned: true,
    });
    expect(reloadedIds).toEqual([]);

    await invoke(botUpsertRpc.name, {
      id: "butler",
      name: "管家总管",
      roleType: "butler",
      bio: "Bio only",
      personaPrompt: "Updated persona prompt",
      provider: "claude/sonnet",
      defaultCwd: dir,
      permissionMode: "workspace",
      sectionId: null,
      pinned: true,
    });
    expect(reloadedIds).toEqual(["agent-butler"]);

    await invoke(botArchiveRpc.name, { botId: "butler", archived: true });
    await expect(invoke(botOpenSessionRpc.name, { botId: "butler" })).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });

    const revBeforeSettings = kernel.store.read().revision;
    const disabledSettings = (await invoke(settingsUpdateRpc.name, { paseoEnabled: false })) as HubSettings;
    expect(disabledSettings).toEqual({ paseoEnabled: false });
    expect(kernel.store.read().settings).toEqual({ paseoEnabled: false });
    expect(kernel.store.read().revision).toBe(revBeforeSettings + 1);

    const noopSettings = (await invoke(settingsUpdateRpc.name, { paseoEnabled: false })) as HubSettings;
    expect(noopSettings).toEqual({ paseoEnabled: false });
    expect(kernel.store.read().revision).toBe(revBeforeSettings + 1);

    const enabledSettings = (await invoke(settingsUpdateRpc.name, { paseoEnabled: true })) as HubSettings;
    expect(enabledSettings).toEqual({ paseoEnabled: true });
    expect(kernel.store.read().settings).toEqual({ paseoEnabled: true });
    kernel.dispose();
  });

  it("recovers from stale agentId in ensureBotAgent and resolves modeId & ancestor .git in dispatchThread", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-git-root-"));
    tempDirs.push(repoRoot);
    fs.mkdirSync(path.join(repoRoot, ".git"));
    const subDir = path.join(repoRoot, "packages", "sub");
    fs.mkdirSync(subDir, { recursive: true });

    const createCalls: Array<{ config: { provider: string; modeId?: string }; worktree?: { mode: string; newBranch?: string } }> = [];
    const reloadCalls: string[] = [];
    const paseo = {
      projects: { async list() { return { projects: [] }; } },
      providers: {
        async snapshot() {
          return { entries: [{ provider: "claude", enabled: true, status: "ready", models: [{ id: "sonnet" }] }] };
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
        ref(id: string) {
          return {
            async refresh() {
              throw new Error(`Agent ${id} not found`);
            },
            async reload() {
              reloadCalls.push(id);
            },
            async send() {},
          };
        },
        async list() {
          return { entries: [] };
        },
        async create(opts: { config: { provider: string; modeId?: string }; worktree?: { mode: string; newBranch?: string } }) {
          createCalls.push(opts);
          return { id: `created-${createCalls.length}` };
        },
      },
    } as unknown as PaseoApi;

    const warnSpy = vi.fn();
    const adapter = createPaseoAdapter({
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
    });

    const baseBot = seedDefaultBots(createEmptyHubState(), subDir).bots[1];
    const ensured = await adapter.ensureBotAgent(paseo, { ...baseBot, agentId: "stale-agent-99" });
    expect(ensured).toEqual({ agentId: "created-1", created: true });
    expect(warnSpy).toHaveBeenCalled();
    expect(createCalls[0].config).toEqual({ provider: "claude/sonnet", modeId: "plan" });

    const leadBot = { ...baseBot, id: "lead-1", roleType: "project_lead" as const, permissionMode: "full" as const };
    await adapter.dispatchThread(paseo, {
      bot: leadBot,
      title: "Subdir work",
      prompt: "Run",
      cwd: subDir,
      worktree: true,
    });
    expect(createCalls[1].config).toEqual({ provider: "claude/sonnet", modeId: "bypassPermissions" });
    expect(createCalls[1].worktree?.mode).toBe("branch-off");
    expect(createCalls[1].worktree?.newBranch).toMatch(/^paseo-bot\/lead-1-[a-z0-9]+-[a-z0-9]{4}$/);

    await adapter.reloadBotAgent(paseo, "created-1");
    expect(reloadCalls).toEqual(["created-1"]);
  });
});
