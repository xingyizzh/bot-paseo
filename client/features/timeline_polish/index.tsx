import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { z } from "zod";
import { PASEO_BOT_TOOL_NAMES, type PaseoBotToolName } from "../../../shared/contracts";
import { botSnapshotRpc, inboxAddRpc, threadDispatchRpc } from "../../../shared/rpc";
import type { ClientFeature } from "../../core/kernel";
import { semanticColor } from "../../core/primitives";

const PASEO_BOT_TOOL_SET: ReadonlySet<string> = new Set(PASEO_BOT_TOOL_NAMES);

const BotTimelinePillSchema = z.object({
  tool: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]).default("completed"),
  label: z.string(),
  icon: z.string().default("Sparkles"),
});

type BotTimelinePillData = z.infer<typeof BotTimelinePillSchema>;

function isPaseoBotPrefix(prefix: string): boolean {
  const segments = prefix.split(/(?:__|[.:])/).filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  const namespace = segments[segments.length - 1];
  return namespace === "paseo-bot" || namespace === "paseo_bot";
}

function parseBotToolName(rawName: string): PaseoBotToolName | null {
  const lower = rawName.trim().toLowerCase();
  if (!lower) return null;
  if (PASEO_BOT_TOOL_SET.has(lower)) return lower as PaseoBotToolName;

  const sepCandidates = [
    { idx: lower.lastIndexOf("__"), len: 2 },
    { idx: lower.lastIndexOf("."), len: 1 },
    { idx: lower.lastIndexOf(":"), len: 1 },
  ].filter((c) => c.idx >= 0);
  if (sepCandidates.length === 0) return null;

  sepCandidates.sort((a, b) => b.idx - a.idx);
  const sep = sepCandidates[0];
  const prefix = lower.slice(0, sep.idx);
  const leaf = lower.slice(sep.idx + sep.len);
  if (!PASEO_BOT_TOOL_SET.has(leaf) || !isPaseoBotPrefix(prefix)) return null;
  return leaf as PaseoBotToolName;
}

function describeToolCall(
  tool: PaseoBotToolName,
  status: "running" | "completed" | "failed" | "canceled",
): { label: string; icon: string } {
  const running = status === "running";
  const failed = status === "failed";
  if (tool === "inbox_capture") {
    return { icon: "Inbox", label: failed ? "Inbox 记录失败" : running ? "正在记入 Inbox..." : "已静默记入 Inbox" };
  }
  if (tool === "inbox_list") {
    return { icon: "Inbox", label: failed ? "Inbox 读取失败" : running ? "正在读取 Inbox..." : "已读取 Inbox 列表" };
  }
  if (tool === "outbox_post") {
    return { icon: "Send", label: failed ? "Outbox 投递失败" : running ? "正在投递 Outbox..." : "已投递结果至 Outbox" };
  }
  if (tool === "thread_inspect") {
    return { icon: "Eye", label: failed ? "线程穿透读取失败" : running ? "正在穿透读取线程..." : "已穿透读取线程摘要" };
  }
  if (tool === "bot_dispatch_thread") {
    return { icon: "GitBranch", label: failed ? "任务线程派发失败" : running ? "正在派发任务线程..." : "已派发执行线程" };
  }
  return { icon: "Bot", label: failed ? "团队列表读取失败" : running ? "正在同步团队状态..." : "已同步团队成员" };
}

