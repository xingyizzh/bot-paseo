# Paseo Bot —— 需求与进度看板（STATUS）

## 项目摘要

- **定位**：基于 `@getpaseo/plugin@0.17.4` 生长、面向多端共享的个人 Bot 团队系统（支持开关切换 Paseo Thread/Worktree 执行后端与纯 Bot 模式）。
- **核心架构**：微内核 + 解耦分形模块（`shared/` 契约、`server/core` + `server/adapters/execution-port.ts` + `server/features/*`、`client/core` + `client/features/*`）。
- **消息流转铁律（方案 2 · 严格双脑 + 分 Bot 质检 + 主 Bot 降噪汇报）**：
  - `companion` 陪伴主位严格锁定 `readonly` + `mcpServers: {}` + 仅 `inbox_capture`；
  - `project_lead` 派发并自管所属 Thread；worker 完结/失败时经 `agent.turn.after` 先回报所属 `project_lead` 用 `thread_inspect` 质检把关，再由其调 `outbox_post(threadAgentId)` 正式上报；
  - `butler` 总管通过 `outbox_list` / `outbox.digest-to-butler` 以 Muse 风格（结论 + 待拍板 + 穿透入口，禁废话堆栈）整理汇报，并调 `outbox_ack` 归档已交付项；审批项（`needs_decision`）直通 Outbox。
- **硬性约束**：`scripts/check.mjs` 强制守卫三目录隔离、零跨模块导入、行限（入口 ≤40、契约/schema ≤400、其余非测试文件 ≤300）与零违禁标记。

## 功能清单

| 编号 | 功能名 | 核心能力与验收状态 | 状态 |
|---|---|---|---|
| `FEAT-001` | Bot 注册与可插拔设置 | 初始化 `butler` & `companion`；Bot 增改归档、折叠分组、`settings.update` 切换 `paseoEnabled` | 已完成 |
| `FEAT-002` | Inbox 原话锁存 & Outbox 缓冲 | `rawText` 不可篡改；Outbox 优先级排序（`needs_decision > blocked > delivered`）；EventBus `outbox.list` / `outbox.ack`；HQ JSONL 导入 | 已完成 |
| `FEAT-003` | 双脑隔离、分 Bot 质检与 Muse 整理 | `companion` 物理隔离；分 Bot `thread_inspect` 验收后 `outbox_post(threadAgentId)`；`butler` 一键整理汇报与开关降级门控 | 已完成 |
| `FEAT-004` | 全端实时订阅同步 | 单例 `hub.subscribe` 引用计数共享流，状态变更零泄漏推送至桌面/Web/移动端 | 已完成 |
| `FEAT-005` | DS-Bot 跨端 UI 与双主题 | DS-Bot Light/Dark 语义色、透明侧栏、线程活跃提示、收发箱“让管家整理汇报”卡片与纯 Bot/Paseo 一键切换 | 已完成 |

## 底座建设与验证现状

| 阶段模块 | 产物与验证方式 | 状态 |
|---|---|---|
| 架构与门禁 | [AGENTS.md](../AGENTS.md)、[ARCHITECTURE.md](../ARCHITECTURE.md)、[design-spec.md](./design-spec.md)、[feature-map.md](./feature-map.md)、`scripts/check.mjs` + `tests/gates/` | 已完成（5/5 夹具全拦截） |
| 可插拔执行适配器 | `server/adapters/{execution-port.ts,paseo-adapter.ts,null-execution.ts}` | 已完成（含无 Paseo 降级实现与单测） |
| 全栈入口与端到端测试 | `index.server.ts` (26L)、`index.client.tsx` (17L)、6 组 Vitest 套件（28/28 通过） | 已完成 |
| 隔离沙盒实跑 | `npm run verify`（真起 Paseo v0.17.4 daemon、编译 111 KB+ 客户端包、RPC/订阅/开关切换）+ `--inject-fault missing-manifest` 拦截 | 已完成（全绿） |

## 变更记录

- `d7546ec`..`b1619c7`：搭建脚手架、AST 门禁、`shared/` 契约、微内核及 `FEAT-001`..`005` 初始模块。
- `dff2d7e`..`2e5a4d2`：接线双端根入口、清除硬编码个人路径、独立红队审计修复（损坏状态备份恢复、EventBus 超时/异常隔离、`hub.subscribe` 去重、Bot Studio 防脏写与表单垂直流收敛）。
- `6f31889`..`010fb60`：落地 `scripts/verify.mjs` 隔离沙盒验收、`feature-map.md`、`timeline_polish` 合法 ID 修复与 DS-Bot Light/Dark 语义对比度抛光（含 1280×800 与 390×844 实机截图检查）。
- 当前収口提交：落盘可插拔 `ExecutionPort` + `null-execution`、`settings.paseoEnabled` 纯 Bot / Paseo 切换、分 Bot 质检上报（`worker turn.after` → 分 Bot `thread_inspect` → `outbox_post(threadAgentId)`）及管家 Muse 风格 Outbox 整理汇报闭环。
