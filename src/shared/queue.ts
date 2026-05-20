export const queueNames = [
  "discord.ingest",
  "message.classify",
  "ops.notify",
  "auto_reply.decide",
  "auto_reply.send",
  "faq.generate",
  "report.weekly",
] as const;

export type QueueName = (typeof queueNames)[number];

export type DiscordIngestPayload =
  | {
      readonly kind: "discord_event";
      readonly event: DiscordEvent;
    }
  | {
      readonly kind: "sample_record";
      readonly record: SampleLogRecord;
      readonly index: number;
      readonly recordId?: string;
    };

export type MessageClassifyPayload = {
  readonly messageId: string;
};

export type OpsNotifyPayload = {
  readonly classificationId?: string;
  readonly messageIds?: readonly string[];
};

export type AutoReplyDecidePayload = {
  readonly messageId: string;
  readonly classificationId: string;
};

export type AutoReplySendPayload = {
  readonly autoReplyId: string;
};

export type FaqGeneratePayload = {
  readonly messageIds?: readonly string[];
  readonly periodStart?: string;
  readonly periodEnd?: string;
};

export type ReportWeeklyPayload = {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly channelIds: readonly string[];
};

export type QueuePayload =
  | DiscordIngestPayload
  | MessageClassifyPayload
  | OpsNotifyPayload
  | AutoReplyDecidePayload
  | AutoReplySendPayload
  | FaqGeneratePayload
  | ReportWeeklyPayload;

export function assertKnownQueueName(name: string): asserts name is QueueName {
  if (!queueNames.includes(name as QueueName)) {
    throw new Error(`unknown queue name: ${name}`);
  }
}
import type { DiscordEvent, SampleLogRecord } from "./types.js";
