import {
  useAgents,
  type PluginClientContext,
  type PluginSidebarViewProps,
} from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { BotRecord, BotSection, DispatchedThread, OutboxItem } from "../../../shared/contracts";
import { useHubActions, useHubSnapshot } from "../../core/hooks";
import type { ClientFeature } from "../../core/kernel";
import { QuickCreateBotModal } from "./QuickCreateBotModal";
import { SidebarBotList } from "./SidebarBotList";
import { SidebarBottomBar, SidebarTopBar } from "./SidebarChrome";
import { QuickInboxCaptureModal } from "./SidebarModals";

function isHeroBot(bot: BotRecord): boolean {
  return bot.roleType === "butler" || bot.roleType === "companion" || bot.pinned;
}

function heroOrderWeight(bot: BotRecord): number {
  if (bot.roleType === "butler") return 0;
  if (bot.roleType === "companion") return 1;
  return 2;
}

function BotSidebarView({
  theme,
  active,
  navigation,
  dismiss,
  onOpenInboxHub,
}: PluginSidebarViewProps & { onOpenInboxHub(): void }) {
  const toast = useToast();
  const { snapshot, isLoading } = useHubSnapshot();
  const { openBotSession, upsertSection } = useHubActions();
  const agentRefs = useAgents();
  const attentionAgentRefs = useAgents({ where: (a) => a.requiresAttention });
  const runningAgentRefs = useAgents({
    where: (a) => a.status === "running" || a.status === "initializing",
  });

  const [openingBotId, setOpeningBotId] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [localCollapsed, setLocalCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!pendingAgentId) return;
    const foundRef = agentRefs.find((ref) => ref.id === pendingAgentId) ?? null;
    if (foundRef) {
      setPendingAgentId(null);
      navigation.openAgent(foundRef);
      dismiss();
      return;
    }
    const timer = setTimeout(() => setPendingAgentId(null), 10_000);
    return () => clearTimeout(timer);
  }, [agentRefs, dismiss, navigation, pendingAgentId]);

  const handleOpenBot = useCallback(
    async (bot: BotRecord) => {
      if (openingBotId) return;
      setOpeningBotId(bot.id);
      try {
        const res = await openBotSession.mutateAsync({ botId: bot.id });
        const foundRef = agentRefs.find((ref) => ref.id === res.agentId) ?? null;
        if (foundRef) {
          navigation.openAgent(foundRef);
          dismiss();
        } else {
          setPendingAgentId(res.agentId);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "无法打开 Bot 会话");
      } finally {
        setOpeningBotId(null);
      }
    },
    [agentRefs, dismiss, navigation, openBotSession, openingBotId, toast],
  );

  const attentionIds = useMemo(() => new Set(attentionAgentRefs.map((r) => r.id)), [attentionAgentRefs]);
  const runningIds = useMemo(() => new Set(runningAgentRefs.map((r) => r.id)), [runningAgentRefs]);

  const threadsByBotId = useMemo(() => {
    const map = new Map<string, DispatchedThread[]>();
    for (const thread of snapshot?.threads ?? []) {
      const list = map.get(thread.botId) ?? [];
      list.push(thread);
      map.set(thread.botId, list);
    }
    return map;
  }, [snapshot?.threads]);

  const unackedOutboxByBotId = useMemo(() => {
    const map = new Map<string, OutboxItem[]>();
    for (const item of snapshot?.outbox ?? []) {
      if (item.status === "acked" || !item.botId) continue;
      const list = map.get(item.botId) ?? [];
      list.push(item);
      map.set(item.botId, list);
    }
    return map;
  }, [snapshot?.outbox]);

  const activeBots = useMemo(
    () => (snapshot?.bots ?? []).filter((b) => b.archivedAt === null),
    [snapshot?.bots],
  );
  const heroBots = useMemo(
    () =>
      activeBots
        .filter(isHeroBot)
        .sort((a, b) => heroOrderWeight(a) - heroOrderWeight(b) || a.name.localeCompare(b.name)),
    [activeBots],
  );
  const nonHeroBots = useMemo(() => activeBots.filter((b) => !isHeroBot(b)), [activeBots]);
  const sortedSections = useMemo(
    () => [...(snapshot?.sections ?? [])].sort((a, b) => a.order - b.order),
    [snapshot?.sections],
  );
  const knownSectionIds = useMemo(() => new Set(sortedSections.map((s) => s.id)), [sortedSections]);
  const unsectionedBots = useMemo(
    () => nonHeroBots.filter((b) => !b.sectionId || !knownSectionIds.has(b.sectionId)),
    [knownSectionIds, nonHeroBots],
  );

  const openInboxCount = useMemo(
    () => (snapshot?.inbox ?? []).filter((i) => i.status !== "done" && i.status !== "dropped").length,
    [snapshot?.inbox],
  );
  const unackedOutbox = useMemo(
    () => (snapshot?.outbox ?? []).filter((o) => o.status !== "acked"),
    [snapshot?.outbox],
  );

  const hasUrgentOutbox = unackedOutbox.some(
    (o) => o.kind === "needs_decision" || o.kind === "blocked",
  );
  const defaultCwd = activeBots[0]?.defaultCwd ?? "";

  const handleToggleSection = (section: BotSection, nextCollapsed: boolean) => {
    setLocalCollapsed((prev) => ({ ...prev, [section.id]: nextCollapsed }));
    void upsertSection
      .mutateAsync({
        id: section.id,
        name: section.name,
        collapsed: nextCollapsed,
        order: section.order,
        color: section.color,
      })
      .catch(() => {
        setLocalCollapsed((prev) => ({ ...prev, [section.id]: !nextCollapsed }));
      });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <SidebarTopBar
        theme={theme}
        badgeCount={unackedOutbox.length + openInboxCount}
        hasUrgentOutbox={hasUrgentOutbox}
        onOpenInboxHub={() => {
          onOpenInboxHub();
          dismiss();
        }}
        onOpenCreateModal={() => setCreateOpen(true)}
      />

      <SidebarBotList
        theme={theme}
        isLoading={isLoading}
        hasSnapshot={Boolean(snapshot)}
        heroBots={heroBots}
        nonHeroBots={nonHeroBots}
        sortedSections={sortedSections}
        unsectionedBots={unsectionedBots}
        localCollapsed={localCollapsed}
        activeAgentId={active.agent?.id ?? null}
        openingBotId={openingBotId}
        attentionIds={attentionIds}
        runningIds={runningIds}
        threadsByBotId={threadsByBotId}
        unackedOutboxByBotId={unackedOutboxByBotId}
        onOpenBot={(bot) => void handleOpenBot(bot)}
        onToggleSection={handleToggleSection}
      />

      <SidebarBottomBar
        theme={theme}
        openInboxCount={openInboxCount}
        unackedOutboxCount={unackedOutbox.length}
        hasUrgentOutbox={hasUrgentOutbox}
        onPress={() => setInboxOpen(true)}
      />

      <QuickCreateBotModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultCwd={defaultCwd}
        usedColors={activeBots.map((b) => b.avatarColor)}
        theme={theme}
      />

      <QuickInboxCaptureModal
        open={inboxOpen}
        onOpenChange={setInboxOpen}
        openInboxCount={openInboxCount}
        unackedOutboxCount={unackedOutbox.length}
        onOpenHub={() => {
          onOpenInboxHub();
          dismiss();
        }}
        theme={theme}
      />
    </View>
  );
}

export const botSidebarFeature: ClientFeature = {
  manifest: {
    id: "bot_sidebar",
    name: "DS-Bot 团队侧栏",
  },
  register(client: PluginClientContext) {
    const SidebarWrapper = (props: PluginSidebarViewProps) => (
      <BotSidebarView
        {...props}
        onOpenInboxHub={() => client.openScreen({ screenId: "inbox-outbox" })}
      />
    );
    const cleanup = client.addSidebarView({
      id: "paseo-bot-sidebar",
      title: "Paseo Bot",
      description: "DS-Bot 风格团队与双脑视图",
      Component: SidebarWrapper,
    });
    return () => {
      void cleanup();
    };
  },
};
