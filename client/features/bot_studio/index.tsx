import type {
  PluginAgentPanelProps,
  PluginClientContext,
  PluginScreenProps,
  PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import type { ClientFeature } from "../../core/kernel";
import { BotDetailsDrawer } from "./BotDetailsDrawer";
import { BotStudioEditor } from "./BotStudioEditor";

export const botStudioFeature: ClientFeature = {
  manifest: {
    id: "bot_studio",
    name: "Bot 团队配置与详情抽屉",
  },
  register(client: PluginClientContext) {
    const BotStudioScreen = (props: PluginScreenProps) => (
      <BotStudioEditor {...props} initialBotId={props.params.botId} />
    );
    const BotStudioSettingsScreen = (props: PluginSurfaceProps) => <BotStudioEditor {...props} />;
    const BotDetailsPanel = (props: PluginAgentPanelProps) => (
      <BotDetailsDrawer
        {...props}
        onOpenStudio={(botId) =>
          client.openScreen({
            screenId: "bot-studio",
            params: botId ? { botId } : undefined,
          })
        }
      />
    );

    const cleanups = [
      client.addScreen({
        id: "bot-studio",
        title: "Bot 团队管理",
        Component: BotStudioScreen,
      }),
      client.addSettingsScreen({
        id: "bots",
        title: "Bot 团队",
        icon: "Bot",
        Component: BotStudioSettingsScreen,
      }),
      client.addAgentPanel({
        id: "bot-details",
        title: "Bot 详情",
        icon: "UserRound",
        Component: BotDetailsPanel,
      }),
    ];

    return () => {
      while (cleanups.length > 0) {
        void cleanups.pop()?.();
      }
    };
  },
};
