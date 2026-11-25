import type {
  PluginHandlerContext,
  PluginHookContext,
  PluginHooks,
  PluginHookPayload,
  PluginHookResult,
  PluginServerContext,
  PluginSubscriptionContext,
} from "@getpaseo/plugin/server";
import type { PluginRpcContract, PluginSubscriptionContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { DomainError, ERROR_CODES, type AckEventBase, type PersistedHubState } from "../../shared/contracts";
import type { Logger } from "./logger";
import type { StateStore } from "./store";

type WireValue<Value> = Value extends Uint8Array ? Uint8Array : Value;

export interface FeatureManifest {
  readonly id: string;
  readonly name: string;
}

export interface ServerFeature {
  readonly manifest: FeatureManifest;
  register(kernel: ServerKernel): void | (() => void);
}

export interface KernelDeps {
  readonly server: PluginServerContext;
  readonly store: StateStore;
  readonly logger: Logger;
  readonly adapter: unknown;
}

type EventListener<Payload = unknown> = (payload: Payload) => void;
type GenericHookFn = (payload: unknown, context: PluginHookContext) => Promise<unknown>;

interface HookChainEntry {
  readonly chain: GenericHookFn[];
  readonly detach: () => void;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(private readonly onError?: (topic: string, err: unknown) => void) {}

  on<Payload = unknown>(topic: string, listener: EventListener<Payload>): () => void {
    const bucket = this.listeners.get(topic) ?? new Set<EventListener>();
    bucket.add(listener as EventListener);
    this.listeners.set(topic, bucket);
    return () => {
      bucket.delete(listener as EventListener);
      if (bucket.size === 0) this.listeners.delete(topic);
    };
  }

  emit<Payload = unknown>(topic: string, payload: Payload): void {
    const bucket = this.listeners.get(topic);
    if (!bucket) return;
    for (const fn of [...bucket]) {
      try {
        fn(payload);
      } catch (err) {
        if (this.onError) this.onError(topic, err);
        else console.error(`[EventBus][${topic}]`, err);
      }
    }
  }

  emitWithAck<Result, Payload extends AckEventBase<Result> = AckEventBase<Result>>(
    topic: string,
    payload: Omit<Payload, "ackAccepted" | "resolve" | "reject">,
    timeoutMs = 5000,
  ): Promise<Result | null> {
    let accepted = false;
    let settled = false;
    return new Promise<Result | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new DomainError("kernel", `emitWithAck:${topic}`, ERROR_CODES.ADAPTER_FAILURE, `Event "${topic}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const finish = (cb: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cb();
      };

      try {
        this.emit(topic, {
          ...payload,
          ackAccepted: () => {
            accepted = true;
          },
          resolve: (value: Result | null) => finish(() => resolve(value)),
          reject: (err: unknown) => finish(() => reject(err)),
        } as Payload);
      } catch (err) {
        finish(() => reject(err));
        return;
      }
      if (!accepted) finish(() => resolve(null));
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

export class ServerKernel {
  readonly store: StateStore;
  readonly logger: Logger;
  readonly adapter: unknown;
  readonly events: EventBus;

  private readonly server: PluginServerContext;
  private readonly features = new Map<string, ServerFeature>();
  private readonly cleanups: (() => void)[] = [];
  private readonly hookChains = new Map<keyof PluginHooks, HookChainEntry>();

  constructor(deps: KernelDeps) {
    this.server = deps.server;
    this.store = deps.store;
    this.logger = deps.logger;
    this.adapter = deps.adapter;
    this.events = new EventBus((topic, err) => {
      this.logger.error("kernel", `event:${topic}`, ERROR_CODES.ADAPTER_FAILURE, errMsg(err));
    });
  }

  register(feature: ServerFeature): void {
    if (this.features.has(feature.manifest.id)) {
      throw new DomainError("kernel", "register", ERROR_CODES.DUPLICATE_FEATURE, `Feature "${feature.manifest.id}" is already registered`);
    }
    this.features.set(feature.manifest.id, feature);
    const cleanup = feature.register(this);
    if (typeof cleanup === "function") this.cleanups.push(cleanup);
  }

  async commitState<Result>(
    _featureId: string,
    mutator: (state: PersistedHubState) => { nextState: PersistedHubState; result: Result },
  ): Promise<Result> {
    const { result, state, changed } = await this.store.update(mutator);
    if (changed) this.events.emit("state.changed", state);
    return result;
  }

  handleRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
    featureId: string,
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginHandlerContext,
    ) => WireValue<ZodInput<OutputSchema>> | Promise<WireValue<ZodInput<OutputSchema>>>,
  ): void {
    this.server.handle(contract, async (input, context) => {
      try {
        return await handler(input, context);
      } catch (err) {
        const code = err instanceof DomainError ? err.code : ERROR_CODES.ADAPTER_FAILURE;
        this.logger.error(featureId, contract.name, code, errMsg(err));
        throw err;
      }
    });
  }

  handleSubscription<InputSchema extends ZodType, EventSchema extends ZodType>(
    featureId: string,
    contract: PluginSubscriptionContract<InputSchema, EventSchema>,
    handler: (
      input: ZodOutput<InputSchema>,
      context: PluginSubscriptionContext<WireValue<ZodInput<EventSchema>>>,
    ) => void | Promise<void>,
  ): void {
    this.server.handle(contract, async (input, context) => {
      try {
        await handler(input, context);
      } catch (err) {
        this.logger.error(featureId, contract.name, ERROR_CODES.ADAPTER_FAILURE, errMsg(err));
        throw err;
      }
    });
  }

  addHook<Name extends keyof PluginHooks>(
    name: Name,
    handler: (payload: PluginHookPayload<Name>, context: PluginHookContext) => Promise<PluginHookResult<Name>>,
  ): () => void {
    let entry = this.hookChains.get(name);
    if (!entry) {
      const registerOnServer = this.server.addHook as unknown as (hookName: Name, fn: GenericHookFn) => () => void;
      const detach = registerOnServer(name, (payload, context) => this.runHookChain(name, payload, context));
      entry = { chain: [], detach };
      this.hookChains.set(name, entry);
    }
    const wrapped: GenericHookFn = (payload, context) => handler(payload as PluginHookPayload<Name>, context);
    entry.chain.push(wrapped);
    return () => {
      const current = this.hookChains.get(name);
      if (!current) return;
      const idx = current.chain.indexOf(wrapped);
      if (idx !== -1) current.chain.splice(idx, 1);
      if (current.chain.length === 0) {
        this.hookChains.delete(name);
        current.detach();
      }
    };
  }

  private async runHookChain(name: keyof PluginHooks, payload: unknown, context: PluginHookContext): Promise<unknown> {
    const entry = this.hookChains.get(name);
    const chain = entry ? [...entry.chain] : [];
    if (chain.length === 0) return undefined;

    const isRequestHook = typeof payload === "object" && payload !== null && "request" in (payload as Record<string, unknown>);
    let currentPayload = payload;
    let lastResult: unknown = undefined;
    for (const fn of chain) {
      if (!isRequestHook) {
        try {
          await fn(currentPayload, context);
        } catch (err) {
          this.logger.error("kernel", `hook:${String(name)}`, ERROR_CODES.ADAPTER_FAILURE, errMsg(err));
        }
        continue;
      }
      const res = await fn(currentPayload, context);
      if (res !== undefined && typeof currentPayload === "object" && currentPayload !== null && "request" in (currentPayload as Record<string, unknown>)) {
        lastResult = res;
        currentPayload = { ...(currentPayload as Record<string, unknown>), request: res };
      }
    }
    return lastResult;
  }

  dispose(): void {
    while (this.cleanups.length > 0) {
      try {
        this.cleanups.pop()?.();
      } catch (err) {
        this.logger.warn("kernel", "dispose", errMsg(err));
      }
    }
    for (const entry of this.hookChains.values()) {
      try {
        entry.detach();
      } catch (err) {
        this.logger.warn("kernel", "dispose", errMsg(err));
      }
    }
    this.features.clear();
    this.hookChains.clear();
    this.events.clear();
  }
}
