# Paseo Bot —— 需求与进度看板（STATUS）

## 项目摘要

- **定位**：基于 Paseo v0.17.4 原生插件体系生长的个人 Bot 团队系统（支持桌面、Web、iOS、Android 跨端一致体验）。
- **核心架构**：微内核 + 解耦分形功能模块（`shared/` 契约、`server/core` + `server/features/*`、`client/core` + `client/features/*`）。
- **明确不做（非目标）**：
  - 不做多 Bot 自由讨论闲聊群聊（工作流采用管家/项目主管直接透视 Paseo Thread）；
  - 不做自研内置无头浏览器与 macOS 鼠键操控；
  - 不做企业级 SSO / SCIM / K8s 多租户，不做逆向微信/QQ 协议；
  - 不改动或 Fork Paseo 宿主源码。
- **硬性约束**：严格遵守 Paseo 三目录编译隔离（`shared/` 零 Node/React，`client/` 零 Node/DOM，`server/` 零 React），所有状态修改经原子文件存储与单写者微内核事件总线。

## 功能清单

| 编号 | 功能名 | 核心价值与客观验收标准 | 状态 |
|---|---|---|---|
| `FEAT-001` | Bot 注册与分组管理 | 默认初始化管家与陪伴位双主位；支持 Bot 增改归档、单层分组折叠、权限防越权与避重色分配 | 已完成 |
| `FEAT-002` | 原话锁存 Inbox & 注意力 Outbox | Inbox `rawText` 不可修改；Outbox 按 `needs_decision > blocked > delivered` 排序；支持导入 `personal-hq` | 模块代码与单测已过（待接总入口与实跑验收） |
| `FEAT-003` | 双脑隔离注魂与 Thread 透视派活 | `companion` 仅获 `inbox_capture` 禁派活/工程；`butler`/`project_lead` 可派发并直读原 Thread；审批/完成自动入 Outbox | 模块代码与单测已过（待接总入口与实跑验收） |
| `FEAT-004` | 实时订阅同步 | 服务端状态变更经 `hub.subscribe` 零泄漏推送至桌面/Web/手机端 | 模块代码已过静态门禁（待接总入口与端到端验收） |
| `FEAT-005` | DS-Bot 级跨端 UI 与双主题 | DS-Bot Light/Dark 主题、Hero 主位卡片侧栏、详情与关联线程穿透抽屉、收发箱控制台、时间线轻事件 | 模块代码已过静态门禁（待接总入口、瘦身与实机截图验收） |

## 底座建设

| 阶段模块 | 产物路径 | 状态 |
|---|---|---|
| 架构与视觉规范 | [ARCHITECTURE.md](../ARCHITECTURE.md)、[design-spec.md](./design-spec.md)、[FEAT-001.md](./statecharts/FEAT-001.md) | 已完成 |
| 静态门禁与违规夹具 | `scripts/check.mjs`、`tests/gates/` | 已完成 |
| 微内核与 FEAT-001 样板 | `server/core/`、`server/features/bot_registry/`、`tests/integration/` | 已完成 |
| 客户端微内核与基础原语 | `client/core/`（`kernel.ts`、`hooks.ts`、`primitives.tsx`） | 已完成 |
| 总入口接线与端到端内核测试 | `index.server.ts`、`index.client.tsx`、`tests/integration/end-to-end-kernel.test.ts` | 待做 |
| 红队复审与代码简洁度瘦身 | `client/features/` 冗余拆分收敛与 6 处个人路径清除 | 待做 |
| 隔离沙盒验证与脚本 | `scripts/verify.mjs`、`.agents/skills/verify/SKILL.md`、`docs/feature-map.md` | 待做 |
| 实机 Paseo Web UI 截图把关 | 桌面 1280×800 Light/Dark + 移动 390×844 截图验收 | 待做 |
| 协作总入口 | `AGENTS.md` | 待做 |

## 断点续作清单（2026-11-25 断点）

### 已完成并落盘

- Commit `d7546ec`：脚手架、`paseo-plugin.json`、[ARCHITECTURE.md](../ARCHITECTURE.md)、[design-spec.md](./design-spec.md)、[FEAT-001.md](./statecharts/FEAT-001.md)。
- Commit `042c445`：`scripts/check.mjs`（`tsc --noEmit` + AST 边界/依赖/DOM/Node/行数/违禁词门禁）+ 5 个违规夹具（`tests/gates/`）。
- Commit `f161224`：`shared/`（4 文件）、`server/core/`（`kernel.ts`/`store.ts`/`logger.ts`）、`server/adapters/paseo-adapter.ts`、`server/features/bot_registry/`、`tests/integration/kernel-isolation.test.ts`。
- 本次断点提交：`server/features/{inbox_outbox,thread_bridge,realtime_sync}/`、`client/core/`、`client/features/{ds_theme,bot_sidebar,bot_studio,inbox_outbox_hub,timeline_polish}/`；`npm run check` 全绿（`tsc` 0 错、架构门禁 0 违规、5/5 违规夹具拦截、5 个测试文件 17/17 用例通过；核心代码共 7,276 行）。

### 已知待修项（续作第一步）

1. **清除 6 处写死的个人路径 `/Users/xingyi`**（保证可分享给他人使用）：`shared/rpc.ts:115`、`client/features/bot_sidebar/index.tsx:142`、`client/features/bot_sidebar/QuickCreateBotModal.tsx:147`、`client/features/bot_studio/BotIdentitySection.tsx:136`、`client/features/bot_studio/BotStudioEditor.tsx:35,45`，改为环境变量或通用占位符。
2. **接线根入口与端到端测试**：完成 `index.server.ts`（注册 4 个 server feature）与 `index.client.tsx`（注册 5 个 client feature），并补 `tests/integration/end-to-end-kernel.test.ts`。
3. **独立只读红队审查 + 代码简洁度瘦身**：重点收敛 `client/features/bot_studio/`（8 文件）和 `client/features/bot_sidebar/`（6 文件）中的冗余包装，落实“验收代码简洁”要求，同时守住单文件 ≤ 300 行门禁。
4. **隔离沙盒实跑验证**：编写 `docs/feature-map.md`、`.agents/skills/verify/SKILL.md`、`scripts/verify.mjs`（隔离 `PASEO_HOME` 真起 `@getpaseo/cli@0.17.4` daemon、真装插件、实跑 RPC + 3 项 `--inject-fault` 故障注入验收）。
5. **真实 Paseo Web UI 截图验收**：启动隔离 Paseo Web UI，用 `preview_*` 截取 5 组界面图（1280×800 Light/Dark、Bot Studio、Inbox/Outbox、390×844 Mobile），由规划模型亲自看图把关 UI/UX。
6. **补齐文档与总入口**：编写仓内 `AGENTS.md`（≤ 80 行），全部实跑与截图签收后收口。

## 变更记录

- 2026-11-25：基于 `@getpaseo/cli@0.17.4` 初始化 `/Users/xingyi/ai/paseo-bot`，锁定微内核解耦拓扑与 DS-Bot 视觉红线。
- 2026-11-25（断点存档）：完成 `FEAT-002`~`FEAT-005` 各解耦模块与 `client/core/`，`npm run check` 5 文件 17 用例 + 5/5 架构门禁全绿，因额度告急先行本地提交并记录断点续作清单。
