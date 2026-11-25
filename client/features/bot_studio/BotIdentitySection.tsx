import { SettingsCard, SettingsRow, SettingsSection, TextInput } from "@getpaseo/plugin/client/ui";
import { pickNextColor } from "../../../shared/avatars";
import type { BotPermissionMode, BotRecord, BotRoleType } from "../../../shared/contracts";
import { SegmentTabs, type AppTheme } from "../../core/primitives";

const ROLE_TABS: readonly { value: BotRoleType; label: string }[] = [
  { value: "project_lead", label: "项目主管" },
  { value: "butler", label: "管家总管" },
  { value: "companion", label: "陪伴主位" },
];

export interface BotFormDraft {
  id: string | null;
  name: string;
  roleType: BotRoleType;
  bio: string;
  personaPrompt: string;
  iconName: string;
  avatarColor: string;
  provider: string;
  defaultCwd: string;
  permissionMode: BotPermissionMode;
  sectionId: string | null;
  pinned: boolean;
}

export function makeDraftFromBot(bot: BotRecord): BotFormDraft {
  return {
    id: bot.id,
    name: bot.name,
    roleType: bot.roleType,
    bio: bot.bio,
    personaPrompt: bot.personaPrompt,
    iconName: bot.iconName,
    avatarColor: bot.avatarColor,
    provider: bot.provider,
    defaultCwd: bot.defaultCwd,
    permissionMode: bot.roleType === "companion" ? "readonly" : bot.permissionMode,
    sectionId: bot.sectionId,
    pinned: bot.pinned,
  };
}

export function makeBlankDraft(usedColors: readonly string[], fallbackCwd: string): BotFormDraft {
  return {
    id: null,
    name: "",
    roleType: "project_lead",
    bio: "",
    personaPrompt: "",
    iconName: "Compass",
    avatarColor: pickNextColor(usedColors),
    provider: "claude/sonnet",
    defaultCwd: fallbackCwd,
    permissionMode: "workspace",
    sectionId: null,
    pinned: false,
  };
}

export function BotIdentitySection({
  draft,
  theme,
  onPatch,
  onRoleChange,
}: {
  draft: BotFormDraft;
  theme: AppTheme;
  onPatch(patch: Partial<BotFormDraft>): void;
  onRoleChange(roleType: BotRoleType): void;
}) {
  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13.5,
  };

  return (
    <SettingsSection title="基础身份与人设">
      <SettingsCard>
        <SettingsRow label="显示名称">
          <TextInput
            value={draft.name}
            onChangeText={(name) => onPatch({ name })}
            placeholder="输入 Bot 名称"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={inputStyle}
          />
        </SettingsRow>
        <SettingsRow label="角色定位">
          <SegmentTabs<BotRoleType>
            options={ROLE_TABS}
            value={draft.roleType}
            onChange={onRoleChange}
            theme={theme}
          />
        </SettingsRow>
        <SettingsRow label="一句话简介" hint="展示在侧栏列表副标题（最多 160 字）">
          <TextInput
            value={draft.bio}
            onChangeText={(bio) => onPatch({ bio })}
            placeholder="例如：负责前端架构评审与子线程验收"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={inputStyle}
          />
        </SettingsRow>
        <SettingsRow label="Persona Prompt" hint="注入该 Bot 系统人格与协作边界">
          <TextInput
            value={draft.personaPrompt}
            onChangeText={(personaPrompt) => onPatch({ personaPrompt })}
            multiline
            numberOfLines={4}
            placeholder="定义该 Bot 的职责边界、回答风格与禁止事项..."
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{ ...inputStyle, minHeight: 96, textAlignVertical: "top" }}
          />
        </SettingsRow>
        <SettingsRow label="模型 Provider">
          <TextInput
            value={draft.provider}
            onChangeText={(provider) => onPatch({ provider })}
            placeholder="claude/sonnet"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={inputStyle}
          />
        </SettingsRow>
        <SettingsRow label="默认工作目录">
          <TextInput
            value={draft.defaultCwd}
            onChangeText={(defaultCwd) => onPatch({ defaultCwd })}
            placeholder="/path/to/workspace（留空使用默认工作区）"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={inputStyle}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
