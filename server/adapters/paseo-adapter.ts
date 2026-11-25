import fs from "node:fs";
import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import {
  DomainError,
  ERROR_CODES,
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
          const ref = paseo.agents.ref(bot.agentId);
          const refreshed = await ref.refresh();
          if (refreshed?.agent && !refreshed.agent.archivedAt) {
            if (initialPrompt) await ref.send(initialPrompt);
            return { agentId: refreshed.agent.id, created: false };
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
        const created = await paseo.agents.create({
          config: { provider },
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

    async dispatchThread(paseo, input) {
      try {
        const provider = await resolveUsableProvider(paseo, input.bot.provider);
        const isGitRepo = fs.existsSync(path.join(input.cwd, ".git"));
        const useWorktree = input.worktree && isGitRepo;
        if (input.worktree && !isGitRepo) {
          logger.warn("paseo_adapter", "dispatchThread", `Non-git cwd ${input.cwd}; launching without worktree`);
        }
        const branch = `paseo-bot/${input.bot.id}-${Date.now().toString(36)}`;
        const created = await paseo.agents.create({
          config: { provider },
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
