import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BotRecord, OutboxItem, OutboxKind } from "../../../shared/contracts";
import { useHubActions } from "../../core/hooks";
import { ActionButton, RolePill, SurfaceCard, type AppTheme } from "../../core/primitives";

const KIND_ORDER: Record<OutboxKind, number> = {
  needs_decision: 0,
  blocked: 1,
  delivered: 2,
};

function kindPresentation(kind: OutboxKind, theme: AppTheme): { label: string; color: string } {
  if (kind === "needs_decision") return { label: "待拍板", color: "#D97706" };
  if (kind === "blocked") return { label: "阻塞中", color: theme.colors.statusDanger };
  return { label: "已交付", color: theme.colors.statusSuccess };
}

function sortOutboxItems(items: readonly OutboxItem[]): OutboxItem[] {
  return [...items].sort((a, b) => {
    const ackDiff = Number(a.status === "acked") - Number(b.status === "acked");
    if (ackDiff !== 0) return ackDiff;
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kindDiff !== 0) return kindDiff;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function OutboxTab({
  items,
  bots,
  navigation,
  theme,
}: {
  items: readonly OutboxItem[];
  bots: readonly BotRecord[];
  navigation: PluginScreenProps["navigation"];
  theme: AppTheme;
}) {
  const toast = useToast();
  const { ackOutbox } = useHubActions();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const botMap = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const sorted = useMemo(() => sortOutboxItems(items), [items]);
  const activeItems = useMemo(() => sorted.filter((i) => i.status !== "acked"), [sorted]);
  const ackedItems = useMemo(() => sorted.filter((i) => i.status === "acked"), [sorted]);

  const handleAck = async (item: OutboxItem) => {
    try {
      await ackOutbox.mutateAsync({ id: item.id });
      toast.show(`已确认收口「${item.title}」`, { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "确认失败");
    }
  };

  const renderCard = (item: OutboxItem) => {
    const badge = kindPresentation(item.kind, theme);
    const bot = item.botId ? botMap.get(item.botId) : undefined;
    const isAcked = item.status === "acked";

    return (
      <SurfaceCard key={item.id} theme={theme} style={{ gap: 10, opacity: isAcked ? 0.72 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
            <RolePill label={badge.label} color={badge.color} backgroundColor={`${badge.color}1C`} />
            {bot ? (
              <RolePill
                label={bot.name}
                color={bot.avatarColor}
                backgroundColor={`${bot.avatarColor}18`}
              />
            ) : null}
          </View>
          <Text style={{ fontSize: 11.5, color: theme.colors.foregroundMuted }}>
            {item.createdAt.slice(0, 16).replace("T", " ")}
          </Text>
        </View>

        <Text style={{ fontSize: 14.5, fontWeight: "700", color: theme.colors.foreground }}>
          {item.title}
        </Text>
        <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted, lineHeight: 19 }}>
          {item.summary}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {item.agentId && navigation ? (
            <ActionButton
              label="穿透原线程"
              variant="secondary"
              theme={theme}
              onPress={() => navigation.openAgent({ agentId: item.agentId ?? "" })}
            />
          ) : null}
          {!isAcked ? (
            <ActionButton
              label={ackOutbox.isPending ? "处理中..." : "确认已阅"}
              disabled={ackOutbox.isPending}
              theme={theme}
              onPress={() => void handleAck(item)}
            />
          ) : null}
        </View>
      </SurfaceCard>
    );
  };

  return (
    <View style={{ gap: 12 }}>
      {activeItems.length === 0 ? (
        <SurfaceCard theme={theme} style={{ alignItems: "center", paddingVertical: 28, gap: 6 }}>
          <Icon name="CheckCircle2" size={24} color={theme.colors.statusSuccess} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: theme.colors.foreground }}>
            Outbox 已清零
          </Text>
          <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>
            当前没有待拍板、阻塞或未确认交付的结果
          </Text>
        </SurfaceCard>
      ) : (
        activeItems.map(renderCard)
      )}

      {ackedItems.length > 0 ? (
        <View style={{ gap: 10, marginTop: 6 }}>
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
              已确认归档 ({ackedItems.length})
            </Text>
          </Pressable>
          {archiveOpen ? ackedItems.map(renderCard) : null}
        </View>
      ) : null}
    </View>
  );
}
