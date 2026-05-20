import "../app/env.js";

import { Client, GatewayIntentBits, Partials, type Message as DiscordMessage } from "discord.js";

import { shouldIngestDiscordEvent, normalizeDiscordEvent } from "../app/intake.js";
import { processMessage, ingestMessage } from "../app/workflow.js";
import { phase1State } from "../api/app.js";

const token = process.env.DISCORD_TOKEN;

function isProcessableMessage(message: DiscordMessage): boolean {
  return !message.author.bot && message.content.trim().length > 0;
}

if (token === undefined) {
  console.log("DISCORD_TOKEN is not set. Bot entrypoint is available but not connected.");
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
      const event = {
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
      if (!shouldIngestDiscordEvent(event, phase1State.settings)) {
        return;
      }
      const normalized = normalizeDiscordEvent(event);
      const ingested = ingestMessage(phase1State, normalized);
      await processMessage(phase1State, ingested);
    })();
  });

  await client.login(token);
  console.log("curacuri.ai Discord bot connected");
}
