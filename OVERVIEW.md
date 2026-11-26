# Paseo Bot

Paseo Bot adds a multi-role Bot team, an immutable Inbox, a prioritized Outbox, and pluggable Paseo thread execution to a Paseo daemon.

## What it does

- Separates conversational intake from engineering work using three roles: a read-only Companion hero that only captures ideas via `inbox_capture`, Project Lead bots that dispatch and QA-review Git worktree threads, and a Butler hero that curates Outbox updates and archives delivered items via `outbox_ack`.
- Locks captured Inbox entries (`rawText`) against mutation and routes Outbox notifications by priority (`needs_decision`, `blocked`, then `delivered`).
- Provides cross-device React Native UI across desktop, web, and mobile clients connected to the same daemon: a custom Bot Team sidebar, Bot Studio settings and creation screens, a per-agent Bot Details drawer, an Inbox/Outbox hub screen, DS-Bot Light/Dark themes, and collapsed timeline pills for plugin tool calls.
- Includes a runtime toggle between Paseo Thread mode (`paseoEnabled: true`) and Pure Bot mode (`paseoEnabled: false`), disabling thread dispatch and inspection while keeping Bots, Inbox, and Outbox available.

## How it works

The server entrypoint creates a small microkernel backed by JSON state persistence and an execution port adapter (`paseo-adapter` when threads are enabled, or `null-execution` in Pure Bot mode). Role policies enforced in `agent.open.before` and `agent.permission.before` restrict each Bot session's allowed tools and system prompts, automatically approve or deny plugin MCP tools according to role rules, wake the owning Project Lead via `agent.turn.after` when worker threads finish or fail, and escalate unresolved approval prompts or lead QA failures into the Outbox.

## Setup and requirements

- Requires Paseo `>=0.17.0` with at least one enabled LLM provider (such as Claude or Codex).
- When opening or dispatching Bot sessions, Paseo Bot enables `daemon.mcp.injectIntoAgents` so agents can invoke the plugin's MCP tools (`mcp__paseo__*`).
- State is persisted locally under `~/.paseo/paseo-bot-data/hub-state.json` (overridable with `PASEO_BOT_DATA_DIR`), with corrupt files backed up automatically before recovery.
- Optional legacy HQ JSONL import reads from `PERSONAL_HQ_DIR` when set, defaulting to `~/ai/personal-hq`.
