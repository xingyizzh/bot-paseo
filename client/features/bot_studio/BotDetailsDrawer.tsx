import { useAgent, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { roleLabel } from "../../../shared/avatars";
import { resolveExecutionCapabilities, type BotRecord } from "../../../shared/contracts";
import { useHubActions, useHubSnapshot } from "../../core/hooks";
import { ActionButton, BotAvatar, RolePill, SegmentTabs, SurfaceCard } from "../../core/primitives";
import {
  BotDetailsTabContent,
  BotDispatchTabContent,
  BotThreadsTabContent,
  type InspectPreviewState,
} from "./BotDetailsTabs";

type DrawerTab = "details" | "threads" | "dispatch";

const DRAWER_TABS: readonly { value: DrawerTab; label: string }[] = [
  { value: "details", label: "详情" },
  { value: "threads", label: "关联线程" },
  { value: "dispatch", label: "快捷派活" },
];

const DETAILS_ONLY_TABS: readonly { value: DrawerTab; label: string }[] = [
  { value: "details", label: "详情" },
];

export function BotDetailsDrawer({
  theme,
  navigation,
  params,
  onOpenStudio,
}: PluginAgentPanelProps & { onOpenStudio(botId?: string): void }) {
  const toast = useToast();
  const agent = useAgent(params.agentId);
  const { snapshot } = useHubSnapshot();
  const { openBotSession, dispatchThread, inspectThread } = useHubActions();
  const capabilities = resolveExecutionCapabilities(snapshot?.settings);
  const [tab, setTab] = useState<DrawerTab>("details");
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [inspectCache, setInspectCache] = useState<Record<string, InspectPreviewState>>({});
  const [dispatchTitle, setDispatchTitle] = useState("");
  const [dispatchPrompt, setDispatchPrompt] = useState("");
  const [useWorktree, setUseWorktree] = useState(true);

  const metaBotId =
    typeof agent?.metadata?.["paseo-bot.botId"] === "string"
      ? agent.metadata["paseo-bot.botId"]
      : null;

  const matchedBot: BotRecord | null = useMemo(() => {
    const bots = snapshot?.bots ?? [];
    if (metaBotId) {
      const byMeta = bots.find((b) => b.id === metaBotId);
      if (byMeta) return byMeta;
    }
    return bots.find((b) => b.agentId === params.agentId) ?? null;
  }, [metaBotId, params.agentId, snapshot?.bots]);

  useEffect(() => {
    setTab("details");
    setExpandedThreadId(null);
    setDispatchTitle("");
    setDispatchPrompt("");
  }, [params.agentId, matchedBot?.id]);

  useEffect(() => {
    if (!capabilities.threads && tab !== "details") {
      setTab("details");
    }
  }, [capabilities.threads, tab]);

  const botThreads = useMemo(() => {
    if (!matchedBot) return [];
    return [...(snapshot?.threads ?? [])]
      .filter((t) => t.botId === matchedBot.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [matchedBot, snapshot?.threads]);

  const activeBots = useMemo(
    () => (snapshot?.bots ?? []).filter((b) => b.archivedAt === null),
    [snapshot?.bots],
  );

  const handleToggleInspect = async (agentId: string) => {
    if (expandedThreadId === agentId) {
      setExpandedThreadId(null);
      return;
    }
    setExpandedThreadId(agentId);
    setInspectCache((prev) => ({ ...prev, [agentId]: { loading: true, error: null, status: "", digests: [] } }));
    try {
      const res = await inspectThread({ agentId, limit: 6 });
      setInspectCache((prev) => ({
        ...prev,
        [agentId]: { loading: false, error: null, status: res.status, digests: res.digests },
      }));
    } catch (err) {
      setInspectCache((prev) => ({
        ...prev,
        [agentId]: { loading: false, error: err instanceof Error ? err.message : "穿透读取失败", status: "", digests: [] },
      }));
    }
  };

  const handleDispatch = async () => {
    if (!matchedBot) return;
    const title = dispatchTitle.trim();
    const prompt = dispatchPrompt.trim();
    if (!title || !prompt) {
      toast.error("请填写任务标题和派发指令");
      return;
    }
    try {
      const res = await dispatchThread.mutateAsync({ botId: matchedBot.id, title, prompt, worktree: useWorktree });
      setDispatchTitle("");
      setDispatchPrompt("");
      setTab("threads");
      toast.show(`已派发线程「${res.thread.title}」`, { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "派发任务失败");
    }
  };

  if (!matchedBot) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
        <SurfaceCard theme={theme} style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="UserRound" size={18} color={theme.colors.foregroundMuted} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.foreground }}>当前会话未绑定 Paseo Bot</Text>
          </View>
          <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted, lineHeight: 18 }}>
            这是一个常规 Paseo 会话。你可以直接切换打开团队中的 Bot，或在 Bot 团队管理中新建角色。
          </Text>
          <ActionButton label="打开 Bot 团队管理" theme={theme} onPress={() => onOpenStudio()} />
        </SurfaceCard>

        {activeBots.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted }}>快速打开团队 Bot</Text>
            {activeBots.map((bot) => (
              <Pressable
                key={bot.id}
                accessibilityRole="button"
                onPress={async () => {
                  try {
                    const res = await openBotSession.mutateAsync({ botId: bot.id });
                    navigation?.openAgent({ agentId: res.agentId });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "打开失败");
                  }
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 10,
                  borderRadius: 12,
                  backgroundColor: theme.colors.surface1,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <BotAvatar iconName={bot.iconName} color={bot.avatarColor} size={34} borderColor={theme.colors.surface1} theme={theme} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "600", color: theme.colors.foreground }}>{bot.name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>{bot.bio || roleLabel(bot.roleType)}</Text>
                </View>
                <RolePill label={roleLabel(bot.roleType)} color={bot.avatarColor} theme={theme} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ alignItems: "center", gap: 8, paddingTop: 4 }}>
        <BotAvatar
          iconName={matchedBot.iconName}
          color={matchedBot.avatarColor}
          size={56}
          showStar={matchedBot.roleType !== "project_lead" || matchedBot.pinned}
          borderColor={theme.colors.surface0}
          theme={theme}
        />
        <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.foreground }}>{matchedBot.name}</Text>
        <RolePill label={roleLabel(matchedBot.roleType)} color={matchedBot.avatarColor} theme={theme} />
      </View>

      <SegmentTabs<DrawerTab>
        options={capabilities.threads ? DRAWER_TABS : DETAILS_ONLY_TABS}
        value={tab}
        onChange={setTab}
        theme={theme}
      />

      {tab === "details" ? (
        <BotDetailsTabContent bot={matchedBot} agentModel={agent?.model ?? null} theme={theme} onEdit={() => onOpenStudio(matchedBot.id)} />
      ) : null}

      {capabilities.threads && tab === "threads" ? (
        <BotThreadsTabContent
          threads={botThreads}
          expandedThreadId={expandedThreadId}
          inspectCache={inspectCache}
          canNavigate={Boolean(navigation)}
          theme={theme}
          onOpenAgent={(agentId) => navigation?.openAgent({ agentId })}
          onToggleInspect={(agentId) => void handleToggleInspect(agentId)}
        />
      ) : null}

      {capabilities.threads && tab === "dispatch" ? (
        <BotDispatchTabContent
          bot={matchedBot}
          title={dispatchTitle}
          prompt={dispatchPrompt}
          useWorktree={useWorktree}
          isPending={dispatchThread.isPending}
          theme={theme}
          onChangeTitle={setDispatchTitle}
          onChangePrompt={setDispatchPrompt}
          onToggleWorktree={() => setUseWorktree((v) => !v)}
          onSubmit={() => void handleDispatch()}
        />
      ) : null}
    </ScrollView>
  );
}
