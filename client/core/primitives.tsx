import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

export type AppTheme = PluginHostProps["theme"];

function parseHexLuminance(hex: string): number | null {
  const m = hex.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const num = Number.parseInt(m[1], 16);
  return (0.299 * ((num >> 16) & 0xff) + 0.587 * ((num >> 8) & 0xff) + 0.114 * (num & 0xff)) / 255;
}

export function isDarkTheme(theme: AppTheme): boolean {
  const bg = theme.colors.surface0.trim().toLowerCase();
  if (bg === "#111113") return true;
  const lum = parseHexLuminance(bg);
  return lum !== null && lum < 0.5;
}

export function semanticColor(theme: AppTheme, tone: "warning" | "danger" | "success"): string {
  const dark = isDarkTheme(theme);
  if (tone === "warning") return dark ? "#F59E0B" : "#D97706";
  if (tone === "danger") return dark ? "#F87171" : "#DC2626";
  return dark ? "#34D399" : "#16A34A";
}

export interface BotAvatarProps {
  iconName: string;
  color: string;
  size?: number;
  showStar?: boolean;
  dotColor?: string | null;
  borderColor?: string;
  theme?: AppTheme;
}

export function BotAvatar({
  iconName,
  color,
  size = 36,
  showStar = false,
  dotColor = null,
  borderColor,
  theme,
}: BotAvatarProps) {
  const iconSize = Math.round(size * 0.48);
  const badgeSize = Math.max(12, Math.round(size * 0.34));
  const resolvedBorder = borderColor ?? theme?.colors.surface0 ?? "#FFFFFF";
  const starBg = theme ? semanticColor(theme, "warning") : "#D97706";
  const starFg = "#FFFFFF";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${color}1A`, borderWidth: 1, borderColor: `${color}40`, alignItems: "center", justifyContent: "center" }}>
      <Icon name={iconName} size={iconSize} color={color} />
      {showStar ? (
        <View style={{ position: "absolute", right: -2, bottom: -2, width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: starBg, borderWidth: 1.5, borderColor: resolvedBorder, alignItems: "center", justifyContent: "center" }}>
          <Icon name="Star" size={Math.round(badgeSize * 0.58)} color={starFg} />
        </View>
      ) : null}
      {!showStar && dotColor ? (
        <View style={{ position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: dotColor, borderWidth: 1.5, borderColor: resolvedBorder }} />
      ) : null}
    </View>
  );
}

export function RolePill({
  label,
  color,
  theme,
  backgroundColor,
}: {
  label: string;
  color: string;
  theme: AppTheme;
  backgroundColor?: string;
}) {
  const dark = isDarkTheme(theme);
  const isHex = /^#[0-9a-fA-F]{6}$/.test(color.trim());
  const fill = dark
    ? isHex ? `${color}33` : (backgroundColor ?? theme.colors.surface2)
    : (backgroundColor ?? (isHex ? `${color}1A` : theme.colors.surface2));
  const borderColor = dark ? (isHex ? `${color}66` : theme.colors.border) : "transparent";
  const textColor = dark ? theme.colors.foreground : color;

  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: fill,
        borderWidth: dark ? 1 : 0,
        borderColor,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: textColor }}>
        {label}
      </Text>
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
    <View style={{ flexDirection: "row", backgroundColor: theme.colors.surface2, borderRadius: 10, padding: 3, gap: 4 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1,
              minWidth: 0,
              paddingVertical: 6,
              paddingHorizontal: 8,
              borderRadius: 8,
              alignItems: "center",
              backgroundColor: active ? theme.colors.surface0 : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
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
  const bg = variant === "primary" ? theme.colors.accent : variant === "danger" ? semanticColor(theme, "danger") : theme.colors.surface2;
  const fg = variant === "secondary" ? theme.colors.foreground : "#FFFFFF";
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
      <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "600", color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}
