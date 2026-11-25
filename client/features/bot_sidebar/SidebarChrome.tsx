import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import type { AppTheme } from "../../core/primitives";
import { DOT_ATTENTION } from "./SidebarCards";

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
      <Text style={{ fontSize: 15, fontWeight: "700", color: theme.colors.foreground }}>
        Paseo Bot
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开收发箱 Inbox Outbox"
          onPress={onOpenInboxHub}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
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
                backgroundColor: hasUrgentOutbox ? DOT_ATTENTION : theme.colors.statusDanger,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: "700", color: "#FFFFFF" }}>
                {badgeCount > 9 ? "9+" : String(badgeCount)}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新建 Bot"
          onPress={onOpenCreateModal}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>
          Inbox · {openInboxCount}
        </Text>
        <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>/</Text>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "600",
            color: hasUrgentOutbox ? DOT_ATTENTION : theme.colors.foreground,
          }}
        >
          Outbox · {unackedOutboxCount}
        </Text>
      </View>
      <Icon name="PenLine" size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}
