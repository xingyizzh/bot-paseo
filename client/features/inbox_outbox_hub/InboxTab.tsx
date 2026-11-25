import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BotRecord, InboxItem } from "../../../shared/contracts";
import { useHubActions } from "../../core/hooks";
import { ActionButton, SurfaceCard, type AppTheme } from "../../core/primitives";
import { InboxItemCard } from "./InboxDispatchExpander";

export function InboxTab({
  items,
  bots,
  navigation,
  theme,
}: {
  items: readonly InboxItem[];
  bots: readonly BotRecord[];
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

  const dispatchableBots = useMemo(
    () => bots.filter((b) => b.archivedAt === null && b.roleType !== "companion"),
    [bots],
  );
  const sorted = useMemo(
    () => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items],
  );
  const activeItems = useMemo(
    () => sorted.filter((i) => i.status !== "done" && i.status !== "dropped"),
    [sorted],
  );
  const archivedItems = useMemo(
    () => sorted.filter((i) => i.status === "done" || i.status === "dropped"),
    [sorted],
  );

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
    void updateInbox
      .mutateAsync({ id, status })
      .catch((e) => toast.error(e instanceof Error ? e.message : "更新失败"));
  };

  return (
    <View style={{ gap: 14 }}>
      <SurfaceCard theme={theme} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10 }}>
        <TextInput
          value={captureText}
          onChangeText={setCaptureText}
          placeholder="随手记下一句话想法或待办，回车直接原话存盘..."
          placeholderTextColor={theme.colors.foregroundMuted}
          returnKeyType="send"
          onSubmitEditing={() => void handleCapture()}
          style={{
            flex: 1,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontSize: 13.5,
            color: theme.colors.foreground,
          }}
        />
        <ActionButton
          label={addInbox.isPending ? "保存..." : "记住"}
          disabled={addInbox.isPending}
          theme={theme}
          onPress={() => void handleCapture()}
        />
      </SurfaceCard>

      {activeItems.length === 0 ? (
        <SurfaceCard theme={theme} style={{ alignItems: "center", paddingVertical: 24, gap: 6 }}>
          <Icon name="Inbox" size={22} color={theme.colors.foregroundMuted} />
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: theme.colors.foreground }}>
            Inbox 暂无待处理条目
          </Text>
        </SurfaceCard>
      ) : (
        activeItems.map((item) => (
          <InboxItemCard
            key={item.id}
            item={item}
            isArchive={false}
            isExpanded={expandingId === item.id}
            dispatchableBots={dispatchableBots}
            targetBotId={targetBotId}
            taskTitle={taskTitle}
            worktree={worktree}
            dispatchPending={dispatchThread.isPending}
            navigation={navigation}
            theme={theme}
            onToggleExpand={() => openExpander(item)}
            onSelectBot={setTargetBotId}
            onChangeTitle={setTaskTitle}
            onToggleWorktree={() => setWorktree((v) => !v)}
            onConfirmDispatch={() => void handleDispatch(item)}
            onUpdateStatus={(status) => handleStatusUpdate(item.id, status)}
          />
        ))
      )}

      {archivedItems.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setArchiveOpen((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}
          >
            <Icon
              name={archiveOpen ? "ChevronDown" : "ChevronRight"}
              size={15}
              color={theme.colors.foregroundMuted}
            />
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
                  isExpanded={false}
                  dispatchableBots={dispatchableBots}
                  targetBotId={targetBotId}
                  taskTitle={taskTitle}
                  worktree={worktree}
                  dispatchPending={dispatchThread.isPending}
                  navigation={navigation}
                  theme={theme}
                  onToggleExpand={() => {}}
                  onSelectBot={setTargetBotId}
                  onChangeTitle={setTaskTitle}
                  onToggleWorktree={() => {}}
                  onConfirmDispatch={() => {}}
                  onUpdateStatus={(status) => handleStatusUpdate(item.id, status)}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}
