import type {
  PluginHandlerContext,
  PluginHookContext,
  PluginHooks,
  PluginHookPayload,
  PluginHookResult,
  PluginServerContext,
  PluginSubscriptionContext,
} from "@getpaseo/plugin/server";
import type {
  PluginRpcContract,
  PluginSubscriptionContract,
} from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { DomainError, ERROR_CODES } from "../../shared/contracts";
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

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>();

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
      fn(payload);
    }
  }
}

export class ServerKernel {
  readonly store: StateStore;
  readonly logger: Logger;
  readonly adapter: unknown;
  readonly events = new EventBus();

  private readonly server: PluginServerContext;
  private readonly features = new Map<string, ServerFeature>();
  private readonly cleanups: (() => void)[] = [];
  private readonly hookChains = new Map<keyof PluginHooks, GenericHookFn[]>();

  constructor(deps: KernelDeps) {
    this.server = deps.server;
    this.store = deps.store;
    this.logger = deps.logger;
    this.adapter = deps.adapter;
  }

  register(feature: ServerFeature): void {
    if (this.features.has(feature.manifest.id)) {
      throw new DomainError(
        "kernel",
        "register",
        ERROR_CODES.DUPLICATE_FEATURE,
        `Feature "${feature.manifest.id}" is already registered`,
      );
    }
    this.features.set(feature.manifest.id, feature);
    const cleanup = feature.register(this);
    if (typeof cleanup === "function") this.cleanups.push(cleanup);
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
        const msg = err instanceof Error ? err.message : String(err);
        const code = err instanceof DomainError ? err.code : ERROR_CODES.ADAPTER_FAILURE;
        this.logger.error(featureId, contract.name, code, msg);
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
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(featureId, contract.name, ERROR_CODES.ADAPTER_FAILURE, msg);
        throw err;
      }
    });
  }

  addHook<Name extends keyof PluginHooks>(
    name: Name,
    handler: (payload: PluginHookPayload<Name>, context: PluginHookContext) => Promise<PluginHookResult<Name>>,
  ): () => void {
    let chain = this.hookChains.get(name);
    if (!chain) {
      chain = [];
      this.hookChains.set(name, chain);
      const registerOnServer = this.server.addHook as unknown as (
        hookName: Name,
        fn: GenericHookFn,
      ) => () => void;
      const detach = registerOnServer(name, async (payload, context) => {
        return this.runHookChain(name, payload, context);
      });
      this.cleanups.push(detach);
    }
    const wrapped: GenericHookFn = (payload, context) =>
      handler(payload as PluginHookPayload<Name>, context);
    chain.push(wrapped);
    return () => {
      const idx = chain.indexOf(wrapped);
      if (idx !== -1) chain.splice(idx, 1);
    };
  }

  private async runHookChain(
    name: keyof PluginHooks,
    payload: unknown,
    context: PluginHookContext,
  ): Promise<unknown> {
    const chain = this.hookChains.get(name) ?? [];
    if (chain.length === 0) return undefined;

    let currentPayload = payload;
    let lastResult: unknown = undefined;
    for (const fn of chain) {
      const res = await fn(currentPayload, context);
      if (
        res !== undefined &&
        typeof currentPayload === "object" &&
        currentPayload !== null &&
        "request" in (currentPayload as Record<string, unknown>)
      ) {
        lastResult = res;
        currentPayload = { ...(currentPayload as Record<string, unknown>), request: res };
      }
    }
    return lastResult;
  }

  dispose(): void {
    while (this.cleanups.length > 0) {
      const fn = this.cleanups.pop();
      try {
        fn?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn("kernel", "dispose", msg);
      }
    }
    this.features.clear();
    this.hookChains.clear();
  }
}