function BotEventPill({ theme, item }: PluginTimelineItemProps<BotTimelinePillData>) {
  const { status, label, icon } = item.data;
  const danger = semanticColor(theme, "danger");
  const accentColor =
    status === "failed"
      ? danger
      : status === "running"
        ? semanticColor(theme, "success")
        : theme.colors.foregroundMuted;

  return (
    <View style={{ alignItems: "center", paddingVertical: 4 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 999,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: status === "failed" ? `${danger}55` : theme.colors.border,
          maxWidth: "90%",
        }}
      >
        <Icon name={icon} size={12} color={accentColor} />
        <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: "500", color: accentColor }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function parseDispatchArgs(raw: string): { title: string; prompt: string } {
  const trimmed = raw.trim();
  const sepIdx = trimmed.indexOf("::");
  if (sepIdx > 0) {
    const title = trimmed.slice(0, sepIdx).trim().slice(0, 80);
    const prompt = trimmed.slice(sepIdx + 2).trim();
    if (title && prompt) return { title, prompt };
  }
  const firstLine = trimmed.split("\n")[0]?.trim() ?? trimmed;
  return { title: firstLine.slice(0, 60) || "新派发任务", prompt: trimmed };
}

export const timelinePolishFeature: ClientFeature = {
  manifest: { id: "timeline_polish", name: "时间线轻事件与快捷指令" },
  register(client: PluginClientContext) {
    const cleanups = [
      client.addSlashCommand({
        name: "inbox",
        description: "将内容直接速记到 Paseo Bot Inbox（原话锁存）",
        argumentHint: "<要记住的原话>",
        context: "agent",
        async onSubmit(ctx) {
          const rawText = ctx.args.trim();
          if (!rawText) {
            ctx.openScreen({ screenId: "inbox-outbox", params: { tab: "inbox" } });
            return;
          }
          await ctx.rpc(inboxAddRpc, { rawText, source: "user", tags: [] });
        },
      }),
      client.addSlashCommand({
        name: "dispatch",
        description: "派发一条子线程任务给总管或项目主管 Bot",
        argumentHint: "[标题 ::] 任务描述",
        context: "agent",
        async onSubmit(ctx) {
          const raw = ctx.args.trim();
          if (!raw) {
            ctx.openPanel("bot-details");
            return;
          }
          const snap = await ctx.rpc(botSnapshotRpc, {});
          const metaBotId =
            typeof ctx.agent.metadata?.["paseo-bot.botId"] === "string"
              ? ctx.agent.metadata["paseo-bot.botId"]
              : null;
          const activeBots = snap.bots.filter((b) => b.archivedAt === null && b.roleType !== "companion");
          const target =
            activeBots.find((b) => b.id === metaBotId) ??
            activeBots.find((b) => b.roleType === "butler") ??
            activeBots[0];
          if (!target) {
            throw new Error("未找到可用的总管或项目主管 Bot，请先在 Bot 团队管理中创建。");
          }
          const parsed = parseDispatchArgs(raw);
          const preferredCwd =
            target.roleType === "project_lead" && target.defaultCwd.trim()
              ? target.defaultCwd.trim()
              : ctx.workspace.directory || target.defaultCwd;
          await ctx.rpc(threadDispatchRpc, {
            botId: target.id,
            title: parsed.title,
            prompt: parsed.prompt,
            cwd: preferredCwd,
            worktree: true,
          });
        },
      }),
      client.addCommandCenterItem({
        id: "open-bot-details",
        title: "打开 Bot 详情抽屉",
        icon: "UserRound",
        context: "agent",
        keywords: ["bot", "details", "详情", "团队"],
        onSelect(ctx) { ctx.openPanel("bot-details"); },
      }),
      client.addCommandCenterItem({
        id: "open-inbox-outbox",
        title: "打开收发箱 Inbox/Outbox",
        icon: "Inbox",
        context: "agent",
        keywords: ["inbox", "outbox", "收发箱", "待办"],
        onSelect(ctx) { ctx.openScreen({ screenId: "inbox-outbox" }); },
      }),
      client.addTimelineTransformer({
        id: "paseo-bot-tool-pill",
        query: { itemType: "tool_call" },
        transform({ item }) {
          const tool = parseBotToolName(item.name);
          if (!tool) return undefined;
          const desc = describeToolCall(tool, item.status);
          return {
            items: [
              {
                type: "plugin",
                id: item.callId,
                kind: "paseo-bot-event",
                version: 1,
                data: { tool, status: item.status, label: desc.label, icon: desc.icon },
              },
            ],
          };
        },
      }),
      client.addTimelineRenderer({
        kind: "paseo-bot-event",
        version: 1,
        schema: BotTimelinePillSchema,
        Component: BotEventPill,
      }),
    ];

    return () => {
      while (cleanups.length > 0) void cleanups.pop()?.();
    };
  },
};
