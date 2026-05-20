import "../app/env.js";

import { Client, GatewayIntentBits, Partials, type Message as DiscordMessage } from "discord.js";

import { shouldIngestDiscordEvent } from "../app/intake.js";
import { createAppRuntime } from "../app/runtime.js";
import type { DiscordEvent } from "../shared/types.js";

const runtime = await createAppRuntime();
const token = process.env.DISCORD_TOKEN;

function isProcessableMessage(message: DiscordMessage): boolean {
  return !message.author.bot && message.content.trim().length > 0;
}

if (token === undefined || token.trim().length === 0) {
  console.log("DISCORD_TOKEN is not set. Bot entrypoint initialized without Gateway connection.");
} else {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.on("messageCreate", (message) => {
    void (async () => {
      if (!isProcessableMessage(message)) {
        return;
      }
      const event: DiscordEvent = {
        guildId: message.guildId,
        channelId: message.channelId,
        channelName: "name" in message.channel ? message.channel.name : "dm",
        messageId: message.id,
        threadId: message.channel.isThread() ? message.channel.id : null,
        authorId: message.author.id,
        content: message.content,
        postedAt: message.createdAt.toISOString(),
        isDm: message.guildId === null,
      };
      if (!shouldIngestDiscordEvent(event, await runtime.repository.getSettings())) {
        return;
      }
      await runtime.queues.add("discord.ingest", { kind: "discord_event", event });
    })();
  });

  await client.login(token);
  console.log("curacuri.ai Discord bot connected");
}
