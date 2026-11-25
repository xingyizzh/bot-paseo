import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { roleLabel } from "../../../shared/avatars";
import type { BotRecord, BotSection, DispatchedThread, OutboxItem } from "../../../shared/contracts";
import { BotAvatar, RolePill, type AppTheme } from "../../core/primitives";

type DotStatus = "attention" | "running" | "unread";

function resolveDotColor(status: DotStatus | null, theme: AppTheme): string | null {
  if (status === "attention") return theme.colors.statusWarning;
  if (status === "running") return theme.colors.statusSuccess;
  if (status === "unread") return theme.colors.accent;
  return null;
}

function computeBotDotStatus(
  bot: BotRecord,
  attentionIds: ReadonlySet<string>,
  runningIds: ReadonlySet<string>,
  threadsByBotId: ReadonlyMap<string, readonly DispatchedThread[]>,
  unackedOutboxByBotId: ReadonlyMap<string, readonly OutboxItem[]>,
): DotStatus | null {
  const threads = threadsByBotId.get(bot.id) ?? [];
  const outboxes = unackedOutboxByBotId.get(bot.id) ?? [];
  const needsAttention =
    (bot.agentId ? attentionIds.has(bot.agentId) : false) ||
    threads.some((t) => attentionIds.has(t.agentId)) ||
    outboxes.some((o) => o.kind === "needs_decision" || o.kind === "blocked");
  if (needsAttention) return "attention";

  const isRunning =
    (bot.agentId ? runningIds.has(bot.agentId) : false) ||
    threads.some((t) => runningIds.has(t.agentId) || t.status === "running" || t.status === "initializing");
  if (isRunning) return "running";
  if (outboxes.length > 0) return "unread";
  return null;
}

function pickAggregateDotStatus(dots: readonly (DotStatus | null)[]): DotStatus | null {
  if (dots.includes("attention")) return "attention";
  if (dots.includes("running")) return "running";
  if (dots.includes("unread")) return "unread";
  return null;
}

function HeroBotCard({
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
        minWidth: 100,
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
        <View style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
      ) : null}
      <BotAvatar iconName={bot.iconName} color={bot.avatarColor} size={48} showStar borderColor={theme.colors.surface1} theme={theme} />
      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "600", color: theme.colors.foreground, textAlign: "center" }}>
        {bot.name}
      </Text>
      <RolePill label={opening ? "唤起中..." : roleLabel(bot.roleType)} color={bot.avatarColor} theme={theme} />
    </Pressable>
  );
}

function SectionGroupHeader({
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
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 4 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={14} color={theme.colors.foregroundMuted} />
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted, flexShrink: 1 }}>
          {section.name}
        </Text>
        <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{count}</Text>
      </View>
      {dotColor ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: dotColor }} /> : null}
    </Pressable>
  );
}

function BotRowItem({
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
        backgroundColor: active ? `${theme.colors.accent}18` : pressed ? theme.colors.surface2 : "transparent",
        opacity: opening ? 0.72 : 1,
      })}
    >
      <BotAvatar iconName={bot.iconName} color={bot.avatarColor} size={34} borderColor={theme.colors.surface0} theme={theme} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "600", color: theme.colors.foreground }}>{bot.name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
          {opening ? "正在打开会话..." : statusText}
        </Text>
      </View>
      {dotColor ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} /> : null}
    </Pressable>
  );
}

export function SidebarBotList({
  theme,
  isLoading,
  hasSnapshot,
  heroBots,
  nonHeroBots,
  sortedSections,
  unsectionedBots,
  localCollapsed,
  activeAgentId,
  openingBotId,
  attentionIds,
  runningIds,
  threadsByBotId,
  unackedOutboxByBotId,
  onOpenBot,
  onToggleSection,
}: {
  theme: AppTheme;
  isLoading: boolean;
  hasSnapshot: boolean;
  heroBots: readonly BotRecord[];
  nonHeroBots: readonly BotRecord[];
  sortedSections: readonly BotSection[];
  unsectionedBots: readonly BotRecord[];
  localCollapsed: Readonly<Record<string, boolean>>;
  activeAgentId: string | null;
  openingBotId: string | null;
  attentionIds: ReadonlySet<string>;
  runningIds: ReadonlySet<string>;
  threadsByBotId: ReadonlyMap<string, readonly DispatchedThread[]>;
  unackedOutboxByBotId: ReadonlyMap<string, readonly OutboxItem[]>;
  onOpenBot(bot: BotRecord): void;
  onToggleSection(section: BotSection, nextCollapsed: boolean): void;
}) {
  const statusOf = (bot: BotRecord) =>
    computeBotDotStatus(bot, attentionIds, runningIds, threadsByBotId, unackedOutboxByBotId);

  const renderRow = (bot: BotRecord) => (
    <BotRowItem key={bot.id} bot={bot} theme={theme} active={Boolean(bot.agentId && activeAgentId === bot.agentId)} opening={openingBotId === bot.id} dotColor={resolveDotColor(statusOf(bot), theme)} statusText={bot.bio || bot.defaultCwd} onPress={() => onOpenBot(bot)} />
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 14 }}>
      {isLoading && !hasSnapshot ? (
        <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted, padding: 8 }}>正在加载 Bot 团队...</Text>
      ) : null}

      {heroBots.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {heroBots.map((bot) => (
            <HeroBotCard
              key={bot.id}
              bot={bot}
              theme={theme}
              active={Boolean(bot.agentId && activeAgentId === bot.agentId)}
              opening={openingBotId === bot.id}
              dotColor={resolveDotColor(statusOf(bot), theme)}
              onPress={() => onOpenBot(bot)}
            />
          ))}
        </View>
      ) : null}

      {sortedSections.map((section) => {
        const bots = nonHeroBots.filter((b) => b.sectionId === section.id);
        if (bots.length === 0) return null;
        const collapsed = localCollapsed[section.id] ?? section.collapsed;
        const aggDot = resolveDotColor(pickAggregateDotStatus(bots.map(statusOf)), theme);
        return (
          <View key={section.id} style={{ gap: 2 }}>
            <SectionGroupHeader
              section={section}
              count={bots.length}
              collapsed={collapsed}
              dotColor={aggDot}
              theme={theme}
              onToggle={() => onToggleSection(section, !collapsed)}
            />
            {!collapsed ? bots.map(renderRow) : null}
          </View>
        );
      })}

      {unsectionedBots.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.colors.foregroundMuted, paddingHorizontal: 4, paddingVertical: 4 }}>
            项目主管 ({unsectionedBots.length})
          </Text>
          {unsectionedBots.map(renderRow)}
        </View>
      ) : null}
    </ScrollView>
  );
}
