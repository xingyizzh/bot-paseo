import type {
  PluginClientContext,
  PluginScreenProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { ScrollView, SidebarRow, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useHubActions, useHubSnapshot } from "../../core/hooks";
import type { ClientFeature } from "../../core/kernel";
import { ActionButton, SegmentTabs } from "../../core/primitives";
import { InboxTab } from "./InboxTab";
import { OutboxTab } from "./OutboxTab";

type HubTab = "outbox" | "inbox";

function InboxOutboxNavItem({
  theme,
  currentScreen,
  openScreen,
}: PluginSidebarItemProps) {
  const { snapshot } = useHubSnapshot();
  const unackedOutbox = (snapshot?.outbox ?? []).filter((o) => o.status !== "acked").length;
  const openInbox = (snapshot?.inbox ?? []).filter(
    (i) => i.status !== "done" && i.status !== "dropped",
  ).length;
  const totalBadge = unackedOutbox + openInbox;

  return (
    <SidebarRow
      icon="Inbox"
      active={currentScreen?.screenId === "inbox-outbox"}
      onPress={() => openScreen({ screenId: "inbox-outbox" })}
      trailing={
        totalBadge > 0 ? (
          <View
            style={{
              minWidth: 20,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 6,
              backgroundColor: unackedOutbox > 0 ? theme.colors.statusWarning : theme.colors.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.accentForeground }}>
              {totalBadge}
            </Text>
          </View>
        ) : undefined
      }
    />
  );
}

function BotStudioNavItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Bot"
      active={currentScreen?.screenId === "bot-studio"}
      onPress={() => openScreen({ screenId: "bot-studio" })}
    />
  );
}

function InboxOutboxScreen({ theme, layout, navigation, params }: PluginScreenProps) {
  const toast = useToast();
  const { snapshot, isLoading } = useHubSnapshot();
  const { importHq } = useHubActions();
  const [tab, setTab] = useState<HubTab>(params.tab === "inbox" ? "inbox" : "outbox");

  useEffect(() => {
    if (params.tab === "inbox" || params.tab === "outbox") setTab(params.tab);
  }, [params.tab]);

  const unackedCount = (snapshot?.outbox ?? []).filter((o) => o.status !== "acked").length;
  const openInboxCount = (snapshot?.inbox ?? []).filter(
    (i) => i.status !== "done" && i.status !== "dropped",
  ).length;

  const handleImportHq = async () => {
    try {
      const res = await importHq.mutateAsync({});
      toast.show(
        `已导入 Personal HQ：Inbox ${res.importedInbox} 条，Outbox ${res.importedOutbox} 条`,
        { variant: "success" },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入 Personal HQ 失败");
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 14 : 24, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: 720, gap: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <View style={{ gap: 2, flex: 1, minWidth: 180 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: theme.colors.foreground }}>
              收发箱总控台
            </Text>
            <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>
              Outbox 注意力收口与 Inbox 原话锁存分诊
            </Text>
          </View>
          <ActionButton
            label={importHq.isPending ? "导入中..." : "导入 Personal HQ"}
            variant="secondary"
            disabled={importHq.isPending}
            theme={theme}
            onPress={() => void handleImportHq()}
          />
        </View>

        <SegmentTabs<HubTab>
          options={[
            { value: "outbox", label: `Outbox 收口 (${unackedCount})` },
            { value: "inbox", label: `Inbox 收件箱 (${openInboxCount})` },
          ]}
          value={tab}
          onChange={setTab}
          theme={theme}
        />

        {isLoading && !snapshot ? (
          <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted, paddingVertical: 16 }}>
            正在加载收发箱数据...
          </Text>
        ) : tab === "outbox" ? (
          <OutboxTab
            items={snapshot?.outbox ?? []}
            bots={snapshot?.bots ?? []}
            navigation={navigation}
            theme={theme}
          />
        ) : (
          <InboxTab
            items={snapshot?.inbox ?? []}
            bots={snapshot?.bots ?? []}
            navigation={navigation}
            theme={theme}
          />
        )}
      </View>
    </ScrollView>
  );
}

export const inboxOutboxHubFeature: ClientFeature = {
  manifest: {
    id: "inbox_outbox_hub",
    name: "Inbox / Outbox 收发箱总控台",
  },
  register(client: PluginClientContext) {
    const cleanups = [
      client.addScreen({
        id: "inbox-outbox",
        title: "Inbox & Outbox",
        Component: InboxOutboxScreen,
      }),
      client.addSidebarHeaderItem({
        id: "inbox-outbox-nav",
        title: "收发箱 Inbox / Outbox",
        Component: InboxOutboxNavItem,
      }),
      client.addSidebarHeaderItem({
        id: "bot-studio-nav",
        title: "Bot 团队管理",
        Component: BotStudioNavItem,
      }),
    ];

    return () => {
      while (cleanups.length > 0) {
        void cleanups.pop()?.();
      }
    };
  },
};
