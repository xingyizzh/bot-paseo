import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DS_BOT_DARK_THEME, DS_BOT_LIGHT_THEME } from "../../../shared/theme";
import type { ClientFeature } from "../../core/kernel";

export const dsThemeFeature: ClientFeature = {
  manifest: {
    id: "ds_theme",
    name: "DS-Bot 双主题",
  },
  register(client: PluginClientContext) {
    const cleanups = [
      client.addTheme(DS_BOT_LIGHT_THEME),
      client.addTheme(DS_BOT_DARK_THEME),
    ];
    return () => {
      while (cleanups.length > 0) {
        void cleanups.pop()?.();
      }
    };
  },
};
