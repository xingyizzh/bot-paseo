import { ScrollView } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import type { BotRecord, BotSection, DispatchedThread, OutboxItem } from "../../../shared/contracts";
import type { AppTheme } from "../../core/primitives";
import {
  BotRowItem,
  HeroBotCard,
  SectionGroupHeader,
  computeBotDotColor,
  pickAggregateDotColor,
} from "./SidebarCards";

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
  const dotOf = (bot: BotRecord) =>
    computeBotDotColor(bot, attentionIds, runningIds, threadsByBotId, unackedOutboxByBotId);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 14 }}>
      {isLoading && !hasSnapshot ? (
        <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted, padding: 8 }}>
          正在加载 Bot 团队...
        </Text>
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
              dotColor={dotOf(bot)}
              onPress={() => onOpenBot(bot)}
            />
          ))}
        </View>
      ) : null}

      {sortedSections.map((section) => {
        const bots = nonHeroBots.filter((b) => b.sectionId === section.id);
        if (bots.length === 0) return null;
        const collapsed = localCollapsed[section.id] ?? section.collapsed;
        const dots = bots.map(dotOf);
        return (
          <View key={section.id} style={{ gap: 2 }}>
            <SectionGroupHeader
              section={section}
              count={bots.length}
              collapsed={collapsed}
              dotColor={pickAggregateDotColor(dots)}
              theme={theme}
              onToggle={() => onToggleSection(section, !collapsed)}
            />
            {!collapsed
              ? bots.map((bot) => (
                  <BotRowItem
                    key={bot.id}
                    bot={bot}
                    theme={theme}
                    active={Boolean(bot.agentId && activeAgentId === bot.agentId)}
                    opening={openingBotId === bot.id}
                    dotColor={dotOf(bot)}
                    statusText={bot.bio || bot.defaultCwd}
                    onPress={() => onOpenBot(bot)}
                  />
                ))
              : null}
          </View>
        );
      })}

      {unsectionedBots.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text
            style={{
              fontSize: 11.5,
              fontWeight: "600",
              color: theme.colors.foregroundMuted,
              paddingHorizontal: 4,
              paddingVertical: 4,
            }}
          >
            项目主管 ({unsectionedBots.length})
          </Text>
          {unsectionedBots.map((bot) => (
            <BotRowItem
              key={bot.id}
              bot={bot}
              theme={theme}
              active={Boolean(bot.agentId && activeAgentId === bot.agentId)}
              opening={openingBotId === bot.id}
              dotColor={dotOf(bot)}
              statusText={bot.bio || bot.defaultCwd}
              onPress={() => onOpenBot(bot)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
