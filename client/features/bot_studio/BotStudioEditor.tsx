import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { roleLabel } from "../../../shared/avatars";
import type { BotRoleType } from "../../../shared/contracts";
import { useHubActions, useHubSnapshot } from "../../core/hooks";
import { ActionButton, BotAvatar, RolePill, SurfaceCard, isDarkTheme } from "../../core/primitives";
import { BotFormSections, makeBlankDraft, makeDraftFromBot, type BotFormDraft } from "./BotFormSections";

export function BotStudioEditor({
  theme,
  layout,
  navigation,
  initialBotId,
}: PluginSurfaceProps & { initialBotId?: string }) {
  const toast = useToast();
  const { snapshot, isLoading } = useHubSnapshot();
  const { upsertBot, archiveBot, upsertSection, openBotSession } = useHubActions();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(initialBotId ?? null);
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<BotFormDraft>(() => makeBlankDraft([], ""));
  const loadedKeyRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);

  const visibleBots = useMemo(() => {
    const all = snapshot?.bots ?? [];
    return showArchived ? all : all.filter((b) => b.archivedAt === null);
  }, [showArchived, snapshot?.bots]);

  const fallbackCwd = snapshot?.bots[0]?.defaultCwd ?? "";
  const usedColors = useMemo(() => (snapshot?.bots ?? []).map((b) => b.avatarColor), [snapshot?.bots]);

  const selectedBot = useMemo(() => {
    if (selectedId === "new") return null;
    const all = snapshot?.bots ?? [];
    if (selectedId) return all.find((b) => b.id === selectedId) ?? visibleBots[0] ?? null;
    return visibleBots[0] ?? null;
  }, [selectedId, snapshot?.bots, visibleBots]);

  useEffect(() => {
    if (initialBotId) {
      isDirtyRef.current = false;
      loadedKeyRef.current = null;
      setSelectedId(initialBotId);
    }
  }, [initialBotId]);

  useEffect(() => {
    if (selectedId === "new" || !selectedBot) return;
    const nextKey = `${selectedBot.id}:${selectedBot.updatedAt}`;
    if (draft.id !== selectedBot.id) {
      isDirtyRef.current = false;
      loadedKeyRef.current = nextKey;
      setDraft(makeDraftFromBot(selectedBot));
      return;
    }
    if (!isDirtyRef.current && loadedKeyRef.current !== nextKey) {
      loadedKeyRef.current = nextKey;
      setDraft(makeDraftFromBot(selectedBot));
    }
  }, [draft.id, selectedBot, selectedId]);

  const patchDraft = (patch: Partial<BotFormDraft>) => {
    isDirtyRef.current = true;
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleRoleChange = (roleType: BotRoleType) => {
    isDirtyRef.current = true;
    setDraft((prev) => ({
      ...prev,
      roleType,
      permissionMode: roleType === "companion" ? "readonly" : prev.permissionMode,
      pinned: roleType !== "project_lead" ? true : prev.pinned,
    }));
  };

  const handleSave = async () => {
    const name = draft.name.trim();
    const defaultCwd = draft.defaultCwd.trim() || fallbackCwd;
    if (!name) {
      toast.error("Bot 名称不能为空");
      return;
    }
    try {
      const saved = await upsertBot.mutateAsync({
        id: draft.id ?? undefined,
        name,
        roleType: draft.roleType,
        bio: draft.bio.trim(),
        personaPrompt: draft.personaPrompt.trim(),
        iconName: draft.iconName,
        avatarColor: draft.avatarColor,
        provider: draft.provider.trim() || "claude/sonnet",
        defaultCwd,
        permissionMode: draft.roleType === "companion" ? "readonly" : draft.permissionMode,
        sectionId: draft.sectionId,
        pinned: draft.pinned,
      });
      isDirtyRef.current = false;
      loadedKeyRef.current = `${saved.id}:${saved.updatedAt}`;
      setDraft(makeDraftFromBot(saved));
      setSelectedId(saved.id);
      toast.show(`已保存「${saved.name}」`, { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存 Bot 失败");
    }
  };

  const handleArchiveToggle = async () => {
    if (!selectedBot) return;
    const nextArchived = selectedBot.archivedAt === null;
    try {
      await archiveBot.mutateAsync({ botId: selectedBot.id, archived: nextArchived });
      toast.show(nextArchived ? `已归档「${selectedBot.name}」` : `已恢复「${selectedBot.name}」`, { variant: "info" });
      if (nextArchived) {
        isDirtyRef.current = false;
        loadedKeyRef.current = null;
        setSelectedId(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const handleOpenChat = async () => {
    if (!selectedBot || !navigation) return;
    try {
      const res = await openBotSession.mutateAsync({ botId: selectedBot.id });
      navigation.openAgent({ agentId: res.agentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开会话失败");
    }
  };

  const dark = isDarkTheme(theme);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 14 : 24, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: 680, gap: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <View style={{ gap: 2, flex: 1, minWidth: 180 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: theme.colors.foreground }}>Bot 团队管理</Text>
            <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>配置双脑主位与项目主管人设、目录及权限边界</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActionButton label={showArchived ? "隐藏归档" : "显示归档"} variant="secondary" theme={theme} onPress={() => setShowArchived((v) => !v)} />
            <ActionButton
              label="+ 新建 Bot"
              theme={theme}
              onPress={() => {
                isDirtyRef.current = false;
                loadedKeyRef.current = null;
                setSelectedId("new");
                setDraft(makeBlankDraft(usedColors, fallbackCwd));
              }}
            />
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {visibleBots.map((bot) => {
            const active = selectedId !== "new" && selectedBot?.id === bot.id;
            return (
              <Pressable
                key={bot.id}
                accessibilityRole="button"
                onPress={() => {
                  isDirtyRef.current = false;
                  loadedKeyRef.current = null;
                  setSelectedId(bot.id);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? `${bot.avatarColor}${dark ? "33" : "18"}` : theme.colors.surface1,
                  borderWidth: 1,
                  borderColor: active ? bot.avatarColor : theme.colors.border,
                  opacity: bot.archivedAt ? 0.55 : 1,
                }}
              >
                <Icon name={bot.iconName} size={14} color={dark && active ? theme.colors.foreground : bot.avatarColor} />
                <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>{bot.name}</Text>
                <RolePill label={roleLabel(bot.roleType)} color={bot.avatarColor} theme={theme} />
              </Pressable>
            );
          })}
          {isLoading && !snapshot ? (
            <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>加载中...</Text>
          ) : null}
        </View>

        <SurfaceCard theme={theme} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <BotAvatar
              iconName={draft.iconName}
              color={draft.avatarColor}
              size={44}
              showStar={draft.roleType !== "project_lead" || draft.pinned}
              borderColor={theme.colors.surface1}
              theme={theme}
            />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "700", color: theme.colors.foreground }}>
                {draft.name.trim() || "未命名 Bot"}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
                {draft.bio.trim() || roleLabel(draft.roleType)}
              </Text>
            </View>
          </View>
          {selectedBot && navigation ? (
            <ActionButton
              label={openBotSession.isPending ? "打开..." : "打开对话"}
              variant="secondary"
              disabled={openBotSession.isPending}
              theme={theme}
              onPress={() => void handleOpenChat()}
            />
          ) : null}
        </SurfaceCard>

        <BotFormSections
          draft={draft}
          sections={snapshot?.sections ?? []}
          creatingSection={upsertSection.isPending}
          theme={theme}
          onPatch={patchDraft}
          onRoleChange={handleRoleChange}
          onCreateSection={async (secName) => {
            try {
              const sec = await upsertSection.mutateAsync({ name: secName, collapsed: false, color: null });
              patchDraft({ sectionId: sec.id });
              toast.show(`已新建分组「${sec.name}」`, { variant: "success" });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "新建分组失败");
            }
          }}
        />

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 24 }}>
          {selectedBot ? (
            <ActionButton label={selectedBot.archivedAt ? "恢复启用" : "归档 Bot"} variant="danger" disabled={archiveBot.isPending} theme={theme} onPress={() => void handleArchiveToggle()} />
          ) : <View />}
          <ActionButton label={upsertBot.isPending ? "保存中..." : "保存配置"} disabled={upsertBot.isPending} theme={theme} onPress={() => void handleSave()} />
        </View>
      </View>
    </ScrollView>
  );
}
