import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { BotHubSnapshot } from "../../shared/contracts";
import {
  botArchiveRpc,
  botOpenSessionRpc,
  botSectionDeleteRpc,
  botSectionUpsertRpc,
  botSnapshotRpc,
  botUpsertRpc,
  hubSubscribe,
  inboxAddRpc,
  inboxImportHqRpc,
  inboxUpdateRpc,
  outboxAckRpc,
  outboxAddRpc,
  threadDispatchRpc,
  threadInspectRpc,
} from "../../shared/rpc";

const SNAPSHOT_KEY = ["paseo-bot", "snapshot"] as const;

export function useHubSnapshot() {
  const queryClient = useQueryClient();
  const fetchSnapshot = useRpc(botSnapshotRpc);

  const query = useQuery<BotHubSnapshot>({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => fetchSnapshot({}),
    staleTime: 10_000,
  });

  const handleEvent = useCallback(
    (snapshot: BotHubSnapshot) => {
      queryClient.setQueryData(SNAPSHOT_KEY, snapshot);
    },
    [queryClient],
  );

  const subState = useSubscription(hubSubscribe, {}, handleEvent);
  const refresh = useCallback(async () => {
    const next = await fetchSnapshot({});
    queryClient.setQueryData(SNAPSHOT_KEY, next);
    return next;
  }, [fetchSnapshot, queryClient]);

  return {
    snapshot: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    subStatus: subState.status,
    refresh,
  };
}

export function useHubActions() {
  const queryClient = useQueryClient();
  const fetchSnapshot = useRpc(botSnapshotRpc);

  const syncAfterMutation = useCallback(async () => {
    const next = await fetchSnapshot({});
    queryClient.setQueryData(SNAPSHOT_KEY, next);
  }, [fetchSnapshot, queryClient]);

  const upsertBot = useMutation({
    mutationFn: useRpc(botUpsertRpc),
    onSuccess: syncAfterMutation,
  });
  const archiveBot = useMutation({
    mutationFn: useRpc(botArchiveRpc),
    onSuccess: syncAfterMutation,
  });
  const upsertSection = useMutation({
    mutationFn: useRpc(botSectionUpsertRpc),
    onSuccess: syncAfterMutation,
  });
  const deleteSection = useMutation({
    mutationFn: useRpc(botSectionDeleteRpc),
    onSuccess: syncAfterMutation,
  });
  const openBotSession = useMutation({
    mutationFn: useRpc(botOpenSessionRpc),
    onSuccess: syncAfterMutation,
  });
  const addInbox = useMutation({
    mutationFn: useRpc(inboxAddRpc),
    onSuccess: syncAfterMutation,
  });
  const updateInbox = useMutation({
    mutationFn: useRpc(inboxUpdateRpc),
    onSuccess: syncAfterMutation,
  });
  const importHq = useMutation({
    mutationFn: useRpc(inboxImportHqRpc),
    onSuccess: syncAfterMutation,
  });
  const addOutbox = useMutation({
    mutationFn: useRpc(outboxAddRpc),
    onSuccess: syncAfterMutation,
  });
  const ackOutbox = useMutation({
    mutationFn: useRpc(outboxAckRpc),
    onSuccess: syncAfterMutation,
  });
  const dispatchThread = useMutation({
    mutationFn: useRpc(threadDispatchRpc),
    onSuccess: syncAfterMutation,
  });
  const inspectThread = useRpc(threadInspectRpc);

  return {
    upsertBot,
    archiveBot,
    upsertSection,
    deleteSection,
    openBotSession,
    addInbox,
    updateInbox,
    importHq,
    addOutbox,
    ackOutbox,
    dispatchThread,
    inspectThread,
  };
}
