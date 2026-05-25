import "../app/env.js";

import { Worker } from "bullmq";

import { createAppRuntime } from "../app/runtime.js";
import {
  handleAutoReplyDecide,
  handleDiscordIngest,
  handleFaqGenerate,
  handleMessageClassify,
  handleReportWeekly,
} from "../app/persistent-workflow.js";
import { nowIso } from "../app/ids.js";
import { createDiscordSender } from "../bot/discord-sender.js";
import { queueNames, type QueueName, type QueuePayload } from "../shared/queue.js";
import { validateQueuePayload } from "../shared/queue-validation.js";
import { sendPendingNotifications } from "./notifications.js";
import type {
  AutoReplyDecidePayload,
  AutoReplySendPayload,
  DiscordIngestPayload,
  FaqGeneratePayload,
  MessageClassifyPayload,
  ReportWeeklyPayload,
} from "../shared/queue.js";
import type { AutoReply } from "../shared/types.js";

const runtime = await createAppRuntime();
const sender = createDiscordSender();

async function sendAutoReply(autoReplyId: string): Promise<void> {
  const reply = await runtime.repository.getAutoReply(autoReplyId);
  if (reply?.status !== "drafted") {
    return;
  }
  const message = await runtime.repository.getMessage(reply.messageId);
  if (message?.deletedAt !== null) {
    const failed: AutoReply = {
      ...reply,
      status: "failed",
      decisionReason: "元投稿が存在しないか、保存期間により本文削除済みです。",
    };
    await runtime.repository.updateAutoReply(failed);
    return;
  }
  try {
    const result = await sender.sendAutoReply(reply, message);
    await runtime.repository.updateAutoReply({
      ...reply,
      status: "sent",
      sentMessageId: result.sentMessageId,
      sentAt: nowIso(),
    });
  } catch (error) {
    await runtime.repository.updateAutoReply({
      ...reply,
      status: "failed",
      decisionReason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleJob(queueName: QueueName, payload: QueuePayload): Promise<void> {
  switch (queueName) {
    case "discord.ingest":
      await handleDiscordIngest(runtime, payload as DiscordIngestPayload);
      return;
    case "message.classify":
      await handleMessageClassify(runtime, payload as MessageClassifyPayload);
      return;
    case "ops.notify":
      await sendPendingNotifications(runtime.repository, sender);
      return;
    case "auto_reply.decide":
      await handleAutoReplyDecide(runtime, payload as AutoReplyDecidePayload);
      return;
    case "auto_reply.send":
      await sendAutoReply((payload as AutoReplySendPayload).autoReplyId);
      return;
    case "faq.generate":
      await handleFaqGenerate(runtime, payload as FaqGeneratePayload);
      return;
    case "report.weekly":
      await handleReportWeekly(runtime, payload as ReportWeeklyPayload);
      return;
  }
}

for (const queueName of queueNames) {
  new Worker<QueuePayload>(
    queueName,
    async (job) => {
      await handleJob(queueName, validateQueuePayload(queueName, job.data));
    },
    { connection: runtime.queues.connection },
  );
}

console.log(`curacuri.ai worker listening to ${String(queueNames.length)} queues`);
