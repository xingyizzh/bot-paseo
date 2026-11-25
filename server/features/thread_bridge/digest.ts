import type { BotRecord, DispatchedThread, OutboxItem, OutboxKind } from "../../../shared/contracts";

const GROUP_DEFS: readonly { kind: OutboxKind; heading: string }[] = [
  { kind: "needs_decision", heading: "【待拍板 (needs_decision)】" },
  { kind: "blocked", heading: "【阻塞中 (blocked)】" },
  { kind: "delivered", heading: "【已交付 (delivered)】" },
];

function compactText(text: string, maxLen = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLen ? normalized : `${normalized.slice(0, maxLen - 1)}…`;
}

/**
 * Formats unacknowledged Outbox items into a crisp Muse-style briefing prompt for the Butler.
 */
export function buildOutboxDigestPrompt(
  items: readonly OutboxItem[],
  bots: readonly BotRecord[],
  threads: readonly DispatchedThread[],
  threadsEnabled: boolean,
): string {
  const botNames = new Map(bots.map((b) => [b.id, b.name]));
  const threadTitles = new Map(threads.map((t) => [t.agentId, t.title]));

  const sections: string[] = [
    "以下是尚未向用户汇报的 Outbox 事项（按优先级分组），请一次性整理汇报：",
    "",
  ];

  for (const group of GROUP_DEFS) {
    const bucket = items.filter((item) => item.kind === group.kind);
    if (bucket.length === 0) continue;
    sections.push(group.heading);
    for (const item of bucket) {
      const botName = item.botId ? (botNames.get(item.botId) ?? item.botId) : "系统";
      const threadPart =
        threadsEnabled && item.agentId
          ? ` | 线程: ${threadTitles.get(item.agentId) ?? item.agentId}`
          : "";
      const summary = compactText(item.summary);
      sections.push(`- [${item.id}] ${botName}${threadPart} — ${item.title}: ${summary}`);
    }
    sections.push("");
  }

  sections.push(
    "汇报规范（Muse 风格）：",
    "1. 用自然简洁的人话向用户统一汇报，严禁复述工具日志、命令输出、堆栈或过程废话。",
    "2. 每条只说三件事：① 结论、② 需要用户拍板/补充的事（如有）、③ 对应线程标题（方便用户需要时点击穿透查看）。",
    "3. 汇报完所有条目后，对每一条已汇报的 delivered 类条目调用 outbox_ack 归档；needs_decision 与 blocked 保持未确认直到用户拍板或问题解除。",
  );

  return sections.join("\n");
}

export interface WorkerReviewPromptInput {
  ownerBot: BotRecord;
  threadTitle: string;
  threadAgentId: string;
  outcomeKind: "completed" | "failed";
  tailSummary: string;
  inboxId: string | null;
}

/**
 * Formats a worker thread completion/failure notice for the owning project-lead Bot to QA before Outbox escalation.
 */
export function buildWorkerReviewPrompt(input: WorkerReviewPromptInput): string {
  const statusLine = input.outcomeKind === "completed" ? "已结束当前轮次 (completed)" : "执行失败 (failed)";
  const inboxPart = input.inboxId ? `\n- 关联 Inbox ID: ${input.inboxId}` : "";
  const inboxArg = input.inboxId ? ` 与 inboxId="${input.inboxId}"` : "";
  return [
    `你是「${input.ownerBot.name}」（项目主管），你派出的子线程刚才回报状态：${statusLine}。`,
    `- 线程标题: ${input.threadTitle}`,
    `- 线程 Agent ID: ${input.threadAgentId}${inboxPart}`,
    `- 尾部摘要: ${compactText(input.tailSummary, 600)}`,
    "",
    "请按项目质量把关流程处理：",
    `1. 先调用 thread_inspect(agentId="${input.threadAgentId}") 检查真实产出与质量；未验收前不要直接报给管家。`,
    "2. 若质量不达标或仍需修复，直接在你名下继续派发/追问线程返工。",
    `3. 仅当确认交付达标、确认阻塞或需要用户拍板时，调用 outbox_post（务必传入 threadAgentId="${input.threadAgentId}"${inboxArg}）向管家正式汇报。`,
  ].join("\n");
}
