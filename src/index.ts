import { createServer } from "node:http";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "./config.js";
import { DiscordBotToolkitClient } from "./composio/discord-bot.js";
import { SupportSessionManager } from "./composio/session.js";
import { registerSupportListeners } from "./discord/listeners.js";

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("composio discord support bot running");
});

server.listen(config.port, () => {
  console.log(`[health] listening on http://localhost:${config.port}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const sessions = new SupportSessionManager();
const discordBot = new DiscordBotToolkitClient();

client.once("ready", (readyClient) => {
  console.log(`[discord] logged in as ${readyClient.user.tag}`);
  console.log("[discord] support channels", {
    channelIds:
      config.supportChannelIds.length > 0 ? config.supportChannelIds : "all",
  });
});

registerSupportListeners(client, sessions, discordBot);

const shutdown = async (signal: string) => {
  console.log(`[shutdown] received ${signal}`);
  server.close();
  client.destroy();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.discordToken);
