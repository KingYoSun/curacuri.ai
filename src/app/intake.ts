import { hashAuthorId, newId, nowIso, stableId } from "./ids.js";
import { sampleGuildId } from "./settings.js";
import {
  type DiscordEvent,
  type GuildSettings,
  type Message,
  type SampleLogRecord,
} from "../shared/types.js";

export function shouldIngestDiscordEvent(event: DiscordEvent, settings: GuildSettings): boolean {
  if (event.isDm || event.guildId === null) {
    return false;
  }
  if (settings.excludedChannelIds.includes(event.channelId)) {
    return false;
  }
  return settings.targetChannelIds.includes(event.channelId);
}

function channelIdFromContext(channelContext: string): string {
  const match = /^#(?<name>[\w-]+)/u.exec(channelContext);
  return match?.groups?.name ?? "general";
}

function channelNameFromContext(channelContext: string): string {
  return channelContext.split("/")[0]?.trim() ?? "#general";
}

export function normalizeSampleRecord(record: SampleLogRecord, index: number): Message {
  const channelId = channelIdFromContext(record.channel_context);
  const messageId = stableId(["sample", String(index), channelId, record.text]);
  const postedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();

  return {
    id: newId(),
    source: "sample_log",
    guildId: sampleGuildId,
    channelId,
    channelName: channelNameFromContext(record.channel_context),
    messageId,
    threadId: null,
    authorIdHash: hashAuthorId(`sample-user-${String(index % 17)}`),
    content: record.text,
    postedAt,
    ingestedAt: nowIso(),
    deletedAt: null,
  };
}

export function normalizeDiscordEvent(event: DiscordEvent): Message {
  if (event.guildId === null) {
    throw new Error("DM events cannot be normalized");
  }

  return {
    id: newId(),
    source: "discord",
    guildId: event.guildId,
    channelId: event.channelId,
    channelName: event.channelName,
    messageId: event.messageId,
    threadId: event.threadId ?? null,
    authorIdHash: hashAuthorId(event.authorId),
    content: event.content,
    postedAt: event.postedAt,
    ingestedAt: nowIso(),
    deletedAt: null,
  };
}

export function parseSampleJsonl(jsonl: string): readonly SampleLogRecord[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SampleLogRecord);
}
