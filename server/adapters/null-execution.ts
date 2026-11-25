import { DomainError, ERROR_CODES, type BotRecord } from "../../shared/contracts";
import type { ExecutionPort } from "./execution-port";

export interface NullExecutionHooks {
  ensureBotAgent?(
    host: unknown,
    bot: BotRecord,
    initialPrompt?: string,
  ): Promise<{ agentId: string; created: boolean }>;
}

/** Pure-Bot fallback ExecutionPort used when Paseo thread orchestration is unavailable. */
export function createNullExecutionAdapter(hooks?: NullExecutionHooks): ExecutionPort {
  return {
    kind: "null",
    capabilities: { threads: false, worktree: false, inspect: false },

    async resolveDefaultWorkspaceDir(_host, fallback) {
      return fallback;
    },

    async ensureBotAgent(host, bot, initialPrompt) {
      if (hooks?.ensureBotAgent) {
        return hooks.ensureBotAgent(host, bot, initialPrompt);
      }
      throw new DomainError(
        "execution",
        "ensureBotAgent",
        ERROR_CODES.ADAPTER_FAILURE,
        "No host session provider bound to null execution adapter",
      );
    },

    async reloadBotAgent() {
      return undefined;
    },

    async dispatchThread() {
      throw new DomainError(
        "execution",
        "dispatchThread",
        ERROR_CODES.PERMISSION_DENIED,
        "Paseo thread backend is disabled (pure Bot mode)",
      );
    },

    async inspectThread() {
      throw new DomainError(
        "execution",
        "inspectThread",
        ERROR_CODES.PERMISSION_DENIED,
        "Paseo thread backend is disabled (pure Bot mode)",
      );
    },
  };
}
