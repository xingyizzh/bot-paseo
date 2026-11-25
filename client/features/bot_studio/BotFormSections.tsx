import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { pickNextColor } from "../../../shared/avatars";
import {
  BOT_PERMISSION_OPTIONS,
  BOT_ROLE_OPTIONS,
  type BotPermissionMode,
  type BotRecord,
  type BotRoleType,
  type BotSection,
} from "../../../shared/contracts";
import { AvatarPicker, CheckboxRow, FieldGroup, FormInput, SelectChip } from "../../core/form-primitives";
import { ActionButton, SegmentTabs, SurfaceCard, type AppTheme } from "../../core/primitives";

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

export function BotFormSections({
  draft,
  sections,
  creatingSection,
  theme,
  onPatch,
  onRoleChange,
  onCreateSection,
}: {
  draft: BotFormDraft;
  sections: readonly BotSection[];
  creatingSection: boolean;
  theme: AppTheme;
  onPatch(patch: Partial<BotFormDraft>): void;
  onRoleChange(roleType: BotRoleType): void;
  onCreateSection(name: string): Promise<void>;
}) {
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const isCompanion = draft.roleType === "companion";
  const isHeroRole = draft.roleType === "butler" || draft.roleType === "companion";

  const handleAddSection = async () => {
    const trimmed = newSectionName.trim();
    if (!trimmed) return;
    await onCreateSection(trimmed);
    setNewSectionName("");
    setNewSectionOpen(false);
  };

  return (
    <View style={{ gap: 16 }}>
      <SurfaceCard theme={theme} style={{ gap: 14 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: theme.colors.foreground }}>基础身份与人设</Text>
        <FieldGroup label="显示名称" theme={theme}>
          <FormInput theme={theme} value={draft.name} onChangeText={(name) => onPatch({ name })} placeholder="输入 Bot 名称" />
        </FieldGroup>
        <FieldGroup label="角色定位" theme={theme}>
          <SegmentTabs<BotRoleType> options={BOT_ROLE_OPTIONS} value={draft.roleType} onChange={onRoleChange} theme={theme} />
        </FieldGroup>
        <FieldGroup label="一句话简介" hint="展示在侧栏列表副标题（最多 160 字）" theme={theme}>
          <FormInput theme={theme} value={draft.bio} onChangeText={(bio) => onPatch({ bio })} placeholder="例如：负责前端架构评审与子线程验收" />
        </FieldGroup>
        <FieldGroup label="Persona Prompt" hint="注入该 Bot 系统人格与协作边界" theme={theme}>
          <FormInput
            theme={theme}
            value={draft.personaPrompt}
            onChangeText={(personaPrompt) => onPatch({ personaPrompt })}
            multiline
            numberOfLines={4}
            placeholder="定义该 Bot 的职责边界、回答风格与禁止事项..."
            style={{ minHeight: 96 }}
          />
        </FieldGroup>
        <FieldGroup label="模型 Provider" theme={theme}>
          <FormInput theme={theme} value={draft.provider} onChangeText={(provider) => onPatch({ provider })} placeholder="claude/sonnet" />
        </FieldGroup>
        <FieldGroup label="默认工作目录" theme={theme}>
          <FormInput
            theme={theme}
            value={draft.defaultCwd}
            onChangeText={(defaultCwd) => onPatch({ defaultCwd })}
            placeholder="/path/to/workspace（留空使用默认工作区）"
          />
        </FieldGroup>
      </SurfaceCard>

      <SurfaceCard theme={theme} style={{ gap: 14 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: theme.colors.foreground }}>视觉形象</Text>
        <FieldGroup label="图标徽章与专属配色" hint="侧栏与详情抽屉显示的矢量图标及高对比色板" theme={theme}>
          <AvatarPicker
            iconName={draft.iconName}
            avatarColor={draft.avatarColor}
            onSelectIcon={(iconName) => onPatch({ iconName })}
            onSelectColor={(avatarColor) => onPatch({ avatarColor })}
            theme={theme}
          />
        </FieldGroup>
      </SurfaceCard>

      <SurfaceCard theme={theme} style={{ gap: 14 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: theme.colors.foreground }}>权限边界与分组</Text>
        <FieldGroup
          label="执行权限"
          hint={
            isCompanion
              ? "陪伴主位已强制锁定为 readonly（只读隔离），不可访问工程代码或派发子线程。"
              : "控制该 Bot 默认绑定的 Paseo 会话工作权限"
          }
          theme={theme}
        >
          {isCompanion ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Icon name="Lock" size={14} color={theme.colors.foregroundMuted} />
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.foreground }}>
                readonly（陪伴位自动锁定）
              </Text>
            </View>
          ) : (
            <SegmentTabs<BotPermissionMode>
              options={BOT_PERMISSION_OPTIONS}
              value={draft.permissionMode}
              onChange={(permissionMode) => onPatch({ permissionMode })}
              theme={theme}
            />
          )}
        </FieldGroup>

        <FieldGroup
          label="置顶至 Hero 主位区"
          hint={isHeroRole ? "总管与陪伴主位默认展示在侧栏顶部主位区" : "置顶后将与主位卡片并列展示"}
          theme={theme}
        >
          <CheckboxRow
            checked={draft.pinned || isHeroRole}
            disabled={isHeroRole}
            label={draft.pinned || isHeroRole ? "已置顶展示在 Hero 主位区" : "常规列表展示"}
            onToggle={() => onPatch({ pinned: !draft.pinned })}
            theme={theme}
          />
        </FieldGroup>

        {!isHeroRole && !draft.pinned ? (
          <FieldGroup label="所属分组" hint="侧栏支持按分组折叠收纳项目主管" theme={theme}>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <SelectChip label="未分组" selected={draft.sectionId === null} onPress={() => onPatch({ sectionId: null })} theme={theme} />
                {sections.map((sec) => (
                  <SelectChip key={sec.id} label={sec.name} selected={draft.sectionId === sec.id} onPress={() => onPatch({ sectionId: sec.id })} theme={theme} />
                ))}
                <SelectChip label="+ 新建分组" selected={newSectionOpen} onPress={() => setNewSectionOpen((v) => !v)} theme={theme} />
              </View>
              {newSectionOpen ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <FormInput
                    theme={theme}
                    value={newSectionName}
                    onChangeText={setNewSectionName}
                    placeholder="分组名称（如：客户端、后端）"
                    style={{ flex: 1, minWidth: 0, paddingVertical: 7, fontSize: 13 }}
                  />
                  <ActionButton
                    label={creatingSection ? "创建..." : "添加"}
                    disabled={creatingSection}
                    theme={theme}
                    onPress={() => void handleAddSection()}
                  />
                </View>
              ) : null}
            </View>
          </FieldGroup>
        ) : null}
      </SurfaceCard>
    </View>
  );
}
