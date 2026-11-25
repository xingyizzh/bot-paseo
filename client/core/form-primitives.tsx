import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import { Pressable, Text, View, type TextInputProps } from "react-native";
import { AVATAR_PRESETS, CONTRAST_PALETTE } from "../../shared/avatars";
import { isDarkTheme, type AppTheme } from "./primitives";

export function FieldGroup({
  label,
  hint,
  theme,
  children,
}: {
  label: string;
  hint?: string;
  theme: AppTheme;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.foreground }}>{label}</Text>
        {hint ? (
          <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted, lineHeight: 17 }}>{hint}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function FormInput({
  theme,
  multiline,
  style,
  placeholderTextColor,
  ...props
}: TextInputProps & { theme: AppTheme }) {
  return (
    <TextInput
      multiline={multiline}
      placeholderTextColor={placeholderTextColor ?? theme.colors.foregroundMuted}
      style={[
        {
          minWidth: 0,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
          color: theme.colors.foreground,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 9,
          fontSize: 13.5,
          ...(multiline ? { minHeight: 88, textAlignVertical: "top" as const } : {}),
        },
        style,
      ]}
      {...props}
    />
  );
}

export function CheckboxRow({
  checked,
  label,
  onToggle,
  theme,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onToggle(): void;
  theme: AppTheme;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onToggle}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, opacity: disabled ? 0.55 : 1 }}
    >
      <Icon
        name={checked ? "CheckSquare" : "Square"}
        size={16}
        color={checked ? theme.colors.accent : theme.colors.foregroundMuted}
      />
      <Text style={{ fontSize: 12.5, color: theme.colors.foreground, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function SelectChip({
  label,
  selected,
  onPress,
  theme,
  color,
  iconName,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  theme: AppTheme;
  color?: string;
  iconName?: string;
}) {
  const dark = isDarkTheme(theme);
  const bg = !selected ? theme.colors.surface2 : color ? `${color}${dark ? "33" : "1A"}` : theme.colors.accent;
  const borderColor = !selected ? theme.colors.border : (color ?? theme.colors.accent);
  const fg = !selected ? theme.colors.foregroundMuted : color ? theme.colors.foreground : theme.colors.accentForeground;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor,
      }}
    >
      {iconName ? <Icon name={iconName} size={13} color={selected && color ? color : fg} /> : null}
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "600", color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AvatarPicker({
  iconName,
  avatarColor,
  onSelectIcon,
  onSelectColor,
  theme,
  iconLimit,
}: {
  iconName: string;
  avatarColor: string;
  onSelectIcon(name: string): void;
  onSelectColor(color: string): void;
  theme: AppTheme;
  iconLimit?: number;
}) {
  const dark = isDarkTheme(theme);
  const presets = iconLimit ? AVATAR_PRESETS.slice(0, iconLimit) : AVATAR_PRESETS;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {presets.map((preset) => {
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
                paddingHorizontal: iconLimit ? 9 : 10,
                paddingVertical: 7,
                borderRadius: 10,
                backgroundColor: selected ? `${avatarColor}${dark ? "33" : "18"}` : theme.colors.surface2,
                borderWidth: 1,
                borderColor: selected ? avatarColor : theme.colors.border,
              }}
            >
              <Icon
                name={preset.iconName}
                size={15}
                color={selected ? (dark ? theme.colors.foreground : avatarColor) : theme.colors.foregroundMuted}
              />
              {!iconLimit ? (
                <Text style={{ fontSize: 12, fontWeight: selected ? "600" : "500", color: selected ? theme.colors.foreground : theme.colors.foregroundMuted }}>
                  {preset.label}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        {CONTRAST_PALETTE.map((hex) => {
          const selected = hex === avatarColor;
          return (
            <Pressable
              key={hex}
              accessibilityRole="button"
              onPress={() => onSelectColor(hex)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: hex,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: selected ? 2.5 : 0,
                borderColor: theme.colors.foreground,
              }}
            >
              {selected ? <Icon name="Check" size={13} color={theme.colors.accentForeground} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
