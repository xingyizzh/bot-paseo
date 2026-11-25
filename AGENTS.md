# Paseo Bot — Agent Collaboration Guide

## Architecture & Hard Boundaries
Microkernel + decoupled fractal modules (strictly no cross-feature imports):
- **Topology**: `index.* -> core <- features -> adapters / shared`
- **3-Dir Isolation**: `shared/` zero Node/React; `server/` zero React; `client/` zero Node, zero `server/`, zero DOM globals (`window`/`document`/`localStorage`/`<div`).
- **Line Limits**: entry files (`index.server.ts`, `index.client.tsx`) `<= 40`; `shared/*` and `*/schema.ts` `<= 400`; all other non-test `.ts`/`.tsx` files `<= 300`. Zero `TODO`, `HACK`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, or explicit `: any`.

## Pluggable Backend & Scheme 2 Message Flow
1. **ExecutionPort (`server/adapters/execution-port.ts`)**: `paseo-adapter.ts` (`threads/worktree/inspect`) vs `null-execution.ts` (pure Bot fallback). Runtime toggle `settings.paseoEnabled` switches Paseo Thread/Worktree capabilities cleanly without changing feature modules.
2. **Dual-Brain Isolation**: `companion` is locked `readonly`, `mcpServers: {}`, and restricted to `inbox_capture`.
3. **Owner-Bot QA & Muse Curation**:
   - Each non-companion Bot (`butler`, `project_lead`) dispatches/inspects its own threads (`bot_dispatch_thread`, `thread_inspect`); users can drill into any Bot or Thread at any time.
   - Completed/failed `project_lead` worker threads wake their owning `project_lead` via `agent.turn.after` (`buildWorkerReviewPrompt`) to QA with `thread_inspect` before escalating verified outcomes via `outbox_post(threadAgentId)`. Permission prompts (`needs_decision`) and fallback cases enqueue directly to Outbox.
   - `butler` curates Outbox via `outbox_list` / `paseo-bot.outbox.digest-to-butler` in concise Muse style (conclusions + decisions + thread reference; no raw logs/commands/stacks) and acknowledges `delivered` items via `outbox_ack`.

## Verification Commands
```bash
npm run check                               # tsc + AST gates + 5/5 gate fixtures + Vitest
npm run verify                              # isolated Paseo v0.17.4 daemon + bundle + RPC smoke tests
npm run verify -- --inject-fault missing-manifest  # fault-injection must exit non-zero
```
