import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BotRecord, ExecutionCapabilities, InboxItem } from "../../../shared/contracts";
import { CheckboxRow, FormInput, SelectChip } from "../../core/form-primitives";
import { useHubActions } from "../../core/hooks";
import { ActionButton, RolePill, SurfaceCard, type AppTheme } from "../../core/primitives";

const STATUS_LABELS: Record<InboxItem["status"], string> = {
  captured: "已锁存",
  triaged: "已分诊",
  dispatched: "已派发",
  done: "已完成",
  dropped: "已忽略",
};

interface DispatchSlot {
  isExpanded: boolean;
  dispatchableBots: readonly BotRecord[];
  targetBotId: string;
  taskTitle: string;
  worktree: boolean;
  dispatchPending: boolean;
  onToggleExpand(): void;
  onSelectBot(botId: string): void;
  onChangeTitle(title: string): void;
  onToggleWorktree(): void;
  onConfirmDispatch(): void;
}

function InboxItemCard({
  item,
  isArchive,
  capabilities,
  navigation,
  theme,
  onUpdateStatus,
  dispatchSlot,
}: {
  item: InboxItem;
  isArchive: boolean;
  capabilities: ExecutionCapabilities;
  navigation: PluginScreenProps["navigation"];
  theme: AppTheme;
  onUpdateStatus(status: InboxItem["status"]): void;
  dispatchSlot?: DispatchSlot;
}) {
  const statusColor = item.status === "dispatched" ? theme.colors.statusSuccess : theme.colors.accent;
  const linkedAgentId = item.linkedAgentId;

  return (
    <SurfaceCard theme={theme} style={{ gap: 10, opacity: isArchive ? 0.72 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          <RolePill label={STATUS_LABELS[item.status]} color={statusColor} theme={theme} />
          <RolePill label={item.source} color={theme.colors.foregroundMuted} theme={theme} />
        </View>
        <Text style={{ fontSize: 11.5, color: theme.colors.foregroundMuted }}>
          {item.createdAt.slice(0, 16).replace("T", " ")}
        </Text>
      </View>

      <View style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.accent, backgroundColor: theme.colors.surface2, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9 }}>
        <Text selectable style={{ fontSize: 13.5, color: theme.colors.foreground, lineHeight: 20 }}>{item.rawText}</Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {capabilities.inspect && linkedAgentId && navigation ? (
            <ActionButton label="查看关联线程" variant="secondary" theme={theme} onPress={() => navigation.openAgent({ agentId: linkedAgentId })} />
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {!isArchive ? (
            <>
              {capabilities.threads && dispatchSlot ? (
                <ActionButton label={dispatchSlot.isExpanded ? "收起派发" : "派发任务"} theme={theme} onPress={dispatchSlot.onToggleExpand} />
              ) : null}
              <ActionButton label="完成" variant="secondary" theme={theme} onPress={() => onUpdateStatus("done")} />
              <ActionButton label="忽略" variant="secondary" theme={theme} onPress={() => onUpdateStatus("dropped")} />
            </>
          ) : (
            <ActionButton label="重新激活" variant="secondary" theme={theme} onPress={() => onUpdateStatus("captured")} />
          )}
        </View>
      </View>

      {capabilities.threads && dispatchSlot?.isExpanded ? (
        <View style={{ gap: 10, padding: 12, borderRadius: 10, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>选择目标执行 Bot</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {dispatchSlot.dispatchableBots.map((bot) => (
              <SelectChip key={bot.id} label={bot.name} iconName={bot.iconName} color={bot.avatarColor} selected={(dispatchSlot.targetBotId || dispatchSlot.dispatchableBots[0]?.id) === bot.id} onPress={() => dispatchSlot.onSelectBot(bot.id)} theme={theme} />
            ))}
          </View>
          <FormInput theme={theme} value={dispatchSlot.taskTitle} onChangeText={dispatchSlot.onChangeTitle} placeholder="子线程标题" style={{ borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <CheckboxRow checked={dispatchSlot.worktree} label="Worktree 隔离" onToggle={dispatchSlot.onToggleWorktree} theme={theme} />
            <ActionButton label={dispatchSlot.dispatchPending ? "派发中..." : "确认派发"} disabled={dispatchSlot.dispatchPending} theme={theme} onPress={dispatchSlot.onConfirmDispatch} />
          </View>
        </View>
      ) : null}
    </SurfaceCard>
  );
}

export function InboxTab({
  items,
  bots,
  capabilities,
  navigation,
  theme,
}: {
  items: readonly InboxItem[];
  bots: readonly BotRecord[];
  capabilities: ExecutionCapabilities;
  navigation: PluginScreenProps["navigation"];
  theme: AppTheme;
}) {
  const toast = useToast();
  const { addInbox, updateInbox, dispatchThread } = useHubActions();
  const [captureText, setCaptureText] = useState("");
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [targetBotId, setTargetBotId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [worktree, setWorktree] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    if (!capabilities.threads) setExpandingId(null);
  }, [capabilities.threads]);

  const dispatchableBots = useMemo(() => bots.filter((b) => b.archivedAt === null && b.roleType !== "companion"), [bots]);
  const sorted = useMemo(() => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items]);
  const activeItems = useMemo(() => sorted.filter((i) => i.status !== "done" && i.status !== "dropped"), [sorted]);
  const archivedItems = useMemo(() => sorted.filter((i) => i.status === "done" || i.status === "dropped"), [sorted]);

  const handleCapture = async () => {
    const rawText = captureText.trim();
    if (!rawText) return;
    try {
      await addInbox.mutateAsync({ rawText, source: "user", tags: [] });
      setCaptureText("");
      toast.show("已原话锁存至 Inbox", { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "录入失败");
    }
  };

  const openExpander = (item: InboxItem) => {
    if (expandingId === item.id) {
      setExpandingId(null);
      return;
    }
    const defaultBot =
      dispatchableBots.find((b) => b.id === item.targetBotId) ??
      dispatchableBots.find((b) => b.roleType === "butler") ??
      dispatchableBots[0];
    setTargetBotId(defaultBot?.id ?? "");
    setTaskTitle(item.rawText.split("\n")[0]?.slice(0, 48) || "来自 Inbox 的任务");
    setWorktree(true);
    setExpandingId(item.id);
  };

  const handleDispatch = async (item: InboxItem) => {
    const bot = dispatchableBots.find((b) => b.id === targetBotId) ?? dispatchableBots[0];
    if (!bot) {
      toast.error("没有可派发的总管或项目主管 Bot");
      return;
    }
    try {
      await dispatchThread.mutateAsync({
        botId: bot.id,
        title: taskTitle.trim() || item.rawText.slice(0, 48),
        prompt: item.rawText,
        cwd: bot.defaultCwd,
        worktree,
        inboxId: item.id,
      });
      setExpandingId(null);
      toast.show(`已派发给「${bot.name}」`, { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "派发失败");
    }
  };

  const handleStatusUpdate = (id: string, status: InboxItem["status"]) => {
    void updateInbox.mutateAsync({ id, status }).catch((e) => toast.error(e instanceof Error ? e.message : "更新失败"));
  };

  return (
    <View style={{ gap: 14 }}>
      <SurfaceCard theme={theme} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10 }}>
        <FormInput
          theme={theme}
          value={captureText}
          onChangeText={setCaptureText}
          placeholder="随手记下一句话想法或待办，回车直接原话存盘..."
          returnKeyType="send"
          onSubmitEditing={() => void handleCapture()}
          style={{ flex: 1, minWidth: 0, borderWidth: 0, backgroundColor: "transparent", paddingVertical: 6 }}
        />
        <ActionButton label={addInbox.isPending ? "保存..." : "记住"} disabled={addInbox.isPending} theme={theme} onPress={() => void handleCapture()} />
      </SurfaceCard>

      {activeItems.length === 0 ? (
        <SurfaceCard theme={theme} style={{ alignItems: "center", paddingVertical: 24, gap: 6 }}>
          <Icon name="Inbox" size={22} color={theme.colors.foregroundMuted} />
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: theme.colors.foreground }}>Inbox 暂无待处理条目</Text>
        </SurfaceCard>
      ) : (
        activeItems.map((item) => (
          <InboxItemCard
            key={item.id}
            item={item}
            isArchive={false}
            capabilities={capabilities}
            navigation={navigation}
            theme={theme}
            onUpdateStatus={(status) => handleStatusUpdate(item.id, status)}
            dispatchSlot={{
              isExpanded: expandingId === item.id,
              dispatchableBots,
              targetBotId,
              taskTitle,
              worktree,
              dispatchPending: dispatchThread.isPending,
              onToggleExpand: () => openExpander(item),
              onSelectBot: setTargetBotId,
              onChangeTitle: setTaskTitle,
              onToggleWorktree: () => setWorktree((v) => !v),
              onConfirmDispatch: () => void handleDispatch(item),
            }}
          />
        ))
      )}

      {archivedItems.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" onPress={() => setArchiveOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
            <Icon name={archiveOpen ? "ChevronDown" : "ChevronRight"} size={15} color={theme.colors.foregroundMuted} />
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foregroundMuted }}>
              已完成 / 已忽略 ({archivedItems.length})
            </Text>
          </Pressable>
          {archiveOpen
            ? archivedItems.map((item) => (
                <InboxItemCard
                  key={item.id}
                  item={item}
                  isArchive={true}
                  capabilities={capabilities}
                  navigation={navigation}
                  theme={theme}
                  onUpdateStatus={(status) => handleStatusUpdate(item.id, status)}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}
