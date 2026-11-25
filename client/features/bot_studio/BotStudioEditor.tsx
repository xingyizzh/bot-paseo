import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { BotRoleType } from "../../../shared/contracts";
import { useHubActions, useHubSnapshot } from "../../core/hooks";
import { ActionButton } from "../../core/primitives";
import { BotAppearanceSection } from "./BotAppearanceSection";
import {
  BotIdentitySection,
  makeBlankDraft,
  makeDraftFromBot,
  type BotFormDraft,
} from "./BotIdentitySection";
import { BotPolicySection } from "./BotStudioFormSections";
import { BotTeamSwitcher } from "./BotTeamSwitcher";

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

  const [draft, setDraft] = useState<BotFormDraft>(() => makeBlankDraft([], ""));

  useEffect(() => {
    if (initialBotId) setSelectedId(initialBotId);
  }, [initialBotId]);

  useEffect(() => {
    if (selectedId === "new") return;
    if (selectedBot) setDraft(makeDraftFromBot(selectedBot));
  }, [selectedBot, selectedId]);

  const patchDraft = (patch: Partial<BotFormDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleRoleChange = (roleType: BotRoleType) => {
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
      toast.show(nextArchived ? `已归档「${selectedBot.name}」` : `已恢复「${selectedBot.name}」`, {
        variant: "info",
      });
      if (nextArchived) setSelectedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const handleOpenChat = async () => {
    if (!selectedBot) return;
    try {
      const res = await openBotSession.mutateAsync({ botId: selectedBot.id });
      navigation?.openAgent({ agentId: res.agentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开会话失败");
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 14 : 24, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: 680, gap: 18 }}>
        <BotTeamSwitcher
          theme={theme}
          visibleBots={visibleBots}
          selectedBotId={selectedBot?.id ?? null}
          isCreatingNew={selectedId === "new"}
          showArchived={showArchived}
          isLoading={isLoading}
          hasSnapshot={Boolean(snapshot)}
          previewName={draft.name}
          previewBio={draft.bio}
          previewRoleType={draft.roleType}
          previewIcon={draft.iconName}
          previewColor={draft.avatarColor}
          previewPinned={draft.pinned}
          canOpenChat={Boolean(selectedBot && navigation)}
          openingChat={openBotSession.isPending}
          onToggleArchived={() => setShowArchived((v) => !v)}
          onSelectBot={(id) => setSelectedId(id)}
          onStartNew={() => {
            setSelectedId("new");
            setDraft(makeBlankDraft(usedColors, fallbackCwd));
          }}
          onOpenChat={() => void handleOpenChat()}
        />

        <BotIdentitySection
          draft={draft}
          theme={theme}
          onPatch={patchDraft}
          onRoleChange={handleRoleChange}
        />

        <BotAppearanceSection
          iconName={draft.iconName}
          avatarColor={draft.avatarColor}
          onSelectIcon={(iconName) => patchDraft({ iconName })}
          onSelectColor={(avatarColor) => patchDraft({ avatarColor })}
          theme={theme}
        />

        <BotPolicySection
          roleType={draft.roleType}
          permissionMode={draft.permissionMode}
          onChangePermission={(permissionMode) => patchDraft({ permissionMode })}
          sectionId={draft.sectionId}
          onChangeSection={(sectionId) => patchDraft({ sectionId })}
          pinned={draft.pinned}
          onTogglePinned={(pinned) => patchDraft({ pinned })}
          sections={snapshot?.sections ?? []}
          creatingSection={upsertSection.isPending}
          onCreateSection={async (secName) => {
            try {
              const sec = await upsertSection.mutateAsync({
                name: secName,
                collapsed: false,
                color: null,
              });
              patchDraft({ sectionId: sec.id });
              toast.show(`已新建分组「${sec.name}」`, { variant: "success" });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "新建分组失败");
            }
          }}
          theme={theme}
        />

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 24 }}>
          {selectedBot ? (
            <ActionButton
              label={selectedBot.archivedAt ? "恢复启用" : "归档 Bot"}
              variant="danger"
              disabled={archiveBot.isPending}
              theme={theme}
              onPress={() => void handleArchiveToggle()}
            />
          ) : (
            <View />
          )}
          <ActionButton
            label={upsertBot.isPending ? "保存中..." : "保存配置"}
            disabled={upsertBot.isPending}
            theme={theme}
            onPress={() => void handleSave()}
          />
        </View>
      </View>
    </ScrollView>
  );
}
