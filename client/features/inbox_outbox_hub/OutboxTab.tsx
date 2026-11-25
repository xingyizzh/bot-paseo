import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  sortOutboxItems,
  type BotRecord,
  type ExecutionCapabilities,
  type OutboxItem,
  type OutboxKind,
} from "../../../shared/contracts";
import { useHubActions } from "../../core/hooks";
import { ActionButton, RolePill, SurfaceCard, semanticColor, type AppTheme } from "../../core/primitives";

function kindPresentation(kind: OutboxKind, theme: AppTheme): { label: string; color: string } {
  if (kind === "needs_decision") return { label: "待拍板", color: semanticColor(theme, "warning") };
  if (kind === "blocked") return { label: "阻塞中", color: semanticColor(theme, "danger") };
  return { label: "已交付", color: semanticColor(theme, "success") };
}

export function OutboxTab({
  items,
  bots,
  capabilities,
  navigation,
  theme,
}: {
  items: readonly OutboxItem[];
  bots: readonly BotRecord[];
  capabilities: ExecutionCapabilities;
  navigation: PluginScreenProps["navigation"];
  theme: AppTheme;
}) {
  const toast = useToast();
  const { ackOutbox, digestOutboxToButler } = useHubActions();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const botMap = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const sorted = useMemo(() => sortOutboxItems(items), [items]);
  const activeItems = useMemo(() => sorted.filter((i) => i.status !== "acked"), [sorted]);
  const ackedItems = useMemo(() => sorted.filter((i) => i.status === "acked"), [sorted]);
  const urgentCount = useMemo(
    () => activeItems.filter((i) => i.kind === "needs_decision" || i.kind === "blocked").length,
    [activeItems],
  );
  const deliveredCount = useMemo(
    () => activeItems.filter((i) => i.kind === "delivered").length,
    [activeItems],
  );

  const handleAck = async (item: OutboxItem) => {
    try {
      await ackOutbox.mutateAsync({ id: item.id });
      toast.show(`已确认收口「${item.title}」`, { variant: "success" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "确认失败");
    }
  };

  const handleDigestToButler = async () => {
    try {
      const res = await digestOutboxToButler.mutateAsync({});
      toast.show(`已交给管家整理汇报（${res.itemCount} 条）`, { variant: "success" });
      navigation?.openAgent({ agentId: res.agentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "交办管家整理失败");
    }
  };

  const renderCard = (item: OutboxItem) => {
    const badge = kindPresentation(item.kind, theme);
    const bot = item.botId ? botMap.get(item.botId) : undefined;
    const isAcked = item.status === "acked";

    return (
      <SurfaceCard key={item.id} theme={theme} style={{ gap: 10, opacity: isAcked ? 0.72 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <RolePill label={badge.label} color={badge.color} theme={theme} />
            {bot ? <RolePill label={bot.name} color={bot.avatarColor} theme={theme} /> : null}
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
          {capabilities.inspect && item.agentId && navigation ? (
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
      {activeItems.length > 0 ? (
        <SurfaceCard
          theme={theme}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <View style={{ flex: 1, minWidth: 200, gap: 3 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.foreground }}>
              管家统一整理汇报
            </Text>
            <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted, lineHeight: 18 }}>
              {`待拍板/阻塞 ${urgentCount} 条 · 已交付 ${deliveredCount} 条 · 仅提炼结论与拍板项，不刷屏工作过程`}
            </Text>
          </View>
          <ActionButton
            label={digestOutboxToButler.isPending ? "交办中..." : "让管家整理汇报"}
            disabled={digestOutboxToButler.isPending}
            theme={theme}
            onPress={() => void handleDigestToButler()}
          />
        </SurfaceCard>
      ) : null}

      {activeItems.length === 0 ? (
        <SurfaceCard theme={theme} style={{ alignItems: "center", paddingVertical: 28, gap: 6 }}>
          <Icon name="CheckCircle2" size={24} color={semanticColor(theme, "success")} />
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
