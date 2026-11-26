---
name: verify
description: Read-only verification procedure for paseo-bot against static gates, unit/integration suites, and an isolated Paseo v0.17.4 daemon + fault injections.
---

# Paseo Bot Verification Skill (Read-Only Verifier)

**Strict rule**: A verifier executing this skill MUST inspect only—do **NOT** edit source files, relax assertions, or patch tests to force green. Report exact stdout/stderr and exit codes.

## 1. Static Gates, Boundaries & Test Suite

Run from the repository root:

```bash
npm run check
```

Verifies:
- `tsc --noEmit` (zero type errors)
- AST architectural/boundary scan (`scripts/check.mjs`)
- 5/5 deliberate violation fixtures (`--self-test`)
- Vitest unit + microkernel isolation + E2E kernel suite (`tests/`)

## 2. Isolated Real Paseo Daemon E2E Verification

```bash
npm run verify
```

Verifies inside a fresh temporary `PASEO_HOME` (`PASEO_WEB_UI_ENABLED=true`, `pluginsEnabled: true`):
- Real `paseo daemon run` startup and Web UI HTTP 200 readiness
- Real `installDirectoryPlugin` loading `paseo-bot` cleanly (`getPluginLogs` has 0 error entries)
- Real Paseo client bundler compiling `index.client.tsx` (`getPluginCatalog` returns non-empty `clientBundle`)
- Live RPC & `hub.subscribe` stream (`snapshot`, `bot.upsert` + companion isolation rejection, `inbox.add`/`update` verbatim `rawText`, `outbox.add`/`ack`)

## 3. Fault-Injection Negative Gate Verification (All 3 MUST Exit Non-Zero)

```bash
npm run verify -- --inject-fault missing-manifest
npm run verify -- --inject-fault bad-plugin-syntax
npm run verify -- --inject-fault broken-daemon-port
```
