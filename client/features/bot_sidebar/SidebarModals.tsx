import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { useHubActions } from "../../core/hooks";
import { ActionButton, type AppTheme } from "../../core/primitives";

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
      await addInbox.mutateAsync({
        rawText,
        source: "user",
        tags: [],
      });
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
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            numberOfLines={3}
            placeholder="随手记下一句话想法、灵感或待派发需求，原话将只读锁存..."
            placeholderTextColor={theme.colors.foregroundMuted}
            onSubmitEditing={() => void handleSave()}
            style={{
              minHeight: 88,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              color: theme.colors.foreground,
              borderRadius: 12,
              padding: 12,
              fontSize: 13.5,
              textAlignVertical: "top",
            }}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ActionButton
              label="打开收发箱总控台"
              variant="secondary"
              theme={theme}
              onPress={() => {
                onOpenChange(false);
                onOpenHub();
              }}
            />
            <ActionButton
              label={addInbox.isPending ? "保存中..." : "记住"}
              theme={theme}
              disabled={addInbox.isPending}
              onPress={() => void handleSave()}
            />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
