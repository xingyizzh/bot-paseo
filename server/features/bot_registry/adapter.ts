import os from "node:os";
import {
  botArchiveRpc,
  botOpenSessionRpc,
  botSectionDeleteRpc,
  botSectionUpsertRpc,
  botSnapshotRpc,
  botUpsertRpc,
} from "../../../shared/rpc";
import { DomainError, ERROR_CODES } from "../../../shared/contracts";
import type { PaseoPort } from "../../adapters/paseo-adapter";
import type { ServerFeature } from "../../core/kernel";
import {
  archiveBot,
  bindBotAgent,
  deleteSection,
  seedDefaultBots,
  upsertBot,
  upsertSection,
} from "./logic";
import { BOT_REGISTRY_MANIFEST } from "./manifest";

export const botRegistryFeature: ServerFeature = {
  manifest: BOT_REGISTRY_MANIFEST,
  register(kernel) {
    const adapter = kernel.adapter as PaseoPort;
    const id = BOT_REGISTRY_MANIFEST.id;

    kernel.handleRpc(id, botSnapshotRpc, async (_input, ctx) => {
      const current = kernel.store.read();
      if (current.bots.length > 0) return current;
      const defaultCwd = await adapter.resolveDefaultWorkspaceDir(ctx.paseo, os.homedir());
      return kernel.store.update((state) => {
        const seeded = seedDefaultBots(state, defaultCwd);
        return { nextState: seeded, result: seeded };
      });
    });

    kernel.handleRpc(id, botUpsertRpc, async (input) => {
      const bot = await kernel.store.update((state) => {
        const { nextState, bot: saved } = upsertBot(state, input);
        return { nextState, result: saved };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return bot;
    });

    kernel.handleRpc(id, botArchiveRpc, async (input) => {
      const bot = await kernel.store.update((state) => {
        const { nextState, bot: saved } = archiveBot(state, input);
        return { nextState, result: saved };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return bot;
    });

    kernel.handleRpc(id, botSectionUpsertRpc, async (input) => {
      const section = await kernel.store.update((state) => {
        const { nextState, section: saved } = upsertSection(state, input);
        return { nextState, result: saved };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return section;
    });

    kernel.handleRpc(id, botSectionDeleteRpc, async (input) => {
      const result = await kernel.store.update((state) => {
        const { nextState, deleted } = deleteSection(state, input);
        return { nextState, result: { deleted } };
      });
      if (result.deleted) kernel.events.emit("state.changed", kernel.store.read());
      return result;
    });

    kernel.handleRpc(id, botOpenSessionRpc, async (input, ctx) => {
      const state = kernel.store.read();
      const target = state.bots.find((b) => b.id === input.botId);
      if (!target) {
        throw new DomainError(id, "openSession", ERROR_CODES.NOT_FOUND, `Bot not found: ${input.botId}`);
      }
      const ensured = await adapter.ensureBotAgent(ctx.paseo, target, input.initialPrompt);
      const bot = await kernel.store.update((latest) => {
        const { nextState, bot: updated } = bindBotAgent(latest, input.botId, ensured.agentId);
        return { nextState, result: updated };
      });
      kernel.events.emit("state.changed", kernel.store.read());
      return { bot, agentId: ensured.agentId, created: ensured.created };
    });
  },
};
