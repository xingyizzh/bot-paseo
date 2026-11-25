import os from "node:os";
import { DomainError, ERROR_CODES } from "../../../shared/contracts";
import {
  botArchiveRpc,
  botOpenSessionRpc,
  botSectionDeleteRpc,
  botSectionUpsertRpc,
  botSnapshotRpc,
  botUpsertRpc,
} from "../../../shared/rpc";
import type { PaseoPort } from "../../adapters/paseo-adapter";
import type { FeatureManifest, ServerFeature } from "../../core/kernel";
import {
  archiveBot,
  bindBotAgent,
  deleteSection,
  seedDefaultBots,
  upsertBot,
  upsertSection,
} from "./logic";

export const BOT_REGISTRY_MANIFEST: FeatureManifest = {
  id: "bot_registry",
  name: "Bot Registry & Sections",
};

export const botRegistryFeature: ServerFeature = {
  manifest: BOT_REGISTRY_MANIFEST,
  register(kernel) {
    const adapter = kernel.adapter as PaseoPort;
    const id = BOT_REGISTRY_MANIFEST.id;

    kernel.handleRpc(id, botSnapshotRpc, async (_input, ctx) => {
      const current = kernel.store.read();
      if (current.bots.length > 0) return current;
      const defaultCwd = await adapter.resolveDefaultWorkspaceDir(ctx.paseo, os.homedir());
      await kernel.commitState(id, (state) => {
        const seeded = seedDefaultBots(state, defaultCwd);
        return { nextState: seeded, result: seeded };
      });
      return kernel.store.read();
    });

    kernel.handleRpc(id, botUpsertRpc, async (input, ctx) => {
      const resolvedCwd = input.defaultCwd.trim()
        ? input.defaultCwd.trim()
        : await adapter.resolveDefaultWorkspaceDir(ctx.paseo, os.homedir());
      const { saved, needsReload } = await kernel.commitState(id, (state) => {
        const prev = input.id ? state.bots.find((b) => b.id === input.id) : undefined;
        const { nextState, bot } = upsertBot(state, { ...input, defaultCwd: resolvedCwd });
        const changed =
          prev !== undefined &&
          bot.agentId !== null &&
          (prev.personaPrompt !== bot.personaPrompt ||
            prev.permissionMode !== bot.permissionMode ||
            prev.provider !== bot.provider ||
            prev.roleType !== bot.roleType);
        return { nextState, result: { saved: bot, needsReload: changed } };
      });
      if (needsReload && saved.agentId) {
        await adapter.reloadBotAgent(ctx.paseo, saved.agentId);
      }
      return saved;
    });

    kernel.handleRpc(id, botArchiveRpc, async (input) =>
      kernel.commitState(id, (state) => {
        const { nextState, bot } = archiveBot(state, input);
        return { nextState, result: bot };
      }),
    );

    kernel.handleRpc(id, botSectionUpsertRpc, async (input) =>
      kernel.commitState(id, (state) => {
        const { nextState, section } = upsertSection(state, input);
        return { nextState, result: section };
      }),
    );

    kernel.handleRpc(id, botSectionDeleteRpc, async (input) =>
      kernel.commitState(id, (state) => {
        const { nextState, deleted } = deleteSection(state, input);
        return { nextState, result: { deleted } };
      }),
    );

    kernel.handleRpc(id, botOpenSessionRpc, async (input, ctx) => {
      const state = kernel.store.read();
      const target = state.bots.find((b) => b.id === input.botId);
      if (!target) {
        throw new DomainError(id, "openSession", ERROR_CODES.NOT_FOUND, `Bot not found: ${input.botId}`);
      }
      if (target.archivedAt !== null) {
        throw new DomainError(
          id,
          "openSession",
          ERROR_CODES.PERMISSION_DENIED,
          `Cannot open session for archived bot: ${input.botId}`,
        );
      }
      const ensured = await adapter.ensureBotAgent(ctx.paseo, target, input.initialPrompt);
      const bot = await kernel.commitState(id, (latest) => {
        const { nextState, bot: updated } = bindBotAgent(latest, input.botId, ensured.agentId);
        return { nextState, result: updated };
      });
      return { bot, agentId: ensured.agentId, created: ensured.created };
    });
  },
};
