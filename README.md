# Paseo Bot

Native microkernel Bot team, dual-brain Companion/Butler isolation, Project-Lead QA gates, and immutable Inbox/Outbox plugin for [Paseo](https://paseo.sh).

## Features

- **Strict Role Isolation**:
  - **Companion (`companion`)**: Locked to `readonly` mode, strips external MCP servers, and exposes only `inbox_capture` to record user ideas verbatim without technical leakage.
  - **Project Leads (`project_lead`)**: Own specific repositories (`defaultCwd`), dispatch isolated Git worktree worker threads via `bot_dispatch_thread`, automatically wake on worker completion/failure (`agent.turn.after`) to QA with `thread_inspect`, and report verified results to Outbox via `outbox_post(threadAgentId)`.
  - **Butler (`butler`)**: Triages Inbox/Outbox via `outbox_list` / `outbox.digest-to-butler`, delivers concise Muse-style summaries, and archives acknowledged deliveries via `outbox_ack` while keeping `needs_decision` / `blocked` items pending.
- **Pluggable Execution Backend (`paseoEnabled`)**: Toggle seamlessly between **Paseo Thread Mode** (`paseo-adapter`) and **Pure Bot Mode** (`null-execution`), disabling thread dispatch/inspection at both UI and tool/RPC levels while keeping Bot chat and Inbox/Outbox active.
- **Cross-Platform React Native UI**: Renders across Paseo Desktop, Web, and Mobile (iOS / Android) when connected to the daemon where the plugin is installed—featuring a Bot Team sidebar view, Bot Studio screen/settings, Agent Bot Details drawer, Inbox/Outbox hub, compact timeline tool-call pills, and DS-Bot Light/Dark themes.
- **Hardened Microkernel**: Atomic state persistence (`~/.paseo/paseo-bot-data/hub-state.json`, overridable via `PASEO_BOT_DATA_DIR`) with corrupt-file backup recovery, isolated EventBus with bounded ack timeouts, and AST-enforced zero cross-feature coupling.

## Installation

### From GitHub (via Paseo CLI)

Ensure plugins are enabled in `~/.paseo/config.json` (`"pluginsEnabled": true`), then run:

```bash
paseo plugin install github:xingyizzh/bot-paseo --ref main
```

### Local Development Install

```bash
git clone https://github.com/xingyizzh/bot-paseo.git
cd bot-paseo
npm install
npm run check
paseo plugin install /absolute/path/to/bot-paseo
```

After code changes in your local clone:

```bash
npm run check
paseo plugin reload paseo-bot
```

## Architecture & Message Flow

```
User / Companion (readonly, inbox_capture only)
   └─▶ Inbox (immutable rawText)
          └─▶ Project Lead dispatches Worktree Thread (bot_dispatch_thread)
                 └─▶ Worker finishes / fails (agent.turn.after)
                        └─▶ Project Lead wakes & QA reviews (thread_inspect)
                               ├─▶ outbox_post(threadAgentId) ──▶ Outbox
                               └─▶ Butler Muse Digest ──▶ Concise Report + outbox_ack
```

- `shared/`: Zod RPC contracts, domain schemas, avatars, and DS-Bot semantic theme tokens.
- `server/core/` & `server/adapters/`: StateStore, EventBus, `ServerKernel`, and `ExecutionPort` (`paseo-adapter` / `null-execution`).
- `server/features/`: Isolated vertical slices (`bot_registry`, `inbox_outbox`, `thread_bridge`, `realtime_sync`).
- `client/`: Decoupled React Native surfaces (`bot_sidebar`, `bot_studio`, `inbox_outbox_hub`, `timeline_polish`, `ds_theme`).

## Development & Verification

```bash
# Typecheck, AST architectural/line-limit checks, gate fixtures, and Vitest suite
npm run check

# Full isolated Paseo v0.17.4 daemon + client bundle + RPC/subscription E2E verification
npm run verify

# Fault-injection negative gate checks
npm run verify -- --inject-fault missing-manifest
```

See [ARCHITECTURE.md](./ARCHITECTURE.md), [docs/feature-map.md](./docs/feature-map.md), and [docs/STATUS.md](./docs/STATUS.md) for architecture details and test coverage.

## License

[Apache-2.0](./LICENSE)
