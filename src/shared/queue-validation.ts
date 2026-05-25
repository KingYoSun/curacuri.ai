import type {
  AutoReplyDecidePayload,
  AutoReplySendPayload,
  DiscordIngestPayload,
  FaqGeneratePayload,
  MessageClassifyPayload,
  OpsNotifyPayload,
  QueueName,
  QueuePayload,
  ReportWeeklyPayload,
} from "./queue.js";
import type { DiscordEvent, SampleLogRecord } from "./types.js";

export class QueuePayloadValidationError extends Error {
  constructor(
    readonly queueName: QueueName,
    message: string,
  ) {
    super(`${queueName} payload invalid: ${message}`);
    this.name = "QueuePayloadValidationError";
  }
}

function invalid(queueName: QueueName, message: string): never {
  throw new QueuePayloadValidationError(queueName, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string, queueName: QueueName): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    invalid(queueName, `${key} must be a non-empty string`);
  }
  return value;
}

function optionalStringField(
  source: Record<string, unknown>,
  key: string,
  queueName: QueueName,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    invalid(queueName, `${key} must be a string`);
  }
  return value;
}

function nullableStringField(
  source: Record<string, unknown>,
  key: string,
  queueName: QueueName,
): string | null | undefined {
  const value = source[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") {
    invalid(queueName, `${key} must be a string or null`);
  }
  return value;
}

function stringArrayField(
  source: Record<string, unknown>,
  key: string,
  queueName: QueueName,
): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    invalid(queueName, `${key} must be a non-empty string array`);
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      invalid(queueName, `${key} must be a non-empty string array`);
    }
    items.push(item);
  }
  return items;
}

function optionalStringArrayField(
  source: Record<string, unknown>,
  key: string,
  queueName: QueueName,
): readonly string[] | undefined {
  if (source[key] === undefined) return undefined;
  return stringArrayField(source, key, queueName);
}

function dateField(source: Record<string, unknown>, key: string, queueName: QueueName): string {
  const value = stringField(source, key, queueName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid(queueName, `${key} must be YYYY-MM-DD`);
  }
  return value;
}

function booleanField(source: Record<string, unknown>, key: string, queueName: QueueName): boolean {
  const value = source[key];
  if (typeof value !== "boolean") {
    invalid(queueName, `${key} must be boolean`);
  }
  return value;
}

function sampleRecord(value: unknown, queueName: QueueName): SampleLogRecord {
  if (!isRecord(value)) invalid(queueName, "record must be an object");
  return {
    text: stringField(value, "text", queueName),
    channel_context: stringField(value, "channel_context", queueName),
  };
}

function discordEvent(value: unknown, queueName: QueueName): DiscordEvent {
  if (!isRecord(value)) invalid(queueName, "event must be an object");
  const threadId = nullableStringField(value, "threadId", queueName);
  return {
    guildId: nullableStringField(value, "guildId", queueName) ?? null,
    channelId: stringField(value, "channelId", queueName),
    channelName: stringField(value, "channelName", queueName),
    messageId: stringField(value, "messageId", queueName),
    ...(threadId === undefined ? {} : { threadId }),
    authorId: stringField(value, "authorId", queueName),
    content: stringField(value, "content", queueName),
    postedAt: stringField(value, "postedAt", queueName),
    isDm: booleanField(value, "isDm", queueName),
  };
}

function validateDiscordIngest(payload: unknown): DiscordIngestPayload {
  const queueName = "discord.ingest";
  if (!isRecord(payload)) invalid(queueName, "payload must be an object");
  if (payload.kind === "discord_event") {
    return { kind: "discord_event", event: discordEvent(payload.event, queueName) };
  }
  if (payload.kind === "sample_record") {
    const index = payload.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      invalid(queueName, "index must be a non-negative integer");
    }
    return {
      kind: "sample_record",
      record: sampleRecord(payload.record, queueName),
      index,
      ...(typeof payload.recordId === "string" ? { recordId: payload.recordId } : {}),
    };
  }
  invalid(queueName, "kind must be discord_event or sample_record");
}

function validateMessageClassify(payload: unknown): MessageClassifyPayload {
  const queueName = "message.classify";
  if (!isRecord(payload)) invalid(queueName, "payload must be an object");
  return { messageId: stringField(payload, "messageId", queueName) };
}

function validateOpsNotify(payload: unknown): OpsNotifyPayload {
  const queueName = "ops.notify";
  if (!isRecord(payload)) invalid(queueName, "payload must be an object");
  const classificationId = optionalStringField(payload, "classificationId", queueName);
  const messageIds = optionalStringArrayField(payload, "messageIds", queueName);
  if (classificationId === undefined && messageIds === undefined) {
    invalid(queueName, "classificationId or messageIds is required");
  }
  return {
    ...(classificationId === undefined ? {} : { classificationId }),
    ...(messageIds === undefined ? {} : { messageIds }),
  };
}

function validateAutoReplyDecide(payload: unknown): AutoReplyDecidePayload {
  const queueName = "auto_reply.decide";
  if (!isRecord(payload)) invalid(queueName, "payload must be an object");
  return {
    messageId: stringField(payload, "messageId", queueName),
    classificationId: stringField(payload, "classificationId", queueName),
  };
}

function validateAutoReplySend(payload: unknown): AutoReplySendPayload {
  const queueName = "auto_reply.send";
  if (!isRecord(payload)) invalid(queueName, "payload must be an object");
  return { autoReplyId: stringField(payload, "autoReplyId", queueName) };
}

function validateFaqGenerate(payload: unknown): FaqGeneratePayload {
  const queueName = "faq.generate";
  if (!isRecord(payload)) invalid(queueName, "payload must be an object");
  const messageIds =
    payload.messageIds === undefined
      ? undefined
      : stringArrayField(payload, "messageIds", queueName);
  const periodStart =
    payload.periodStart === undefined ? undefined : dateField(payload, "periodStart", queueName);
  const periodEnd =
    payload.periodEnd === undefined ? undefined : dateField(payload, "periodEnd", queueName);
  return {
    ...(messageIds === undefined ? {} : { messageIds }),
    ...(periodStart === undefined ? {} : { periodStart }),
    ...(periodEnd === undefined ? {} : { periodEnd }),
  };
}

function validateReportWeekly(payload: unknown): ReportWeeklyPayload {
  const queueName = "report.weekly";
  if (!isRecord(payload)) invalid(queueName, "payload must be an object");
  return {
    periodStart: dateField(payload, "periodStart", queueName),
    periodEnd: dateField(payload, "periodEnd", queueName),
    channelIds: stringArrayField(payload, "channelIds", queueName),
  };
}

export function validateQueuePayload(queueName: QueueName, payload: unknown): QueuePayload {
  switch (queueName) {
    case "discord.ingest":
      return validateDiscordIngest(payload);
    case "message.classify":
      return validateMessageClassify(payload);
    case "ops.notify":
      return validateOpsNotify(payload);
    case "auto_reply.decide":
      return validateAutoReplyDecide(payload);
    case "auto_reply.send":
      return validateAutoReplySend(payload);
    case "faq.generate":
      return validateFaqGenerate(payload);
    case "report.weekly":
      return validateReportWeekly(payload);
  }
}
