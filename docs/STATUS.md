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
| `FEAT-002` | 原话锁存 Inbox & 注意力 Outbox | Inbox `rawText` 不可修改；Outbox 按 `needs_decision > blocked > delivered` 排序；支持导入 `personal-hq` | 待做 |
| `FEAT-003` | 双脑隔离注魂与 Thread 透视派活 | `companion` 仅获 `inbox_capture` 禁派活/工程；`butler`/`project_lead` 可派发并直读原 Thread；审批/完成自动入 Outbox | 待做 |
| `FEAT-004` | 实时订阅同步 | 服务端状态变更经 `hub.subscribe` 零泄漏推送至桌面/Web/手机端 | 待做 |
| `FEAT-005` | DS-Bot 级跨端 UI 与双主题 | DS-Bot Light/Dark 主题、Hero 主位卡片侧栏、详情与关联线程穿透抽屉、收发箱控制台、时间线轻事件 | 待做 |

## 底座建设

| 阶段模块 | 产物路径 | 状态 |
|---|---|---|
| 架构与视觉规范 | [ARCHITECTURE.md](../ARCHITECTURE.md)、[design-spec.md](./design-spec.md)、[FEAT-001.md](./statecharts/FEAT-001.md) | 已完成 |
| 静态门禁与违规夹具 | `scripts/check.mjs`、`tests/gates/` | 已完成 |
| 微内核与 FEAT-001 样板 | `server/core/`、`server/features/bot_registry/`、`tests/integration/` | 已完成 |
| 隔离沙盒验证与脚本 | `scripts/verify.mjs`、`docs/feature-map.md` | 待做 |
| 协作总入口 | `AGENTS.md` | 待做 |

## 变更记录

- 2026-11-25：基于 `@getpaseo/cli@0.17.4` 初始化 `/Users/xingyi/ai/paseo-bot`，锁定微内核解耦拓扑与 DS-Bot 视觉红线。
