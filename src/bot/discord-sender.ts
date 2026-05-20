import type { AdminNotification, AutoReply, Message } from "../shared/types.js";

export type DiscordSendResult = {
  readonly sentMessageId: string;
};

export type DiscordSender = {
  sendAdminNotification(notification: AdminNotification): Promise<DiscordSendResult>;
  sendAutoReply(reply: AutoReply, message: Message): Promise<DiscordSendResult>;
};

function dryRunEnabled(): boolean {
  return process.env.DISCORD_DRY_RUN !== "false";
}

function discordToken(): string | null {
  const value = process.env.DISCORD_TOKEN;
  return value === undefined || value.trim().length === 0 ? null : value;
}

async function postDiscordMessage(
  token: string,
  channelId: string,
  body: Record<string, unknown>,
): Promise<DiscordSendResult> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { readonly id?: unknown };
  if (!response.ok) {
    throw new Error(`Discord API failed: ${String(response.status)}`);
  }
  if (typeof json.id !== "string") {
    throw new Error("Discord API response did not include message id");
  }
  return { sentMessageId: json.id };
}

export function createDiscordSender(): DiscordSender {
  return {
    async sendAdminNotification(notification) {
      if (dryRunEnabled()) {
        return { sentMessageId: `dry-run:${notification.id}` };
      }
      const token = discordToken();
      if (token === null) {
        throw new Error("DISCORD_TOKEN is required when DISCORD_DRY_RUN=false");
      }
      return postDiscordMessage(token, notification.sentToChannelId, {
        content: `**${notification.title}**\n${notification.body}`,
      });
    },
    async sendAutoReply(reply, message) {
      if (dryRunEnabled()) {
        return { sentMessageId: `dry-run:${reply.id}` };
      }
      const token = discordToken();
      if (token === null) {
        throw new Error("DISCORD_TOKEN is required when DISCORD_DRY_RUN=false");
      }
      return postDiscordMessage(token, message.channelId, {
        content: reply.body,
        message_reference: {
          message_id: message.messageId,
          channel_id: message.channelId,
          guild_id: message.guildId,
          fail_if_not_exists: false,
        },
      });
    },
  };
}
