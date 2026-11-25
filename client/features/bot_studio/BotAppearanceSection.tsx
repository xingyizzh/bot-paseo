import { Icon, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { AVATAR_PRESETS, CONTRAST_PALETTE } from "../../../shared/avatars";
import type { AppTheme } from "../../core/primitives";

export function BotAppearanceSection({
  iconName,
  avatarColor,
  onSelectIcon,
  onSelectColor,
  theme,
}: {
  iconName: string;
  avatarColor: string;
  onSelectIcon(name: string): void;
  onSelectColor(color: string): void;
  theme: AppTheme;
}) {
  return (
    <SettingsSection title="视觉形象">
      <SettingsCard>
        <SettingsRow label="图标徽章" hint="侧栏与详情抽屉显示的矢量图标">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
            {AVATAR_PRESETS.map((preset) => {
              const selected = preset.iconName === iconName;
              return (
                <Pressable
                  key={preset.iconName}
                  accessibilityRole="button"
                  onPress={() => onSelectIcon(preset.iconName)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 10,
                    backgroundColor: selected ? `${avatarColor}18` : theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: selected ? avatarColor : theme.colors.border,
                  }}
                >
                  <Icon
                    name={preset.iconName}
                    size={15}
                    color={selected ? avatarColor : theme.colors.foregroundMuted}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: selected ? "600" : "500",
                      color: selected ? theme.colors.foreground : theme.colors.foregroundMuted,
                    }}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SettingsRow>
        <SettingsRow label="专属配色" hint="自动避重后的高对比色板">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 4 }}>
            {CONTRAST_PALETTE.map((hex) => {
              const selected = hex === avatarColor;
              return (
                <Pressable
                  key={hex}
                  accessibilityRole="button"
                  onPress={() => onSelectColor(hex)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: hex,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: selected ? 2.5 : 0,
                    borderColor: theme.colors.foreground,
                  }}
                >
                  {selected ? <Icon name="Check" size={14} color="#FFFFFF" /> : null}
                </Pressable>
              );
            })}
          </View>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
