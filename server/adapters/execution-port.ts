import type {
  BotRecord,
  ExecutionCapabilities,
  ThreadMessageDigest,
} from "../../shared/contracts";

export type { ExecutionCapabilities };

export interface ExecutionDispatchInput {
  bot: BotRecord;
  title: string;
  prompt: string;
  cwd: string;
  worktree: boolean;
}

export interface ExecutionInspectResult {
  agentId: string;
  status: string;
  title: string | null;
  cwd: string | null;
  digests: ThreadMessageDigest[];
}

export interface ExecutionPort {
  readonly kind: "paseo" | "null";
  readonly capabilities: ExecutionCapabilities;
  resolveDefaultWorkspaceDir(host: unknown, fallback: string): Promise<string>;
  ensureBotAgent(
    host: unknown,
    bot: BotRecord,
    initialPrompt?: string,
  ): Promise<{ agentId: string; created: boolean }>;
  reloadBotAgent(host: unknown, agentId: string): Promise<void>;
  dispatchThread(host: unknown, input: ExecutionDispatchInput): Promise<{ agentId: string }>;
  inspectThread(host: unknown, agentId: string, limit: number): Promise<ExecutionInspectResult>;
}
