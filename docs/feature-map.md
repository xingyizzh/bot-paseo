# Paseo Bot —— 功能模块地图（Feature Map）

> 严格遵守微内核拓扑：`index.* -> core <- features -> adapters / shared`（`features/` 之间零直接导入，只经 `EventBus`、`Hook` 与 `shared/` 契约通信）。

## 执行后端适配层（`server/adapters/`）

| 组件 | 源码 | 职责摘要 |
|---|---|---|
| `ExecutionPort` | [execution-port.ts](../server/adapters/execution-port.ts) | 宿主无关的执行接口，暴露 `kind` 与 `capabilities: { threads, worktree, inspect }` |
| `paseo-adapter` | [paseo-adapter.ts](../server/adapters/paseo-adapter.ts) | Paseo v0.17.4 原生实现：创建/恢复 Bot 会话、Git Worktree 隔离派发、时间线摘要穿透 |
| `null-execution` | [null-execution.ts](../server/adapters/null-execution.ts) | 纯 Bot 降级实现：关闭线程/Worktree 能力并安全抛出 `PERMISSION_DENIED` |

## 服务端功能模块（`server/features/`）

| 模块 | 入口与源码 | 贡献 RPC / Subscription | Hooks / Agent Tools | EventBus 交互 |
|---|---|---|---|---|
| `bot_registry` | [adapter.ts](../server/features/bot_registry/adapter.ts)、[logic.ts](../server/features/bot_registry/logic.ts) | `paseo-bot.snapshot`、`bot.upsert`、`bot.archive`、`section.upsert`、`section.delete`、`bot.open-session`、`settings.update` | 首次读取自动初始化 `butler` & `companion`；`companion` 强制锁定 `readonly`；支持切换 `paseoEnabled` 并同步重加载变更 Bot | 每次落盘经 `kernel.commitState` 发送 `state.changed` |
| `inbox_outbox` | [adapter.ts](../server/features/inbox_outbox/adapter.ts)、[logic.ts](../server/features/inbox_outbox/logic.ts)、[schema.ts](../server/features/inbox_outbox/schema.ts) | `paseo-bot.inbox.add`、`inbox.update`、`inbox.import-hq`、`outbox.add`、`outbox.ack` | 锁定 `rawText` 原话不可改；Outbox 按 `needs_decision > blocked > delivered` 排序并支持过滤切片；支持导入 `personal-hq` | 监听 `inbox.capture`、`inbox.markDispatched`、`outbox.enqueue`、`outbox.ackByAgent`、`outbox.list`、`outbox.ack` |
| `thread_bridge` | [adapter.ts](../server/features/thread_bridge/adapter.ts)、[logic.ts](../server/features/thread_bridge/logic.ts)、[tools.ts](../server/features/thread_bridge/tools.ts)、[digest.ts](../server/features/thread_bridge/digest.ts)、[schema.ts](../server/features/thread_bridge/schema.ts) | `paseo-bot.thread.dispatch`、`thread.inspect`、`outbox.digest-to-butler` | Hooks: `agent.open.before`（按 `threadsEnabled` 裁剪工具）、`agent.permission.{before,after}`（直通/自动消解审批）、`agent.turn.after`（分 Bot 派出的线程先唤醒所属分 Bot 质检，失败/直属/兜底才直接入 Outbox）<br>Tools: `bot_list`、`inbox_capture`、`inbox_list`、`outbox_post`（支持校验归属并绑定 `threadAgentId`）、`outbox_list`、`outbox_ack`、`bot_dispatch_thread`、`thread_inspect` | 经 `emitWithAck` 驱动 Inbox/Outbox 全读写事件 |
| `realtime_sync` | [adapter.ts](../server/features/realtime_sync/adapter.ts) | `paseo-bot.hub.subscribe` | 订阅建立时立即推送当前快照并在 `signal` 触发时清理退订 | 订阅 `state.changed` 实时推送全端 |

## 客户端功能模块（`client/features/`）

| 模块 | 源码目录 | Paseo Host 扩展点 | 职责摘要 |
|---|---|---|---|
| `ds_theme` | [index.ts](../client/features/ds_theme/index.ts) | `addTheme` | 注册 `ds-bot-light` 与 `ds-bot-dark` 双主题（对齐 `docs/design-spec.md`） |
| `bot_sidebar` | [bot_sidebar/](../client/features/bot_sidebar/index.tsx) | `addSidebarView` | 顶栏徽标、Hero 双主位卡、折叠分组、线程活跃状态显示（随 `paseoEnabled` 联动）、底栏速记弹窗 |
| `bot_studio` | [bot_studio/](../client/features/bot_studio/index.tsx) | `addScreen` (`bot-studio`)、`addSettingsScreen` (`bots`)、`addAgentPanel` (`bot-details`) | Bot 团队管理编辑器（含防脏写保护）与详情/关联线程/快捷派活抽屉（纯 Bot 模式自动收起线程页签） |
| `inbox_outbox_hub` | [inbox_outbox_hub/](../client/features/inbox_outbox_hub/index.tsx) | `addScreen` (`inbox-outbox`)、`addSidebarHeaderItem` ×2 | 顶栏切换 `Paseo 线程: 开 / 纯 Bot 模式`；Outbox「让管家整理汇报」Muse 简报卡；Inbox 分诊与可选派活 |
| `timeline_polish` | [index.tsx](../client/features/timeline_polish/index.tsx) | `addSlashCommand` ×2 (`/inbox`、`/dispatch`)、`addCommandCenterItem` ×2、`addTimelineTransformer`、`addTimelineRenderer` | 仅对本插件工具调用折叠居中微事件胶囊，不劫持第三方 MCP 工具 |
