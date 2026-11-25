import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { roleLabel } from "../../../shared/avatars";
import type { BotRecord, BotRoleType } from "../../../shared/contracts";
import { ActionButton, BotAvatar, RolePill, type AppTheme } from "../../core/primitives";

export function BotTeamSwitcher({
  theme,
  visibleBots,
  selectedBotId,
  isCreatingNew,
  showArchived,
  isLoading,
  hasSnapshot,
  previewName,
  previewBio,
  previewRoleType,
  previewIcon,
  previewColor,
  previewPinned,
  canOpenChat,
  openingChat,
  onToggleArchived,
  onSelectBot,
  onStartNew,
  onOpenChat,
}: {
  theme: AppTheme;
  visibleBots: readonly BotRecord[];
  selectedBotId: string | null;
  isCreatingNew: boolean;
  showArchived: boolean;
  isLoading: boolean;
  hasSnapshot: boolean;
  previewName: string;
  previewBio: string;
  previewRoleType: BotRoleType;
  previewIcon: string;
  previewColor: string;
  previewPinned: boolean;
  canOpenChat: boolean;
  openingChat: boolean;
  onToggleArchived(): void;
  onSelectBot(botId: string): void;
  onStartNew(): void;
  onOpenChat(): void;
}) {
  return (
    <View style={{ gap: 14 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: theme.colors.foreground }}>
            Bot 团队管理
          </Text>
          <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>
            配置双脑主位与项目主管人设、目录及权限边界
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleArchived}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 9,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
              {showArchived ? "隐藏归档" : "显示归档"}
            </Text>
          </Pressable>
          <ActionButton label="+ 新建 Bot" theme={theme} onPress={onStartNew} />
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {visibleBots.map((bot) => {
          const active = !isCreatingNew && selectedBotId === bot.id;
          return (
            <Pressable
              key={bot.id}
              accessibilityRole="button"
              onPress={() => onSelectBot(bot.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 11,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: active ? `${bot.avatarColor}18` : theme.colors.surface1,
                borderWidth: 1,
                borderColor: active ? bot.avatarColor : theme.colors.border,
                opacity: bot.archivedAt ? 0.55 : 1,
              }}
            >
              <Icon name={bot.iconName} size={14} color={bot.avatarColor} />
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
                {bot.name}
              </Text>
              <RolePill
                label={roleLabel(bot.roleType)}
                color={bot.avatarColor}
                backgroundColor={`${bot.avatarColor}1A`}
              />
            </Pressable>
          );
        })}
        {isLoading && !hasSnapshot ? (
          <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>加载中...</Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 14,
          borderRadius: 14,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
          <BotAvatar
            iconName={previewIcon}
            color={previewColor}
            size={44}
            showStar={previewRoleType !== "project_lead" || previewPinned}
            borderColor={theme.colors.surface1}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: theme.colors.foreground }}>
              {previewName.trim() || "未命名 Bot"}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
              {previewBio.trim() || roleLabel(previewRoleType)}
            </Text>
          </View>
        </View>
        {canOpenChat ? (
          <ActionButton
            label={openingChat ? "打开..." : "打开对话"}
            variant="secondary"
            theme={theme}
            onPress={onOpenChat}
          />
        ) : null}
      </View>
    </View>
  );
}
