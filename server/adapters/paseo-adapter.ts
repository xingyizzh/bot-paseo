import fs from "node:fs";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import {
  DomainError,
  ERROR_CODES,
  type BotPermissionMode,
  type BotRecord,
  type ThreadMessageDigest,
} from "../../shared/contracts";
import type { Logger } from "../core/logger";

export interface PaseoPort {
  resolveDefaultWorkspaceDir(paseo: PaseoApi, fallback: string): Promise<string>;
  ensureBotAgent(
    paseo: PaseoApi,
    bot: BotRecord,
    initialPrompt?: string,
  ): Promise<{ agentId: string; created: boolean }>;
  reloadBotAgent(paseo: PaseoApi, agentId: string): Promise<void>;
  dispatchThread(
    paseo: PaseoApi,
    input: { bot: BotRecord; title: string; prompt: string; cwd: string; worktree: boolean },
  ): Promise<{ agentId: string }>;
  inspectThread(
    paseo: PaseoApi,
    agentId: string,
    limit: number,
  ): Promise<{
    agentId: string;
    status: string;
    title: string | null;
    cwd: string | null;
    digests: ThreadMessageDigest[];
  }>;
}

const MODE_PATTERNS: Record<BotPermissionMode, RegExp> = {
  readonly: /plan|read.?only|ask/i,
  full: /bypass|full|yolo|unrestricted/i,
  workspace: /accept|workspace|auto|edit|default/i,
};

