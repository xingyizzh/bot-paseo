import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AVATAR_PRESETS, CONTRAST_PALETTE, pickNextColor } from "../../../shared/avatars";
import type { BotPermissionMode, BotRoleType } from "../../../shared/contracts";
import { useHubActions } from "../../core/hooks";
import { ActionButton, SegmentTabs, type AppTheme } from "../../core/primitives";

const ROLE_OPTIONS: readonly { value: BotRoleType; label: string }[] = [
  { value: "project_lead", label: "项目主管" },
  { value: "butler", label: "管家总管" },
  { value: "companion", label: "陪伴主位" },
];

const PERM_OPTIONS: readonly { value: BotPermissionMode; label: string }[] = [
  { value: "readonly", label: "只读" },
  { value: "workspace", label: "工作区" },
  { value: "full", label: "完全" },
];

export function QuickCreateBotModal({
  open,
  onOpenChange,
  defaultCwd,
  usedColors,
  theme,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  defaultCwd: string;
  usedColors: readonly string[];
  theme: AppTheme;
}) {
  const toast = useToast();
  const { upsertBot } = useHubActions();
  const [name, setName] = useState("");
  const [roleType, setRoleType] = useState<BotRoleType>("project_lead");
  const [bio, setBio] = useState("");
  const [cwd, setCwd] = useState(defaultCwd);
  const [permissionMode, setPermissionMode] = useState<BotPermissionMode>("workspace");
  const [iconName, setIconName] = useState("Compass");
  const [avatarColor, setAvatarColor] = useState(() => pickNextColor(usedColors));

  const effectivePermission: BotPermissionMode =
    roleType === "companion" ? "readonly" : permissionMode;

  const handleRoleChange = (nextRole: BotRoleType) => {
    setRoleType(nextRole);
    if (nextRole === "butler") setIconName("Crown");
    else if (nextRole === "companion") {
      setIconName("Sparkles");
      setPermissionMode("readonly");
    } else setIconName("Compass");
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedCwd = cwd.trim() || defaultCwd;
    if (!trimmedName) {
      toast.error("请输入 Bot 名称");
      return;
    }
    try {
      await upsertBot.mutateAsync({
        name: trimmedName,
        roleType,
        bio: bio.trim(),
        personaPrompt: "",
        iconName,
        avatarColor,
        provider: "claude/sonnet",
        defaultCwd: trimmedCwd,
        permissionMode: effectivePermission,
        sectionId: null,
        pinned: roleType !== "project_lead",
      });
      toast.show(`已创建 ${trimmedName}`, { variant: "success" });
      setName("");
      setBio("");
      setAvatarColor(pickNextColor([...usedColors, avatarColor]));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建 Bot 失败");
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13.5,
  };

  return (
    <Modal title="新建 Bot" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
              角色定位
            </Text>
            <SegmentTabs<BotRoleType>
              options={ROLE_OPTIONS}
              value={roleType}
              onChange={handleRoleChange}
              theme={theme}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
              名称
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="例如：前端架构主管"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={inputStyle}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
              一句话简介
            </Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="职责范围或沟通风格"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={inputStyle}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
              默认工作目录
            </Text>
            <TextInput
              value={cwd}
              onChangeText={setCwd}
              placeholder="/path/to/workspace（留空使用默认工作区）"
              placeholderTextColor={theme.colors.foregroundMuted}
              style={inputStyle}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
              权限模式
            </Text>
            {roleType === "companion" ? (
              <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
                陪伴主位强制锁定为只读（readonly），严禁读写工程代码。
              </Text>
            ) : (
              <SegmentTabs<BotPermissionMode>
                options={PERM_OPTIONS}
                value={effectivePermission}
                onChange={setPermissionMode}
                theme={theme}
              />
            )}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
              图标与主题色
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {AVATAR_PRESETS.slice(0, 8).map((preset) => {
                const selected = preset.iconName === iconName;
                return (
                  <Pressable
                    key={preset.iconName}
                    accessibilityRole="button"
                    onPress={() => setIconName(preset.iconName)}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selected ? `${avatarColor}1F` : theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: selected ? avatarColor : theme.colors.border,
                    }}
                  >
                    <Icon
                      name={preset.iconName}
                      size={16}
                      color={selected ? avatarColor : theme.colors.foregroundMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CONTRAST_PALETTE.map((hex) => {
                const selected = hex === avatarColor;
                return (
                  <Pressable
                    key={hex}
                    accessibilityRole="button"
                    onPress={() => setAvatarColor(hex)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: hex,
                      borderWidth: selected ? 2.5 : 0,
                      borderColor: theme.colors.foreground,
                    }}
                  />
                );
              })}
            </View>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <ActionButton
              label="取消"
              variant="secondary"
              theme={theme}
              onPress={() => onOpenChange(false)}
            />
            <ActionButton
              label={upsertBot.isPending ? "创建中..." : "创建 Bot"}
              theme={theme}
              disabled={upsertBot.isPending}
              onPress={() => void handleSubmit()}
            />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
