import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { roleLabel } from "../../../shared/avatars";
import type { BotRecord, BotSection, DispatchedThread, OutboxItem } from "../../../shared/contracts";
import { BotAvatar, RolePill, type AppTheme } from "../../core/primitives";

export const DOT_ATTENTION = "#D97706";
export const DOT_RUNNING = "#16A34A";
export const DOT_UNREAD = "#3B66F5";

export function computeBotDotColor(
  bot: BotRecord,
  attentionIds: ReadonlySet<string>,
  runningIds: ReadonlySet<string>,
  threadsByBotId: ReadonlyMap<string, readonly DispatchedThread[]>,
  unackedOutboxByBotId: ReadonlyMap<string, readonly OutboxItem[]>,
): string | null {
  const threads = threadsByBotId.get(bot.id) ?? [];
  const outboxes = unackedOutboxByBotId.get(bot.id) ?? [];

  const needsAttention =
    (bot.agentId ? attentionIds.has(bot.agentId) : false) ||
    threads.some((t) => attentionIds.has(t.agentId)) ||
    outboxes.some((o) => o.kind === "needs_decision" || o.kind === "blocked");
  if (needsAttention) return DOT_ATTENTION;

  const isRunning =
    (bot.agentId ? runningIds.has(bot.agentId) : false) ||
    threads.some((t) => runningIds.has(t.agentId) || t.status === "running" || t.status === "initializing");
  if (isRunning) return DOT_RUNNING;

  if (outboxes.length > 0) return DOT_UNREAD;
  return null;
}

export function pickAggregateDotColor(dots: readonly (string | null)[]): string | null {
  if (dots.includes(DOT_ATTENTION)) return DOT_ATTENTION;
  if (dots.includes(DOT_RUNNING)) return DOT_RUNNING;
  if (dots.includes(DOT_UNREAD)) return DOT_UNREAD;
  return null;
}

export function HeroBotCard({
  bot,
  theme,
  active,
  opening,
  dotColor,
  onPress,
}: {
  bot: BotRecord;
  theme: AppTheme;
  active: boolean;
  opening: boolean;
  dotColor: string | null;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        minWidth: 118,
        borderRadius: 16,
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        paddingVertical: 14,
        paddingHorizontal: 10,
        alignItems: "center",
        gap: 7,
        opacity: pressed || opening ? 0.8 : 1,
      })}
    >
      {dotColor ? (
        <View
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
      <BotAvatar
        iconName={bot.iconName}
        color={bot.avatarColor}
        size={48}
        showStar={true}
        borderColor={theme.colors.surface1}
      />
      <Text
        numberOfLines={1}
        style={{
          fontSize: 13.5,
          fontWeight: "600",
          color: theme.colors.foreground,
          textAlign: "center",
        }}
      >
        {bot.name}
      </Text>
      <RolePill
        label={opening ? "唤起中..." : roleLabel(bot.roleType)}
        color={bot.avatarColor}
        backgroundColor={`${bot.avatarColor}1A`}
      />
    </Pressable>
  );
}

export function SectionGroupHeader({
  section,
  count,
  collapsed,
  dotColor,
  theme,
  onToggle,
}: {
  section: Pick<BotSection, "id" | "name">;
  count: number;
  collapsed: boolean;
  dotColor: string | null;
  theme: AppTheme;
  onToggle(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onToggle}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 6,
        paddingHorizontal: 4,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
        <Icon
          name={collapsed ? "ChevronRight" : "ChevronDown"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: theme.colors.foregroundMuted,
          }}
        >
          {section.name}
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{count}</Text>
      </View>
      {dotColor ? (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function BotRowItem({
  bot,
  theme,
  active,
  opening,
  dotColor,
  statusText,
  onPress,
}: {
  bot: BotRecord;
  theme: AppTheme;
  active: boolean;
  opening: boolean;
  dotColor: string | null;
  statusText: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: active
          ? `${theme.colors.accent}18`
          : pressed
            ? theme.colors.surface2
            : "transparent",
        opacity: opening ? 0.72 : 1,
      })}
    >
      <BotAvatar
        iconName={bot.iconName}
        color={bot.avatarColor}
        size={34}
        borderColor={theme.colors.surface0}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 13.5,
            fontWeight: "600",
            color: theme.colors.foreground,
          }}
        >
          {bot.name}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12,
            color: theme.colors.foregroundMuted,
          }}
        >
          {opening ? "正在打开会话..." : statusText}
        </Text>
      </View>
      {dotColor ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
    </Pressable>
  );
}