function hasGitAncestor(startDir: string): boolean {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function summarizeTimelineItem(item: Record<string, unknown>): ThreadMessageDigest | null {
  const type = String(item.type ?? "");
  if (type === "user_message" || type === "assistant_message") {
    const text = String(item.text ?? "").trim();
    return text ? { role: type === "user_message" ? "user" : "assistant", text: text.slice(0, 600) } : null;
  }
  if (type === "tool_call") {
    return { role: "tool", text: `${String(item.name ?? "tool")} (${String(item.status ?? "unknown")})` };
  }
  if (type === "error" || type === "notification") {
    return { role: type, text: String(item.message ?? "").slice(0, 400) };
  }
  return null;
}

async function resolveUsableProvider(paseo: PaseoApi, preferred: string): Promise<string> {
  try {
    const snap = await paseo.providers.snapshot();
    const ready = snap.entries.filter((p) => p.enabled && p.status === "ready");
    if (ready.some((p) => preferred.startsWith(`${p.provider}/`) || preferred === p.provider)) {
      return preferred;
    }
    const first = ready[0];
    if (first?.models?.[0]) return `${first.provider}/${first.models[0].id}`;
    if (first) return first.provider;
  } catch {
    return preferred;
  }
  return preferred;
}

async function resolveModeId(
  paseo: PaseoApi,
  resolvedProvider: string,
  permissionMode: BotPermissionMode,
): Promise<string | undefined> {
  try {
    const providerPrefix = resolvedProvider.split("/")[0];
    if (!providerPrefix) return undefined;
    const res = await paseo.providers.listModes(providerPrefix);
    const pattern = MODE_PATTERNS[permissionMode];
    const match = res.modes?.find((m) => pattern.test(m.id) || pattern.test(m.label));
    return match?.id;
  } catch {
    return undefined;
  }
}

export function createPaseoAdapter(logger: Logger): PaseoPort {
  return {
    async resolveDefaultWorkspaceDir(paseo, fallback) {
      try {
        const res = await paseo.projects.list();
        const first = res.projects[0];
        if (first?.projectRootPath) return first.projectRootPath;
      } catch (err) {
        logger.warn("paseo_adapter", "resolveDefaultWorkspaceDir", String(err));
      }
      return fallback;
    },

    async ensureBotAgent(paseo, bot, initialPrompt) {
      try {
        if (bot.agentId) {
          try {
            const ref = paseo.agents.ref(bot.agentId);
            const refreshed = await ref.refresh();
            if (refreshed?.agent && !refreshed.agent.archivedAt) {
              if (initialPrompt) await ref.send(initialPrompt);
              return { agentId: refreshed.agent.id, created: false };
            }
          } catch (err) {
            logger.warn("paseo_adapter", "ensureBotAgent.refresh", String(err));
          }
        }
        const list = await paseo.agents.list();
        const found = list.entries.find(
          (entry) =>
            !entry.agent.archivedAt &&
            entry.agent.metadata?.["paseo-bot.botId"] === bot.id &&
            entry.agent.metadata?.["paseo-bot.kind"] === "bot-home",
        );
        if (found) {
          if (initialPrompt) await paseo.agents.ref(found.agent.id).send(initialPrompt);
          return { agentId: found.agent.id, created: false };
        }
        const provider = await resolveUsableProvider(paseo, bot.provider);
        const modeId = await resolveModeId(paseo, provider, bot.permissionMode);
        const created = await paseo.agents.create({
          config: { provider, ...(modeId ? { modeId } : {}) },
          cwd: bot.defaultCwd,
          title: bot.name,
          prompt: initialPrompt,
          metadata: {
            "paseo-bot.botId": bot.id,
            "paseo-bot.kind": "bot-home",
            "paseo-bot.roleType": bot.roleType,
          },
        });
        return { agentId: created.id, created: true };
      } catch (err) {
        throw new DomainError(
          "paseo_adapter",
          "ensureBotAgent",
          ERROR_CODES.ADAPTER_FAILURE,
          err instanceof Error ? err.message : String(err),
        );
      }
    },

    async reloadBotAgent(paseo, agentId) {
      try {
        await paseo.agents.ref(agentId).reload();
      } catch (err) {
        logger.warn("paseo_adapter", "reloadBotAgent", String(err));
      }
    },

    async dispatchThread(paseo, input) {
      try {
        const provider = await resolveUsableProvider(paseo, input.bot.provider);
        const modeId = await resolveModeId(paseo, provider, input.bot.permissionMode);
        const isGitRepo = hasGitAncestor(input.cwd);
        const useWorktree = input.worktree && isGitRepo;
        if (input.worktree && !isGitRepo) {
          logger.warn("paseo_adapter", "dispatchThread", `Non-git cwd ${input.cwd}; launching without worktree`);
        }
        const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
        const branch = `paseo-bot/${input.bot.id}-${Date.now().toString(36)}-${suffix}`;
        const created = await paseo.agents.create({
          config: { provider, ...(modeId ? { modeId } : {}) },
          cwd: input.cwd,
          parent: input.bot.agentId ?? undefined,
          title: input.title,
          prompt: input.prompt,
          worktree: useWorktree ? { mode: "branch-off", newBranch: branch } : undefined,
          metadata: {
            "paseo-bot.botId": input.bot.id,
            "paseo-bot.kind": "worker-thread",
            "paseo-bot.roleType": input.bot.roleType,
          },
        });
        return { agentId: created.id };
      } catch (err) {
        throw new DomainError(
          "paseo_adapter",
          "dispatchThread",
          ERROR_CODES.ADAPTER_FAILURE,
          err instanceof Error ? err.message : String(err),
        );
      }
    },

    async inspectThread(paseo, agentId, limit) {
      try {
        const ref = paseo.agents.ref(agentId);
        const page = await ref.timeline.refetch({ direction: "tail", limit });
        const digests = page.entries
          .map((entry) => summarizeTimelineItem(entry.item as unknown as Record<string, unknown>))
          .filter((d): d is ThreadMessageDigest => d !== null);
        return {
          agentId,
          status: page.agent?.status ?? "unknown",
          title: page.agent?.title ?? null,
          cwd: page.agent?.cwd ?? null,
          digests,
        };
      } catch (err) {
        throw new DomainError(
          "paseo_adapter",
          "inspectThread",
          ERROR_CODES.ADAPTER_FAILURE,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
