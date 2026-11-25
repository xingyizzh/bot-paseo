import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHostClient } from "@getpaseo/client/node";
import { readLocalCredentialForTarget } from "@getpaseo/server/daemon-control";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_FAULTS = new Set(["missing-manifest", "bad-plugin-syntax", "broken-daemon-port"]);

function parseFaultArg(argv) {
  const idx = argv.indexOf("--inject-fault");
  if (idx === -1) return null;
  const fault = argv[idx + 1] ?? "";
  if (!VALID_FAULTS.has(fault)) {
    throw new Error(`Unknown fault "${fault}". Expected one of: ${[...VALID_FAULTS].join(", ")}`);
  }
  return fault;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Failed to allocate TCP port")));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function assert(cond, message) {
  if (!cond) throw new Error(`VERIFY ASSERTION FAILED: ${message}`);
}

function copyPluginForFault(destDir, fault) {
  fs.mkdirSync(destDir, { recursive: true });
  const copyEntries = [
    "paseo-plugin.json",
    "package.json",
    "OVERVIEW.md",
    "index.server.ts",
    "index.client.tsx",
    "shared",
    "server",
    "client",
  ];
  for (const name of copyEntries) {
    const src = path.join(ROOT, name);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(destDir, name), { recursive: true });
    }
  }
  const nodeModulesSrc = path.join(ROOT, "node_modules");
  if (fs.existsSync(nodeModulesSrc)) {
    fs.symlinkSync(nodeModulesSrc, path.join(destDir, "node_modules"), "dir");
  }
  if (fault === "missing-manifest") {
    fs.rmSync(path.join(destDir, "paseo-plugin.json"), { force: true });
  } else if (fault === "bad-plugin-syntax") {
    fs.appendFileSync(path.join(destDir, "index.client.tsx"), "\nexport const __brokenSyntax = (((;\n", "utf8");
  }
}

async function waitForDaemonHttp(listenAddr, paseoHome, daemonProc, getLogs) {
  const deadline = Date.now() + 25_000;
  let exited = false;
  daemonProc.once("exit", () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`Paseo daemon exited early:\n${getLogs()}`);
    }
    try {
      const cred = readLocalCredentialForTarget(paseoHome, listenAddr);
      if (cred) {
        const res = await fetch(`http://${listenAddr}/`);
        if (res.status === 200) return;
      }
    } catch {
      // retry until daemon publishes lock and accepts HTTP/WS
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Paseo daemon Web UI at http://${listenAddr}/\n${getLogs()}`);
}

