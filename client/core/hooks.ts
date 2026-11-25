import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginClientContext, PluginSubscriptionHandle } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ZodType } from "zod";
import type { BotHubSnapshot } from "../../shared/contracts";
import * as rpc from "../../shared/rpc";

const SNAPSHOT_KEY = ["paseo-bot", "snapshot"] as const;
export type HubSubStatus = "idle" | "connecting" | "live" | "closed" | "error";
interface HubStoreState { snapshot: BotHubSnapshot | null; subStatus: HubSubStatus }

let boundClient: PluginClientContext | null = null;
let activeHandle: PluginSubscriptionHandle | null = null;
let storeState: HubStoreState = { snapshot: null, subStatus: "idle" };
const listeners = new Set<() => void>();

function updateStore(patch: Partial<HubStoreState>): void {
  storeState = { ...storeState, ...patch };
  for (const listener of listeners) listener();
}

function stopSubscription(): void {
  const handle = activeHandle;
  activeHandle = null;
  if (handle) { try { handle(); } catch { /* ignore teardown */ } }
  if (storeState.subStatus !== "idle") updateStore({ subStatus: "idle" });
}

function startSubscription(): void {
  if (!boundClient || activeHandle) return;
  updateStore({ subStatus: "connecting" });
  try {
    const handle = boundClient.subscribe(rpc.hubSubscribe, {}, (snapshot) => updateStore({ snapshot, subStatus: "live" }), {
      onClosed: ({ error }) => {
        if (activeHandle !== handle) return;
        activeHandle = null;
        updateStore({ subStatus: error ? "error" : "closed" });
      },
    });
    activeHandle = handle;
    void handle.ready.then(
      () => { if (activeHandle === handle && storeState.subStatus === "connecting") updateStore({ subStatus: "live" }); },
      () => { if (activeHandle === handle) { activeHandle = null; updateStore({ subStatus: "error" }); } },
    );
  } catch {
    activeHandle = null;
    updateStore({ subStatus: "error" });
  }
}

export function bindHubSubscription(client: PluginClientContext): () => void {
  boundClient = client;
  if (listeners.size > 0 && !activeHandle) startSubscription();
  return () => {
    if (boundClient === client) boundClient = null;
    stopSubscription();
    storeState = { snapshot: null, subStatus: "idle" };
  };
}

function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && boundClient && !activeHandle) startSubscription();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) queueMicrotask(() => { if (listeners.size === 0) stopSubscription(); });
  };
}

const getStoreState = (): HubStoreState => storeState;

export function useHubSnapshot() {
  const queryClient = useQueryClient();
  const fetchSnapshot = useRpc(rpc.botSnapshotRpc);
  const store = useSyncExternalStore(subscribeStore, getStoreState, getStoreState);

  const query = useQuery<BotHubSnapshot>({
    queryKey: SNAPSHOT_KEY,
    queryFn: async () => {
      const next = await fetchSnapshot({});
      updateStore({ snapshot: next });
      return next;
    },
    staleTime: 10_000,
  });

  useEffect(() => {
    if (store.snapshot) queryClient.setQueryData(SNAPSHOT_KEY, store.snapshot);
  }, [queryClient, store.snapshot]);

  const refresh = useCallback(async () => {
    const next = await fetchSnapshot({});
    updateStore({ snapshot: next });
    queryClient.setQueryData(SNAPSHOT_KEY, next);
    return next;
  }, [fetchSnapshot, queryClient]);

  return {
    snapshot: store.snapshot ?? query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    subStatus: store.subStatus,
    refresh,
  };
}

function useHubMutation<InputSchema extends ZodType, OutputSchema extends ZodType>(
  contract: PluginRpcContract<InputSchema, OutputSchema>,
  syncAfterMutation: () => Promise<void>,
) {
  return useMutation({ mutationFn: useRpc(contract), onSuccess: syncAfterMutation });
}

export function useHubActions() {
  const queryClient = useQueryClient();
  const fetchSnapshot = useRpc(rpc.botSnapshotRpc);
  const syncAfterMutation = useCallback(async () => {
    if (storeState.subStatus === "live") return;
    const next = await fetchSnapshot({});
    updateStore({ snapshot: next });
    queryClient.setQueryData(SNAPSHOT_KEY, next);
  }, [fetchSnapshot, queryClient]);

  return {
    upsertBot: useHubMutation(rpc.botUpsertRpc, syncAfterMutation),
    archiveBot: useHubMutation(rpc.botArchiveRpc, syncAfterMutation),
    upsertSection: useHubMutation(rpc.botSectionUpsertRpc, syncAfterMutation),
    deleteSection: useHubMutation(rpc.botSectionDeleteRpc, syncAfterMutation),
    openBotSession: useHubMutation(rpc.botOpenSessionRpc, syncAfterMutation),
    addInbox: useHubMutation(rpc.inboxAddRpc, syncAfterMutation),
    updateInbox: useHubMutation(rpc.inboxUpdateRpc, syncAfterMutation),
    importHq: useHubMutation(rpc.inboxImportHqRpc, syncAfterMutation),
    addOutbox: useHubMutation(rpc.outboxAddRpc, syncAfterMutation),
    ackOutbox: useHubMutation(rpc.outboxAckRpc, syncAfterMutation),
    dispatchThread: useHubMutation(rpc.threadDispatchRpc, syncAfterMutation),
    inspectThread: useRpc(rpc.threadInspectRpc),
  };
}
