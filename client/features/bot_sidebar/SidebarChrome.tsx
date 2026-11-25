import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { FormInput } from "../../core/form-primitives";
import { useHubActions } from "../../core/hooks";
import { ActionButton, type AppTheme } from "../../core/primitives";

export function SidebarTopBar({
  theme,
  badgeCount,
  hasUrgentOutbox,
  onOpenInboxHub,
  onOpenCreateModal,
}: {
  theme: AppTheme;
  badgeCount: number;
  hasUrgentOutbox: boolean;
  onOpenInboxHub(): void;
  onOpenCreateModal(): void;
}) {
  const btnStyle = {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: "700", color: theme.colors.foreground }}>Paseo Bot</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="打开收发箱 Inbox Outbox" onPress={onOpenInboxHub} style={btnStyle}>
          <Icon name="Inbox" size={15} color={theme.colors.foreground} />
          {badgeCount > 0 ? (
            <View
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                minWidth: 14,
                height: 14,
                borderRadius: 7,
                paddingHorizontal: 3,
                backgroundColor: hasUrgentOutbox ? theme.colors.statusWarning : theme.colors.statusDanger,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.accentForeground }}>
                {badgeCount > 9 ? "9+" : String(badgeCount)}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="新建 Bot" onPress={onOpenCreateModal} style={btnStyle}>
          <Icon name="Plus" size={16} color={theme.colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

export function SidebarBottomBar({
  theme,
  openInboxCount,
  unackedOutboxCount,
  hasUrgentOutbox,
  onPress,
}: {
  theme: AppTheme;
  openInboxCount: number;
  unackedOutboxCount: number;
  hasUrgentOutbox: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>
          Inbox · {openInboxCount}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>/</Text>
        <Text
          numberOfLines={1}
          style={{ fontSize: 12, fontWeight: "600", color: hasUrgentOutbox ? theme.colors.statusWarning : theme.colors.foreground }}
        >
          Outbox · {unackedOutboxCount}
        </Text>
      </View>
      <Icon name="PenLine" size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export function QuickInboxCaptureModal({
  open,
  onOpenChange,
  openInboxCount,
  unackedOutboxCount,
  onOpenHub,
  theme,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  openInboxCount: number;
  unackedOutboxCount: number;
  onOpenHub(): void;
  theme: AppTheme;
}) {
  const toast = useToast();
  const { addInbox } = useHubActions();
  const [text, setText] = useState("");

  const handleSave = async () => {
    const rawText = text.trim();
    if (!rawText) {
      toast.error("请输入要记录的内容");
      return;
    }
    try {
      await addInbox.mutateAsync({ rawText, source: "user", tags: [] });
      setText("");
      toast.show("已原话锁存至 Inbox", { variant: "success" });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "写入 Inbox 失败");
    }
  };

  return (
    <Modal title="极速记录到 Inbox" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>
            当前待处理 Inbox {openInboxCount} 条 · 待收口 Outbox {unackedOutboxCount} 条
          </Text>
          <FormInput
            theme={theme}
            value={text}
            onChangeText={setText}
            multiline
            numberOfLines={3}
            placeholder="随手记下一句话想法、灵感或待派发需求，原话将只读锁存..."
            style={{ backgroundColor: theme.colors.surface1, borderRadius: 12, padding: 12 }}
          />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <ActionButton
              label="打开收发箱总控台"
              variant="secondary"
              theme={theme}
              onPress={() => { onOpenChange(false); onOpenHub(); }}
            />
            <ActionButton label={addInbox.isPending ? "保存中..." : "记住"} theme={theme} disabled={addInbox.isPending} onPress={() => void handleSave()} />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
