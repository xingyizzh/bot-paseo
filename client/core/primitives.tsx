import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

export type AppTheme = PluginHostProps["theme"];

export interface BotAvatarProps {
  iconName: string;
  color: string;
  size?: number;
  showStar?: boolean;
  dotColor?: string | null;
  borderColor?: string;
}

export function BotAvatar({
  iconName,
  color,
  size = 36,
  showStar = false,
  dotColor = null,
  borderColor = "#FFFFFF",
}: BotAvatarProps) {
  const iconSize = Math.round(size * 0.48);
  const badgeSize = Math.max(12, Math.round(size * 0.34));
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `${color}1A`,
        borderWidth: 1,
        borderColor: `${color}40`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={iconName} size={iconSize} color={color} />
      {showStar ? (
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: "#F59E0B",
            borderWidth: 1.5,
            borderColor,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="Star" size={Math.round(badgeSize * 0.58)} color="#FFFFFF" />
        </View>
      ) : null}
      {!showStar && dotColor ? (
        <View
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: dotColor,
            borderWidth: 1.5,
            borderColor,
          }}
        />
      ) : null}
    </View>
  );
}

export function RolePill({
  label,
  color,
  backgroundColor,
}: {
  label: string;
  color: string;
  backgroundColor: string;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color }}>{label}</Text>
    </View>
  );
}

export function SurfaceCard({
  theme,
  children,
  style,
}: {
  theme: AppTheme;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 14,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SegmentTabs<Value extends string>({
  options,
  value,
  onChange,
  theme,
}: {
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange(value: Value): void;
  theme: AppTheme;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: theme.colors.surface2,
        borderRadius: 10,
        padding: 3,
        gap: 4,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 8,
              alignItems: "center",
              backgroundColor: active ? theme.colors.surface0 : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 12.5,
                fontWeight: active ? "600" : "500",
                color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  theme,
  variant = "primary",
  disabled = false,
}: {
  label: string;
  onPress(): void;
  theme: AppTheme;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const bg =
    variant === "primary"
      ? theme.colors.accent
      : variant === "danger"
        ? theme.colors.statusDanger
        : theme.colors.surface2;
  const fg = variant === "secondary" ? theme.colors.foreground : theme.colors.accentForeground;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 9,
        backgroundColor: bg,
        opacity: disabled ? 0.5 : 1,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: fg }}>{label}</Text>
    </Pressable>
  );
}
