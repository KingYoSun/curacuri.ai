import "../app/env.js";

import { Worker, type Job } from "bullmq";

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

async function sendPendingNotifications(): Promise<void> {
  const notifications = (await runtime.repository.listNotifications()).filter(
    (notification) => notification.status === "pending",
  );
  for (const notification of notifications) {
    try {
      const result = await sender.sendAdminNotification(notification);
      await runtime.repository.markNotificationSent(notification.id, result.sentMessageId);
    } catch (error) {
      await runtime.repository.markNotificationFailed(
        notification.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

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

async function handleJob(queueName: QueueName, job: Job<QueuePayload>): Promise<void> {
  switch (queueName) {
    case "discord.ingest":
      await handleDiscordIngest(runtime, job.data as DiscordIngestPayload);
      return;
    case "message.classify":
      await handleMessageClassify(runtime, job.data as MessageClassifyPayload);
      return;
    case "ops.notify":
      await sendPendingNotifications();
      return;
    case "auto_reply.decide":
      await handleAutoReplyDecide(runtime, job.data as AutoReplyDecidePayload);
      return;
    case "auto_reply.send":
      await sendAutoReply((job.data as AutoReplySendPayload).autoReplyId);
      return;
    case "faq.generate":
      await handleFaqGenerate(runtime, job.data as FaqGeneratePayload);
      return;
    case "report.weekly":
      await handleReportWeekly(runtime, job.data as ReportWeeklyPayload);
      return;
  }
}

for (const queueName of queueNames) {
  new Worker<QueuePayload>(
    queueName,
    async (job) => {
      await handleJob(queueName, job);
    },
    { connection: runtime.queues.connection },
  );
}

console.log(`curacuri.ai worker listening to ${String(queueNames.length)} queues`);
