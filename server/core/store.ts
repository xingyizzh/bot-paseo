import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createEmptyHubState,
  PersistedHubStateSchema,
  type PersistedHubState,
} from "../../shared/contracts";

export function resolveDataDir(): string {
  const override = process.env.PASEO_BOT_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".paseo", "paseo-bot-data");
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(16).slice(2, 8)}`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function backupCorruptState(statePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 6);
  const backupPath = path.join(path.dirname(statePath), `hub-state.corrupt.${stamp}-${suffix}.json`);
  try {
    if (fs.existsSync(statePath)) {
      fs.renameSync(statePath, backupPath);
    }
  } catch {
    // Best-effort backup only.
  }
  return backupPath;
}

export interface StateCommit<Result> {
  result: Result;
  state: PersistedHubState;
  changed: boolean;
}

export interface StateStore {
  readonly statePath: string;
  read(): PersistedHubState;
  update<Result>(
    mutator: (state: PersistedHubState) => { nextState: PersistedHubState; result: Result },
  ): Promise<StateCommit<Result>>;
}

export function createJsonStateStore(
  dataDir = resolveDataDir(),
  onError?: (msg: string) => void,
): StateStore {
  const statePath = path.join(dataDir, "hub-state.json");
  let writeQueue: Promise<unknown> = Promise.resolve();

  function read(): PersistedHubState {
    if (!fs.existsSync(statePath)) return createEmptyHubState();
    try {
      const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as unknown;
      return PersistedHubStateSchema.parse(raw);
    } catch (err) {
      const backupPath = backupCorruptState(statePath);
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `Corrupt state at ${statePath} (backed up to ${backupPath}): ${detail}`;
      if (onError) onError(msg);
      else console.error(msg);
      return createEmptyHubState();
    }
  }

  function update<Result>(
    mutator: (state: PersistedHubState) => { nextState: PersistedHubState; result: Result },
  ): Promise<StateCommit<Result>> {
    const task = writeQueue.then(() => {
      const current = read();
      const { nextState, result } = mutator(current);
      if (nextState !== current) {
        const stamped: PersistedHubState = {
          ...nextState,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        const validated = PersistedHubStateSchema.parse(stamped);
        writeAtomic(statePath, `${JSON.stringify(validated, null, 2)}\n`);
        return { result, state: validated, changed: true };
      }
      return { result, state: current, changed: false };
    });
    writeQueue = task.catch(() => undefined);
    return task;
  }

  return { statePath, read, update };
}