async function stopProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  proc.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      resolve();
    }, 2_000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function runVerification(fault) {
  if (fault === "broken-daemon-port") {
    const unusedPort = await getFreePort();
    const client = createHostClient(`127.0.0.1:${unusedPort}`, {
      clientId: "paseo-bot-verify-fault",
      clientType: "cli",
      connectTimeoutMs: 2_000,
      reconnect: { enabled: false },
    });
    try {
      await client.connect();
      throw new Error("Expected connection failure on broken daemon port");
    } finally {
      await client.close().catch(() => {});
    }
  }

  const envPort = Number(process.env.PASEO_VERIFY_PORT ?? "");
  const port = Number.isInteger(envPort) && envPort > 0 ? envPort : await getFreePort();
  const listenAddr = `127.0.0.1:${port}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-bot-verify-"));
  const paseoHome = path.join(tmpRoot, "paseo-home");
  const botDataDir = path.join(tmpRoot, "bot-data");
  fs.mkdirSync(paseoHome, { recursive: true });
  fs.mkdirSync(botDataDir, { recursive: true });
  fs.writeFileSync(path.join(paseoHome, "config.json"), JSON.stringify({ pluginsEnabled: true }, null, 2), "utf8");

  let pluginSourceDir = ROOT;
  if (fault === "missing-manifest" || fault === "bad-plugin-syntax") {
    pluginSourceDir = path.join(tmpRoot, "fault-plugin");
    copyPluginForFault(pluginSourceDir, fault);
  }

  const logChunks = [];
  const daemonProc = spawn("npx", ["paseo", "daemon", "run", "--home", paseoHome], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PASEO_HOME: paseoHome,
      PASEO_LISTEN: listenAddr,
      PASEO_WEB_UI_ENABLED: "true",
      PASEO_BOT_DATA_DIR: botDataDir,
    },
  });
  daemonProc.stdout?.on("data", (d) => logChunks.push(String(d)));
  daemonProc.stderr?.on("data", (d) => logChunks.push(String(d)));
  const getLogs = () => logChunks.join("").slice(-6000);

  let client = null;
  try {
    await waitForDaemonHttp(listenAddr, paseoHome, daemonProc, getLogs);

    const connectDeadline = Date.now() + 10_000;
    while (true) {
      client = createHostClient(listenAddr, {
        clientId: "paseo-bot-verify",
        clientType: "cli",
        localCredential: () => readLocalCredentialForTarget(paseoHome, listenAddr) ?? undefined,
        connectTimeoutMs: 10_000,
        reconnect: { enabled: false },
      });
      try {
        await client.connect();
        break;
      } catch (err) {
        await client.close().catch(() => {});
        client = null;
        if (!String(err).includes("503") || Date.now() >= connectDeadline) throw err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    console.log(`[verify] Installing plugin from ${pluginSourceDir}...`);
    const installed = await client.installDirectoryPlugin(pluginSourceDir);
    assert(installed.id === "paseo-bot", `Unexpected plugin id: ${installed.id}`);
    assert(installed.enabled === true, "Plugin not enabled after install");
    assert(installed.status === "running", `Plugin status is ${installed.status}: ${installed.error ?? ""}`);

    const plugins = await client.listPlugins();
    const listed = plugins.find((p) => p.id === "paseo-bot");
    assert(listed && listed.status === "running" && !listed.error, `Plugin list check failed: ${JSON.stringify(listed)}`);

    const catalog = await client.getPluginCatalog();
    const catalogEntry = catalog.find((p) => p.id === "paseo-bot");
    assert(
      catalogEntry && typeof catalogEntry.clientBundle === "string" && catalogEntry.clientBundle.length > 500,
      `Missing or invalid compiled clientBundle (length=${catalogEntry?.clientBundle?.length ?? 0})`,
    );
    console.log(`[verify] Compiled client bundle ready (${catalogEntry.clientBundle.length} chars).`);

    const initial = await client.invokePluginRpc("paseo-bot", "paseo-bot.snapshot", {});
    assert(initial.revision >= 1, `Expected seeded revision >= 1, got ${initial.revision}`);
    assert(
      initial.bots.some((b) => b.id === "butler") && initial.bots.some((b) => b.id === "companion"),
      "Seeded butler/companion bots missing",
    );

    const startupLogs = await client.getPluginLogs("paseo-bot");
    const startupErrors = startupLogs.filter(
      (entry) =>
        entry.stream === "stderr" &&
        !/DeprecationWarning|node --trace-deprecation/.test(entry.message),
    );
    assert(startupErrors.length === 0, `Plugin startup stderr logs:\n${startupErrors.map((e) => e.message).join("\n")}`);

    const pushedSnapshots = [];
    const sub = client.observePluginRpc("paseo-bot", "paseo-bot.hub.subscribe", {});
    const unsubObserver = sub.subscribe({
      snapshot() {},
      update(msg) {
        if (msg.type === "plugin.rpc.event" && msg.payload?.event) {
          pushedSnapshots.push(msg.payload.event);
        }
      },
    });
    try {
      await sub.ready;
      await waitForCondition(() => pushedSnapshots.length >= 1, 5_000, "initial hub.subscribe push");

      const lead = await client.invokePluginRpc("paseo-bot", "paseo-bot.bot.upsert", {
        name: "Sandbox Project Lead",
        roleType: "project_lead",
        bio: "Real daemon verification lead",
        personaPrompt: "Keep workspace clean.",
        provider: "claude/sonnet",
        defaultCwd: ROOT,
        permissionMode: "workspace",
        sectionId: null,
        pinned: false,
      });
      assert(lead.name === "Sandbox Project Lead", "bot.upsert did not return created bot");

      await waitForCondition(
        () => pushedSnapshots.some((snap) => snap.bots?.some((b) => b.id === lead.id)),
        5_000,
        "live hub.subscribe push after bot.upsert",
      );
    } finally {
      unsubObserver();
      await sub.release().catch(() => {});
    }

    let companionRejected = false;
    try {
      await client.invokePluginRpc("paseo-bot", "paseo-bot.bot.upsert", {
        name: "Bad Companion",
        roleType: "companion",
        permissionMode: "full",
        defaultCwd: "",
      });
    } catch {
      companionRejected = true;
    }
    assert(companionRejected, "Companion permission escalation was NOT rejected");

    const inboxCreated = await client.invokePluginRpc("paseo-bot", "paseo-bot.inbox.add", {
      rawText: "Verbatim thought stored inside live daemon",
      source: "user",
      tags: ["verify"],
    });
    const inboxUpdated = await client.invokePluginRpc("paseo-bot", "paseo-bot.inbox.update", {
      id: inboxCreated.id,
      status: "triaged",
      note: "Triaged during verify",
    });
    assert(inboxUpdated.rawText === "Verbatim thought stored inside live daemon", "Inbox rawText mutated");
    assert(inboxUpdated.status === "triaged", "Inbox status did not transition");

    const outNeeds = await client.invokePluginRpc("paseo-bot", "paseo-bot.outbox.add", {
      kind: "needs_decision",
      title: "Approve release check",
      summary: "Needs human signoff",
    });
    const outDelivered = await client.invokePluginRpc("paseo-bot", "paseo-bot.outbox.add", {
      kind: "delivered",
      title: "Smoke delivered",
      summary: "Done",
    });
    const outAcked = await client.invokePluginRpc("paseo-bot", "paseo-bot.outbox.ack", {
      id: outNeeds.id,
      note: "Verified in sandbox",
    });
    assert(outAcked.status === "acked", "Outbox ack did not persist");
    const deliveredAcked = await client.invokePluginRpc("paseo-bot", "paseo-bot.outbox.ack", {
      id: outDelivered.id,
      note: "Verified delivered ack",
    });
    assert(deliveredAcked.status === "acked", "Delivered outbox ack did not persist");

    let emptyDigestRejected = false;
    try {
      await client.invokePluginRpc("paseo-bot", "paseo-bot.outbox.digest-to-butler", {});
    } catch (err) {
      emptyDigestRejected = String(err).includes("ERR_VALIDATION") || String(err).includes("Outbox");
    }
    assert(emptyDigestRejected, "outbox.digest-to-butler did not fail with validation error when all outbox items are acked");

    const disabledSettings = await client.invokePluginRpc("paseo-bot", "paseo-bot.settings.update", {
      paseoEnabled: false,
    });
    assert(disabledSettings.paseoEnabled === false, "settings.update did not set paseoEnabled=false");

    let dispatchBlocked = false;
    try {
      await client.invokePluginRpc("paseo-bot", "paseo-bot.thread.dispatch", {
        botId: lead.id,
        title: "Blocked while disabled",
        prompt: "Should fail",
        worktree: false,
      });
    } catch {
      dispatchBlocked = true;
    }
    assert(dispatchBlocked, "thread.dispatch was NOT blocked when paseoEnabled=false");

    const reenabledSettings = await client.invokePluginRpc("paseo-bot", "paseo-bot.settings.update", {
      paseoEnabled: true,
    });
    assert(reenabledSettings.paseoEnabled === true, "settings.update did not restore paseoEnabled=true");

    const finalSnap = await client.invokePluginRpc("paseo-bot", "paseo-bot.snapshot", {});
    assert(finalSnap.bots.length === 3, `Expected 3 bots, got ${finalSnap.bots.length}`);
    assert(finalSnap.settings?.paseoEnabled === true, "Final settings.paseoEnabled should be true");
    assert(finalSnap.inbox.some((i) => i.id === inboxCreated.id && i.status === "triaged"), "Inbox persistence check failed");
    assert(finalSnap.outbox.some((o) => o.id === outNeeds.id && o.status === "acked"), "Outbox persistence check failed");

    console.log("[PASS] Isolated Paseo v0.17.4 daemon + plugin + bundle + RPC + EventBus + isolation verification passed.");
  } finally {
    if (client) await client.close().catch(() => {});
    await stopProcess(daemonProc);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

try {
  const fault = parseFaultArg(process.argv.slice(2));
  await runVerification(fault);
} catch (err) {
  console.error(`[FAIL] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
