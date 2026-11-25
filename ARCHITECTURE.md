# ARCHITECTURE —— Paseo Bot 微内核与解耦拓扑

## 1. 系统拓扑与唯一合法依赖方向

```mermaid
flowchart LR
    EntryS["index.server.ts (≤40行)"] --> SKernel["server/core/kernel.ts\n(注册表/EventBus/Hook链)"]
    SKernel <-- "只经 EventBus / Hook / Registry" --- SFeat["server/features/*\n(bot_registry / inbox_outbox / thread_bridge / realtime_sync)"]
    SFeat --> SAdapter["server/adapters/paseo-adapter.ts"]
    SFeat --> SStore["server/core/store.ts & logger.ts"]

    EntryC["index.client.tsx (≤40行)"] --> CKernel["client/core/kernel.ts & hooks.ts"]
    CKernel <-- "只经 PluginClientContext / hub.subscribe" --- CFeat["client/features/*\n(ds_theme / bot_sidebar / bot_studio / inbox_outbox_hub / timeline_polish)"]
    CFeat --> CPrim["client/core/primitives.tsx"]

    SFeat & SAdapter & CFeat & CKernel --> Shared["shared/* (纯 TS + Zod v4 契约)"]
```

**唯一依赖规则**：
- `index.* -> core <- features -> adapters / shared`
- `features/` 之间**零直接导入**，跨模块协作只通过 `server/core/kernel.ts` 的 `EventBus`、Hook 链与 `shared/` 契约；
- `core/` 严禁包含具体业务 `if-else`，严禁反向导入 `features/`；
- **三目录编译硬隔离**：`shared/` 零 Node/React；`server/` 零 React；`client/` 零 Node、零 `server/`、零 DOM 全局（`window`/`document`/`HTMLElement`/`<div`）。

## 2. 分形模块规范

每个业务功能独立成 `features/<name>/`，按需包含：
1. `manifest.ts`（ID、名称、贡献的 RPC/Hook 声明）
2. `schema.ts`（Zod 边界校验与视图切片契约）
3. `logic.ts`（纯计算状态转移，零 IO / 零 SDK / 零模块级可变缓存）
4. `adapter.ts`（连接 `store`、`paseo-adapter` 与 `kernel`）
5. `test_logic.ts`（纯逻辑单测与越权/串台探针）

## 3. 分级硬门禁（`scripts/check.mjs` 强制拦截）

| 门禁项 | 规则与阈值 |
|---|---|
| 依赖方向 | 禁止 `features/A` 导入 `features/B`；禁止 `core/` 导入 `features/`；严格守卫 `shared/` / `server/` / `client/` 运行时边界 |
| 根部文件限制 | 插件根目录除 `index.server.ts`、`index.client.tsx` 外禁止其他 `.ts/.tsx` 源码文件 |
| 分级行数上限 | 逻辑/内核/适配器/单 UI 文件 **≤ 300 行**；`schema.ts` / `contracts.ts` **≤ 400 行**；入口 `index.*` **≤ 40 行** |
| 禁止标记 | 零 `TODO`、`HACK`、`@ts-ignore`、`@ts-expect-error`、`eslint-disable`、显式 `: any` |
| 违规自测 | `tests/gates/` 固化 4 类违规夹具，`scripts/check.mjs --self-test` 必须全部捕获报错 |
