import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import type { BotRecord, InboxItem } from "../../../shared/contracts";
import { ActionButton, RolePill, SurfaceCard, type AppTheme } from "../../core/primitives";

const STATUS_LABELS: Record<InboxItem["status"], string> = {
  captured: "已锁存",
  triaged: "已分诊",
  dispatched: "已派发",
  done: "已完成",
  dropped: "已忽略",
};

export function InboxItemCard({
  item,
  isArchive,
  isExpanded,
  dispatchableBots,
  targetBotId,
  taskTitle,
  worktree,
  dispatchPending,
  navigation,
  theme,
  onToggleExpand,
  onSelectBot,
  onChangeTitle,
  onToggleWorktree,
  onConfirmDispatch,
  onUpdateStatus,
}: {
  item: InboxItem;
  isArchive: boolean;
  isExpanded: boolean;
  dispatchableBots: readonly BotRecord[];
  targetBotId: string;
  taskTitle: string;
  worktree: boolean;
  dispatchPending: boolean;
  navigation: PluginScreenProps["navigation"];
  theme: AppTheme;
  onToggleExpand(): void;
  onSelectBot(botId: string): void;
  onChangeTitle(title: string): void;
  onToggleWorktree(): void;
  onConfirmDispatch(): void;
  onUpdateStatus(status: InboxItem["status"]): void;
}) {
  return (
    <SurfaceCard theme={theme} style={{ gap: 10, opacity: isArchive ? 0.72 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <RolePill
            label={STATUS_LABELS[item.status]}
            color={item.status === "dispatched" ? theme.colors.statusSuccess : theme.colors.accent}
            backgroundColor={`${theme.colors.accent}18`}
          />
          <RolePill
            label={item.source}
            color={theme.colors.foregroundMuted}
            backgroundColor={theme.colors.surface2}
          />
        </View>
        <Text style={{ fontSize: 11.5, color: theme.colors.foregroundMuted }}>
          {item.createdAt.slice(0, 16).replace("T", " ")}
        </Text>
      </View>

      <View
        style={{
          borderLeftWidth: 3,
          borderLeftColor: theme.colors.accent,
          backgroundColor: theme.colors.surface2,
          borderRadius: 6,
          paddingHorizontal: 12,
          paddingVertical: 9,
        }}
      >
        <Text selectable style={{ fontSize: 13.5, color: theme.colors.foreground, lineHeight: 20 }}>
          {item.rawText}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {item.linkedAgentId && navigation ? (
            <ActionButton
              label="查看关联线程"
              variant="secondary"
              theme={theme}
              onPress={() => navigation.openAgent({ agentId: item.linkedAgentId ?? "" })}
            />
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {!isArchive ? (
            <>
              <ActionButton
                label={isExpanded ? "收起派发" : "派发任务"}
                theme={theme}
                onPress={onToggleExpand}
              />
              <ActionButton
                label="完成"
                variant="secondary"
                theme={theme}
                onPress={() => onUpdateStatus("done")}
              />
              <ActionButton
                label="忽略"
                variant="secondary"
                theme={theme}
                onPress={() => onUpdateStatus("dropped")}
              />
            </>
          ) : (
            <ActionButton
              label="重新激活"
              variant="secondary"
              theme={theme}
              onPress={() => onUpdateStatus("captured")}
            />
          )}
        </View>
      </View>

      {isExpanded ? (
        <View
          style={{
            gap: 10,
            padding: 12,
            borderRadius: 10,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>
            选择目标执行 Bot
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {dispatchableBots.map((bot) => {
              const selected = (targetBotId || dispatchableBots[0]?.id) === bot.id;
              return (
                <Pressable
                  key={bot.id}
                  accessibilityRole="button"
                  onPress={() => onSelectBot(bot.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: selected ? bot.avatarColor : theme.colors.surface0,
                    borderWidth: 1,
                    borderColor: selected ? bot.avatarColor : theme.colors.border,
                  }}
                >
                  <Icon
                    name={bot.iconName}
                    size={13}
                    color={selected ? "#FFFFFF" : bot.avatarColor}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: selected ? "#FFFFFF" : theme.colors.foreground,
                    }}
                  >
                    {bot.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={taskTitle}
            onChangeText={onChangeTitle}
            placeholder="子线程标题"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              color: theme.colors.foreground,
              borderRadius: 9,
              paddingHorizontal: 10,
              paddingVertical: 8,
              fontSize: 13,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={onToggleWorktree}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Icon
                name={worktree ? "CheckSquare" : "Square"}
                size={15}
                color={worktree ? theme.colors.accent : theme.colors.foregroundMuted}
              />
              <Text style={{ fontSize: 12, color: theme.colors.foreground }}>Worktree 隔离</Text>
            </Pressable>
            <ActionButton
              label={dispatchPending ? "派发中..." : "确认派发"}
              disabled={dispatchPending}
              theme={theme}
              onPress={onConfirmDispatch}
            />
          </View>
        </View>
      ) : null}
    </SurfaceCard>
  );
}
