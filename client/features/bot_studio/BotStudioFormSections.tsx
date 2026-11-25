import { Icon, SettingsCard, SettingsRow, SettingsSection, TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BotPermissionMode, BotRoleType, BotSection } from "../../../shared/contracts";
import { ActionButton, SegmentTabs, type AppTheme } from "../../core/primitives";

const PERMISSION_OPTIONS: readonly { value: BotPermissionMode; label: string }[] = [
  { value: "readonly", label: "readonly 只读" },
  { value: "workspace", label: "workspace 工作区" },
  { value: "full", label: "full 完全权限" },
];

export function BotPolicySection({
  roleType,
  permissionMode,
  onChangePermission,
  sectionId,
  onChangeSection,
  pinned,
  onTogglePinned,
  sections,
  onCreateSection,
  creatingSection,
  theme,
}: {
  roleType: BotRoleType;
  permissionMode: BotPermissionMode;
  onChangePermission(mode: BotPermissionMode): void;
  sectionId: string | null;
  onChangeSection(id: string | null): void;
  pinned: boolean;
  onTogglePinned(next: boolean): void;
  sections: readonly BotSection[];
  onCreateSection(name: string): Promise<void>;
  creatingSection: boolean;
  theme: AppTheme;
}) {
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const isCompanion = roleType === "companion";
  const isHeroRole = roleType === "butler" || roleType === "companion";

  const handleAddSection = async () => {
    const trimmed = newSectionName.trim();
    if (!trimmed) return;
    await onCreateSection(trimmed);
    setNewSectionName("");
    setNewSectionOpen(false);
  };

  return (
    <SettingsSection title="权限边界与分组">
      <SettingsCard>
        <SettingsRow
          label="执行权限"
          hint={
            isCompanion
              ? "陪伴主位已强制锁定为 readonly（只读隔离），不可访问工程代码或派发子线程。"
              : "控制该 Bot 默认绑定的 Paseo 会话工作权限"
          }
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
              options={PERMISSION_OPTIONS}
              value={permissionMode}
              onChange={onChangePermission}
              theme={theme}
            />
          )}
        </SettingsRow>

        <SettingsRow
          label="置顶至 Hero 主位区"
          hint={isHeroRole ? "总管与陪伴主位默认展示在侧栏顶部主位区" : "置顶后将与主位卡片并列展示"}
        >
          <Pressable
            accessibilityRole="button"
            disabled={isHeroRole}
            onPress={() => onTogglePinned(!pinned)}
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 999,
              backgroundColor: pinned || isHeroRole ? `${theme.colors.accent}1A` : theme.colors.surface2,
              borderWidth: 1,
              borderColor: pinned || isHeroRole ? theme.colors.accent : theme.colors.border,
              opacity: isHeroRole ? 0.7 : 1,
            }}
          >
            <Icon
              name={pinned || isHeroRole ? "Star" : "Circle"}
              size={14}
              color={pinned || isHeroRole ? theme.colors.accent : theme.colors.foregroundMuted}
            />
            <Text
              style={{
                fontSize: 12.5,
                fontWeight: "600",
                color: pinned || isHeroRole ? theme.colors.accent : theme.colors.foregroundMuted,
              }}
            >
              {pinned || isHeroRole ? "已置顶展示" : "常规列表展示"}
            </Text>
          </Pressable>
        </SettingsRow>

        {!isHeroRole && !pinned ? (
          <SettingsRow label="所属分组" hint="侧栏支持按分组折叠收纳项目主管">
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onChangeSection(null)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: sectionId === null ? theme.colors.accent : theme.colors.surface2,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: sectionId === null ? theme.colors.accentForeground : theme.colors.foreground,
                    }}
                  >
                    未分组
                  </Text>
                </Pressable>
                {sections.map((sec) => {
                  const selected = sectionId === sec.id;
                  return (
                    <Pressable
                      key={sec.id}
                      accessibilityRole="button"
                      onPress={() => onChangeSection(sec.id)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 999,
                        backgroundColor: selected ? theme.colors.accent : theme.colors.surface2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color: selected ? theme.colors.accentForeground : theme.colors.foreground,
                        }}
                      >
                        {sec.name}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setNewSectionOpen((v) => !v)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted }}>
                    + 新建分组
                  </Text>
                </Pressable>
              </View>
              {newSectionOpen ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TextInput
                    value={newSectionName}
                    onChangeText={setNewSectionName}
                    placeholder="分组名称（如：客户端、后端）"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface0,
                      color: theme.colors.foreground,
                      borderRadius: 9,
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      fontSize: 13,
                    }}
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
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
