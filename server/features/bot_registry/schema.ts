import type { RpcInput } from "@getpaseo/plugin";
import {
  botArchiveRpc,
  botOpenSessionRpc,
  botSectionDeleteRpc,
  botSectionUpsertRpc,
  botSnapshotRpc,
  botUpsertRpc,
} from "../../../shared/rpc";

export type BotSnapshotInput = RpcInput<typeof botSnapshotRpc>;
export type BotUpsertInput = RpcInput<typeof botUpsertRpc>;
export type BotArchiveInput = RpcInput<typeof botArchiveRpc>;
export type BotSectionUpsertInput = RpcInput<typeof botSectionUpsertRpc>;
export type BotSectionDeleteInput = RpcInput<typeof botSectionDeleteRpc>;
export type BotOpenSessionInput = RpcInput<typeof botOpenSessionRpc>;
