import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import type { BotRecord, DispatchedThread, ThreadMessageDigest } from "../../../shared/contracts";
import { ActionButton, RolePill, SurfaceCard, type AppTheme } from "../../core/primitives";

export interface InspectPreviewState {
  loading: boolean;
  error: string | null;
  status: string;
  digests: readonly ThreadMessageDigest[];
}

export function BotDetailsTabContent({
  bot,
  agentModel,
  theme,
  onEdit,
}: {
  bot: BotRecord;
  agentModel: string | null;
  theme: AppTheme;
  onEdit(): void;
}) {
  return (
    <SurfaceCard theme={theme} style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.colors.foregroundMuted }}>
          简介
        </Text>
        <Text style={{ fontSize: 13, color: theme.colors.foreground, lineHeight: 19 }}>
          {bot.bio || "暂无简介"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.colors.foregroundMuted }}>
            模型 / Provider
          </Text>
          <Text style={{ fontSize: 12.5, color: theme.colors.foreground }}>
            {agentModel ? `${bot.provider} (${agentModel})` : bot.provider}
          </Text>
        </View>
        <View style={{ gap: 3, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.colors.foregroundMuted }}>
            权限模式
          </Text>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.colors.accent }}>
            {bot.permissionMode}
          </Text>
        </View>
      </View>
      <View style={{ gap: 3 }}>
        <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.colors.foregroundMuted }}>
          默认工作目录
        </Text>
        <Text style={{ fontSize: 12.5, color: theme.colors.foreground }}>{bot.defaultCwd}</Text>
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.colors.foregroundMuted }}>
          人设提示词预览
        </Text>
        <View style={{ backgroundColor: theme.colors.surface2, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted, lineHeight: 18 }}>
            {bot.personaPrompt || "未设置人设提示词"}
          </Text>
        </View>
      </View>
      <ActionButton label="编辑 Bot 配置" variant="secondary" theme={theme} onPress={onEdit} />
    </SurfaceCard>
  );
}

export function BotThreadsTabContent({
  threads,
  expandedThreadId,
  inspectCache,
  canNavigate,
  theme,
  onOpenAgent,
  onToggleInspect,
}: {
  threads: readonly DispatchedThread[];
  expandedThreadId: string | null;
  inspectCache: Readonly<Record<string, InspectPreviewState>>;
  canNavigate: boolean;
  theme: AppTheme;
  onOpenAgent(agentId: string): void;
  onToggleInspect(agentId: string): void;
}) {
  if (threads.length === 0) {
    return (
      <SurfaceCard theme={theme}>
        <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}>
          暂无由该 Bot 派发的关联线程。
        </Text>
      </SurfaceCard>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {threads.map((t) => {
        const expanded = expandedThreadId === t.agentId;
        const preview = inspectCache[t.agentId];
        return (
          <SurfaceCard key={t.agentId} theme={theme} style={{ gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenAgent(t.agentId)}
              style={{ gap: 4 }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 13.5, fontWeight: "600", color: theme.colors.foreground }}
                >
                  {t.title}
                </Text>
                <RolePill
                  label={t.status}
                  color={theme.colors.accent}
                  backgroundColor={`${theme.colors.accent}1A`}
                />
              </View>
              <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.colors.foregroundMuted }}>
                {t.worktree ? "Worktree 隔离" : "本地工作区"} · {t.cwd}
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionButton
                label={expanded ? "收起摘要" : "穿透摘要"}
                variant="secondary"
                theme={theme}
                onPress={() => onToggleInspect(t.agentId)}
              />
              {canNavigate ? (
                <ActionButton label="打开线程" theme={theme} onPress={() => onOpenAgent(t.agentId)} />
              ) : null}
            </View>
            {expanded && preview ? (
              <View style={{ backgroundColor: theme.colors.surface2, borderRadius: 10, padding: 10, gap: 6 }}>
                {preview.loading ? (
                  <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
                    正在穿透读取原线程摘要...
                  </Text>
                ) : preview.error ? (
                  <Text style={{ fontSize: 12, color: theme.colors.statusDanger }}>{preview.error}</Text>
                ) : preview.digests.length === 0 ? (
                  <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
                    线程暂无消息记录（状态：{preview.status}）
                  </Text>
                ) : (
                  preview.digests.map((d, idx) => (
                    <Text
                      key={`${t.agentId}-${idx}`}
                      numberOfLines={3}
                      style={{ fontSize: 12, color: theme.colors.foreground, lineHeight: 17 }}
                    >
                      [{d.role}] {d.text}
                    </Text>
                  ))
                )}
              </View>
            ) : null}
          </SurfaceCard>
        );
      })}
    </View>
  );
}

export function BotDispatchTabContent({
  bot,
  title,
  prompt,
  useWorktree,
  isPending,
  theme,
  onChangeTitle,
  onChangePrompt,
  onToggleWorktree,
  onSubmit,
}: {
  bot: BotRecord;
  title: string;
  prompt: string;
  useWorktree: boolean;
  isPending: boolean;
  theme: AppTheme;
  onChangeTitle(v: string): void;
  onChangePrompt(v: string): void;
  onToggleWorktree(): void;
  onSubmit(): void;
}) {
  if (bot.roleType === "companion") {
    return (
      <SurfaceCard theme={theme} style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name="ShieldCheck" size={16} color={theme.colors.accent} />
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: theme.colors.foreground }}>
            双脑隔离保护中
          </Text>
        </View>
        <Text style={{ fontSize: 12.5, color: theme.colors.foregroundMuted, lineHeight: 18 }}>
          陪伴主位禁止直接派发工程子线程。若对话中产生了工作灵感，请记录到 Inbox 交由总管拆解派发。
        </Text>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard theme={theme} style={{ gap: 12 }}>
      <TextInput
        value={title}
        onChangeText={onChangeTitle}
        placeholder="子线程标题（如：修复登录校验）"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
          color: theme.colors.foreground,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 13,
        }}
      />
      <TextInput
        value={prompt}
        onChangeText={onChangePrompt}
        multiline
        numberOfLines={4}
        placeholder="输入派发给新执行线程的详细任务要求..."
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          minHeight: 92,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface0,
          color: theme.colors.foreground,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 13,
          textAlignVertical: "top",
        }}
      />
      <Pressable
        accessibilityRole="button"
        onPress={onToggleWorktree}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <Icon
          name={useWorktree ? "CheckSquare" : "Square"}
          size={16}
          color={useWorktree ? theme.colors.accent : theme.colors.foregroundMuted}
        />
        <Text style={{ fontSize: 12.5, color: theme.colors.foreground }}>
          启用独立 Git Worktree 隔离执行
        </Text>
      </Pressable>
      <ActionButton
        label={isPending ? "派发中..." : "立即派发子线程"}
        disabled={isPending}
        theme={theme}
        onPress={onSubmit}
      />
    </SurfaceCard>
  );
}
