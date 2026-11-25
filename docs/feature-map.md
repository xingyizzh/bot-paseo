# Paseo Bot —— 功能模块地图（Feature Map）

> 严格遵守微内核拓扑：`index.* -> core <- features -> adapters / shared`（`features/` 之间零直接导入，只经 `EventBus`、`Hook` 与 `shared/` 契约通信）。

## 服务端功能模块（`server/features/`）

| 模块 | 入口与源码 | 贡献 RPC / Subscription | Hooks / Agent Tools | EventBus 交互 |
|---|---|---|---|---|
| `bot_registry` | [adapter.ts](../server/features/bot_registry/adapter.ts)、[logic.ts](../server/features/bot_registry/logic.ts) | `paseo-bot.snapshot`、`bot.upsert`、`bot.archive`、`section.upsert`、`section.delete`、`bot.open-session` | 首次读取自动初始化 `butler` & `companion`；`companion` 强制锁定 `readonly`；修改绑定 Bot 人设/权限触发 `reloadBotAgent` | 每次落盘经 `kernel.commitState` 发送 `state.changed` |
| `inbox_outbox` | [adapter.ts](../server/features/inbox_outbox/adapter.ts)、[logic.ts](../server/features/inbox_outbox/logic.ts)、[schema.ts](../server/features/inbox_outbox/schema.ts) | `paseo-bot.inbox.add`、`inbox.update`、`inbox.import-hq`、`outbox.add`、`outbox.ack` | 锁定 `rawText` 原话不可改；Outbox 按 `needs_decision > blocked > delivered` 排序 | 监听 `inbox.capture`、`inbox.markDispatched`、`outbox.enqueue`、`outbox.ackByAgent` |
| `thread_bridge` | [adapter.ts](../server/features/thread_bridge/adapter.ts)、[logic.ts](../server/features/thread_bridge/logic.ts)、[schema.ts](../server/features/thread_bridge/schema.ts) | `paseo-bot.thread.dispatch`、`thread.inspect` | Hooks: `agent.open.before`、`agent.permission.before`、`agent.permission.after`、`agent.turn.after`<br>Tools: `bot_list`、`inbox_capture`、`inbox_list`、`outbox_post`、`bot_dispatch_thread`、`thread_inspect` | 经 `emitWithAck` 驱动 `inbox.capture` / `inbox.markDispatched` / `outbox.enqueue` / `outbox.ackByAgent` |
| `realtime_sync` | [adapter.ts](../server/features/realtime_sync/adapter.ts) | `paseo-bot.hub.subscribe` | 订阅建立时立即推送当前快照并在 `signal` 触发时清理退订 | 订阅 `state.changed` 实时推送全端 |

## 客户端功能模块（`client/features/`）

| 模块 | 源码目录 | Paseo Host 扩展点 | 职责摘要 |
|---|---|---|---|
| `ds_theme` | [index.ts](../client/features/ds_theme/index.ts) | `addTheme` | 注册 `ds-bot-light` 与 `ds-bot-dark` 双主题（对齐 `docs/design-spec.md`） |
| `bot_sidebar` | [bot_sidebar/](../client/features/bot_sidebar/index.tsx) | `addSidebarView` | 顶栏徽标操作、Hero 双主位卡、可折叠项目分组、底栏 Inbox/Outbox 入口、速记/新建弹窗 |
| `bot_studio` | [bot_studio/](../client/features/bot_studio/index.tsx) | `addScreen` (`bot-studio`)、`addSettingsScreen` (`bots`)、`addAgentPanel` (`bot-details`) | Bot 团队管理编辑器（含防脏写保护）与右侧详情/关联线程/快捷派活抽屉 |
| `inbox_outbox_hub` | [inbox_outbox_hub/](../client/features/inbox_outbox_hub/index.tsx) | `addScreen` (`inbox-outbox`)、`addSidebarHeaderItem` ×2 | Outbox 注意力收口列表与 Inbox 原话锁存分诊/内联派活控制台 |
| `timeline_polish` | [index.tsx](../client/features/timeline_polish/index.tsx) | `addSlashCommand` ×2 (`/inbox`、`/dispatch`)、`addCommandCenterItem` ×2、`addTimelineTransformer`、`addTimelineRenderer` | 仅对本插件工具调用折叠居中微事件胶囊，不劫持第三方 MCP 工具 |
