import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerClientFeatures } from "./client/core/kernel";
import { botSidebarFeature } from "./client/features/bot_sidebar/index";
import { botStudioFeature } from "./client/features/bot_studio/index";
import { dsThemeFeature } from "./client/features/ds_theme/index";
import { inboxOutboxHubFeature } from "./client/features/inbox_outbox_hub/index";
import { timelinePolishFeature } from "./client/features/timeline_polish/index";

export default function contribute(client: PluginClientContext) {
  return registerClientFeatures(client, [
    dsThemeFeature,
    botSidebarFeature,
    botStudioFeature,
    inboxOutboxHubFeature,
    timelinePolishFeature,
  ]);
}
