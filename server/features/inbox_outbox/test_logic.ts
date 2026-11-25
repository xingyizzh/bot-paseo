import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyHubState, DomainError, ERROR_CODES } from "../../../shared/contracts";
import {
  inboxAddRpc,
  inboxImportHqRpc,
  inboxUpdateRpc,
  outboxAckRpc,
  outboxAddRpc,
} from "../../../shared/rpc";
import { ServerKernel } from "../../core/kernel";
import { createLogger } from "../../core/logger";
import { createJsonStateStore } from "../../core/store";
import { inboxOutboxFeature } from "./adapter";
import {
  ackOutboxItem,
  addInboxItem,
  addOutboxItem,
  mergeImportedHq,
  sortOutboxItems,
  updateInboxItem,
} from "./logic";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createTestKernel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-inbox-outbox-"));
  tempDirs.push(dir);
  const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
  const server = {
    handle(contract: { name: string }, handler: (input: unknown, ctx: unknown) => Promise<unknown>) {
      handlers.set(contract.name, handler);
    },
    addHook() {
      return () => {};
    },
    registerSettings() {
      throw new Error("unused");
    },
    registerProvider() {},
    registerUsageSource() {},
    registerWorktreeManager() {
      return () => {};
    },
  } as unknown as PluginServerContext;

  const kernel = new ServerKernel({
    server,
    store: createJsonStateStore(dir),
    logger: createLogger("test"),
    adapter: {},
  });
  kernel.register(inboxOutboxFeature);

  const invoke = (name: string, input: unknown) => {
    const fn = handlers.get(name);
    if (!fn) throw new Error(`Missing handler: ${name}`);
    return fn(input, { paseo: {} });
  };

  return { dir, kernel, invoke };
}

describe("inbox_outbox pure logic", () => {
  it("locks rawText verbatim and prevents mutation on updates", () => {
    const now = "2026-11-25T10:00:00.000Z";
    const empty = createEmptyHubState(now);
    const verbatim = "  Keep   exact spacing\nand linebreaks!  ";
    const created = addInboxItem(
      empty,
      { rawText: verbatim, source: "companion", tags: ["idea"], note: "first note" },
      now,
    );

    expect(created.item.id).toBe("in-20261125-0001");
    expect(created.item.rawText).toBe(verbatim);
    expect(created.item.status).toBe("captured");
    expect(created.item.notes).toEqual([{ at: now, text: "first note" }]);

    const updated = updateInboxItem(
      created.nextState,
      {
        id: created.item.id,
        status: "triaged",
        targetBotId: "butler",
        targetProject: "paseo-bot",
        linkedAgentId: "agent-99",
        destination: "worktree-a",
        note: "triaged by butler",
      },
      "2026-11-25T10:05:00.000Z",
    );

    expect(updated.item.rawText).toBe(verbatim);
    expect(updated.item.status).toBe("triaged");
    expect(updated.item.targetBotId).toBe("butler");
    expect(updated.item.linkedAgentId).toBe("agent-99");
    expect(updated.item.destination).toBe("worktree-a");
    expect(updated.item.notes).toHaveLength(2);

    const injectedAttempt = {
      id: created.item.id,
      status: "done" as const,
      rawText: "tampered",
    };
    expect(() =>
      updateInboxItem(updated.nextState, injectedAttempt as Parameters<typeof updateInboxItem>[1]),
    ).toThrowError(DomainError);

    try {
      updateInboxItem(updated.nextState, injectedAttempt as Parameters<typeof updateInboxItem>[1]);
    } catch (err) {
      expect((err as DomainError).code).toBe(ERROR_CODES.IMMUTABLE_FIELD);
    }
  });

  it("sorts outbox items by ack status, kind priority, and newest createdAt", () => {
    let state = createEmptyHubState("2026-11-25T00:00:00Z");
    const d1 = addOutboxItem(state, { kind: "delivered", title: "D1", summary: "s", status: "delivered" }, "2026-11-25T12:00:00Z");
    state = d1.nextState;
    const b1 = addOutboxItem(state, { kind: "blocked", title: "B1", summary: "s" }, "2026-11-25T09:00:00Z");
    state = b1.nextState;
    const nOld = addOutboxItem(state, { kind: "needs_decision", title: "N-old", summary: "s" }, "2026-11-25T08:00:00Z");
    state = nOld.nextState;
    const nNew = addOutboxItem(state, { kind: "needs_decision", title: "N-new", summary: "s" }, "2026-11-25T11:00:00Z");
    state = nNew.nextState;
    const nAcked = addOutboxItem(state, { kind: "needs_decision", title: "N-acked", summary: "s", status: "acked" }, "2026-11-25T13:00:00Z");
    state = nAcked.nextState;

    const sorted = sortOutboxItems(state.outbox);
    expect(sorted.map((item) => item.id)).toEqual([
      nNew.item.id,
      nOld.item.id,
      b1.item.id,
      d1.item.id,
      nAcked.item.id,
    ]);
    expect(state.outbox[0].id).toBe(d1.item.id);
  });

  it("acks outbox items idempotently while preserving original ackedAt", () => {
    const empty = createEmptyHubState("2026-11-25T00:00:00Z");
    const added = addOutboxItem(empty, { kind: "needs_decision", title: "Approve", summary: "Deploy?" }, "2026-11-25T01:00:00Z");
    expect(added.item.id).toBe("out-20261125-0001");

    const firstAck = ackOutboxItem(
      added.nextState,
      { id: added.item.id, note: "approved" },
      "2026-11-25T02:00:00Z",
    );
    expect(firstAck.item.status).toBe("acked");
    expect(firstAck.item.ackedAt).toBe("2026-11-25T02:00:00Z");
    expect(firstAck.item.ackNote).toBe("approved");

    const secondAck = ackOutboxItem(
      firstAck.nextState,
      { id: added.item.id, note: "ignored repeat" },
      "2026-11-25T05:00:00Z",
    );
    expect(secondAck.nextState).toBe(firstAck.nextState);
    expect(secondAck.item.ackedAt).toBe("2026-11-25T02:00:00Z");
    expect(secondAck.item.ackNote).toBe("approved");
  });

  it("merges HQ JSONL objects idempotently and dedupes by id", () => {
    const empty = createEmptyHubState("2026-11-25T00:00:00Z");
    const hqInbox = [
      {
        id: "in-20261125-0001",
        rawText: "HQ capture one",
        source: "user",
        status: "triaged",
        targetProject: "paseo-bot",
        tags: ["paseo"],
        linkedThreadId: "thread-1",
        destination: null,
        notes: [{ at: "2026-11-25T12:46:49.668Z", text: "note" }],
        createdAt: "2026-11-25T12:46:49.668Z",
        updatedAt: "2026-11-25T12:46:49.668Z",
      },
      {
        id: "in-20261125-0001",
        rawText: "Duplicate in same batch",
      },
    ];
    const hqOutbox = [
      {
        id: "out-20261125-0001",
        kind: "delivered",
        title: "Step 1 done",
        summary: "Blueprint ready",
        status: "delivered",
        threadId: "mcp:launch:abc",
        threadLink: "[Butler](t3-thread://v2/abc)",
        inboxId: "in-20261125-0001",
        createdAt: "2026-11-25T12:46:49.717Z",
        ackedAt: null,
        ackNote: null,
      },
    ];

    const first = mergeImportedHq(empty, hqInbox, hqOutbox, "2026-11-25T13:00:00Z");
    expect(first.importedInbox).toBe(1);
    expect(first.importedOutbox).toBe(1);
    expect(first.nextState.inbox[0].linkedAgentId).toBe("thread-1");
    expect(first.nextState.outbox[0].agentId).toBe("mcp:launch:abc");

    const second = mergeImportedHq(first.nextState, hqInbox, hqOutbox, "2026-11-25T13:05:00Z");
    expect(second.importedInbox).toBe(0);
    expect(second.importedOutbox).toBe(0);
    expect(second.nextState).toBe(first.nextState);

    const nextGenerated = addInboxItem(first.nextState, { rawText: "new thought" }, "2026-11-25T13:10:00Z");
    expect(nextGenerated.item.id).toBe("in-20261125-0002");
  });
});

