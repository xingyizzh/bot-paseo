import { Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { pickNextColor } from "../../../shared/avatars";
import {
  BOT_PERMISSION_OPTIONS,
  BOT_ROLE_OPTIONS,
  type BotPermissionMode,
  type BotRoleType,
} from "../../../shared/contracts";
import { AvatarPicker, FieldGroup, FormInput } from "../../core/form-primitives";
import { useHubActions } from "../../core/hooks";
import { ActionButton, SegmentTabs, type AppTheme } from "../../core/primitives";

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
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!wasOpen && open) {
      setName("");
      setRoleType("project_lead");
      setBio("");
      setCwd(defaultCwd);
      setPermissionMode("workspace");
      setIconName("Compass");
      setAvatarColor(pickNextColor(usedColors));
    }
  }, [defaultCwd, open, usedColors]);

  const effectivePermission: BotPermissionMode = roleType === "companion" ? "readonly" : permissionMode;

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
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建 Bot 失败");
    }
  };

  return (
    <Modal title="新建 Bot" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <View style={{ gap: 14 }}>
          <FieldGroup label="角色定位" theme={theme}>
            <SegmentTabs<BotRoleType> options={BOT_ROLE_OPTIONS} value={roleType} onChange={handleRoleChange} theme={theme} />
          </FieldGroup>
          <FieldGroup label="名称" theme={theme}>
            <FormInput theme={theme} value={name} onChangeText={setName} placeholder="例如：前端架构主管" style={{ backgroundColor: theme.colors.surface1 }} />
          </FieldGroup>
          <FieldGroup label="一句话简介" theme={theme}>
            <FormInput theme={theme} value={bio} onChangeText={setBio} placeholder="职责范围或沟通风格" style={{ backgroundColor: theme.colors.surface1 }} />
          </FieldGroup>
          <FieldGroup label="默认工作目录" theme={theme}>
            <FormInput theme={theme} value={cwd} onChangeText={setCwd} placeholder="/path/to/workspace（留空使用默认工作区）" style={{ backgroundColor: theme.colors.surface1 }} />
          </FieldGroup>
          <FieldGroup label="权限模式" theme={theme}>
            {roleType === "companion" ? (
              <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
                陪伴主位强制锁定为只读（readonly），严禁读写工程代码。
              </Text>
            ) : (
              <SegmentTabs<BotPermissionMode> options={BOT_PERMISSION_OPTIONS} value={effectivePermission} onChange={setPermissionMode} theme={theme} />
            )}
          </FieldGroup>
          <FieldGroup label="图标与主题色" theme={theme}>
            <AvatarPicker iconName={iconName} avatarColor={avatarColor} onSelectIcon={setIconName} onSelectColor={setAvatarColor} theme={theme} iconLimit={8} />
          </FieldGroup>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
            <ActionButton label="取消" variant="secondary" theme={theme} onPress={() => onOpenChange(false)} />
            <ActionButton label={upsertBot.isPending ? "创建中..." : "创建 Bot"} theme={theme} disabled={upsertBot.isPending} onPress={() => void handleSubmit()} />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