describe("inbox_outbox adapter RPC & event bus", () => {
  it("handles RPC mutations, HQ JSONL import, and event bus persistence", async () => {
    const { dir, kernel, invoke } = createTestKernel();
    const revisions: number[] = [];
    kernel.events.on("state.changed", (snap: { revision: number }) => {
      revisions.push(snap.revision);
    });

    const addedIn = (await invoke(inboxAddRpc.name, { rawText: "Idea A", source: "user", tags: [] })) as { id: string };
    await invoke(inboxUpdateRpc.name, { id: addedIn.id, status: "triaged", note: "ok" });
    const addedOut = (await invoke(outboxAddRpc.name, {
      kind: "needs_decision",
      title: "Pick DB",
      summary: "SQLite or JSON?",
      status: "pending",
      botId: "butler",
      agentId: null,
      threadLink: "",
      inboxId: addedIn.id,
    })) as { id: string };
    await invoke(outboxAckRpc.name, { id: addedOut.id, note: "JSON" });

    const hqDir = path.join(dir, "hq");
    fs.mkdirSync(path.join(hqDir, "inbox"), { recursive: true });
    fs.mkdirSync(path.join(hqDir, "outbox"), { recursive: true });
    fs.writeFileSync(
      path.join(hqDir, "inbox", "items.jsonl"),
      `${JSON.stringify({ id: "in-20261120-0001", rawText: "From HQ" })}\n{broken json}\n`,
    );
    const importRes = await invoke(inboxImportHqRpc.name, { hqDir });
    expect(importRes).toEqual({ importedInbox: 1, importedOutbox: 0 });
    expect(await invoke(inboxImportHqRpc.name, { hqDir })).toEqual({ importedInbox: 0, importedOutbox: 0 });

    const captured = await new Promise<{ id: string }>((resolve, reject) => {
      kernel.events.emit("inbox.capture", { rawText: "Captured via event", source: "companion", resolve, reject });
    });
    expect(captured.id).toMatch(/^in-\d{8}-\d{4}$/);

    await new Promise<void>((resolve, reject) => {
      kernel.events.emit("inbox.markDispatched", {
        inboxId: captured.id,
        botId: "lead-1",
        agentId: "agent-55",
        title: "Work",
        resolve,
        reject,
      });
    });

    await new Promise<{ id: string }>((resolve, reject) => {
      kernel.events.emit("outbox.enqueue", {
        kind: "delivered",
        title: "Done",
        summary: "Finished work",
        status: "delivered",
        resolve,
        reject,
      });
    });

    const finalState = kernel.store.read();
    expect(finalState.inbox.find((i) => i.id === captured.id)?.status).toBe("dispatched");
    expect(finalState.outbox).toHaveLength(2);
    expect(revisions.length).toBeGreaterThanOrEqual(7);

    kernel.dispose();
  });
});
