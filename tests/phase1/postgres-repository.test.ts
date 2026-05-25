import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { handleMessageClassify, handleReportWeekly } from "../../src/app/persistent-workflow.js";
import type { QueuePublisher } from "../../src/app/persistent-workflow.js";
import { normalizeSampleRecord } from "../../src/app/intake.js";
import { PostgresPhase1Repository } from "../../src/app/repositories/postgres.js";
import type { Classification, Message } from "../../src/shared/types.js";
import type { QueueName, QueuePayload } from "../../src/shared/queue.js";
import { FakeLlmClient } from "./fake-llm.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

class RecordingQueue implements QueuePublisher {
  readonly jobs: { readonly queueName: QueueName; readonly payload: QueuePayload }[] = [];

  add(queueName: QueueName, payload: QueuePayload): Promise<{ readonly id: string | undefined }> {
    this.jobs.push({ queueName, payload });
    return Promise.resolve({ id: undefined });
  }
}

function classificationFor(message: Message, fields: Partial<Classification> = {}): Classification {
  return {
    id: `00000000-0000-4000-8000-${message.id.slice(-12)}`,
    messageId: message.id,
    labels: ["質問"],
    importance: "medium",
    adminActionNeeded: false,
    adminActionType: "weekly_report",
    confidence: 0.91,
    reason: "使い方を確認している投稿のため。",
    suggestedSummary: "使い方に関する質問。",
    modelName: "test",
    rawOutput: {},
    createdAt: "2026-05-21T00:00:00.000Z",
    ...fields,
  };
}

describe.skipIf(databaseUrl === undefined)("PostgresPhase1Repository", () => {
  if (databaseUrl === undefined) return;

  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresPhase1Repository(databaseUrl);

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE
        admin_feedback,
        weekly_reports,
        faq_candidates,
        auto_replies,
        admin_notifications,
        classifications,
        messages,
        llm_generation_runs,
        manual_knowledge,
        auto_reply_escalation_rules,
        auto_reply_policies,
        guild_settings
      RESTART IDENTITY CASCADE`,
    );
    await repository.ensureSeed();
  });

  afterAll(async () => {
    await repository.close();
    await pool.end();
  });

  it("upserts messages idempotently", async () => {
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );

    const first = await repository.upsertMessage(message);
    const second = await repository.upsertMessage({ ...message, content: "更新後の本文" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.message).toMatchObject({
      id: message.id,
      content: "更新後の本文",
    });
    expect(await repository.listMessages()).toHaveLength(1);
  });

  it("persists settings and auto reply policy updates", async () => {
    const settings = await repository.getSettings();
    const policy = await repository.getAutoReplyPolicy();

    await repository.updateSettings({
      ...settings,
      targetChannelIds: ["support"],
      adminNotificationChannelId: "admin-ops",
      retentionDays: 14,
    });
    await repository.updateAutoReplyPolicy({
      ...policy,
      enabled: true,
      mode: "approval_required",
      allowedChannelIds: ["support"],
    });

    const reloaded = new PostgresPhase1Repository(databaseUrl);
    await expect(reloaded.getSettings()).resolves.toMatchObject({
      targetChannelIds: ["support"],
      adminNotificationChannelId: "admin-ops",
      retentionDays: 14,
    });
    await expect(reloaded.getAutoReplyPolicy()).resolves.toMatchObject({
      enabled: true,
      mode: "approval_required",
      allowedChannelIds: ["support"],
    });
    await reloaded.close();
  });

  it("excludes deleted message derived data from FAQ and weekly report generation", async () => {
    const activeMessage = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    const deletedMessage = {
      ...normalizeSampleRecord(
        {
          text: "削除済みの不具合報告です。",
          channel_context: "#support / 不具合報告",
        },
        1,
      ),
      deletedAt: "2026-05-21T00:00:00.000Z",
    };
    const state = await repository.loadState();
    state.messages.set(activeMessage.id, activeMessage);
    state.messages.set(deletedMessage.id, deletedMessage);
    state.classifications.set("active-classification", classificationFor(activeMessage));
    state.classifications.set(
      "deleted-classification",
      classificationFor(deletedMessage, { labels: ["バグ報告"] }),
    );
    await repository.saveState(state);

    await handleReportWeekly(
      { repository, queues: new RecordingQueue(), llmClient: new FakeLlmClient() },
      { periodStart: "2026-01-01", periodEnd: "2026-01-07", channelIds: ["support"] },
    );

    const reports = await repository.listWeeklyReports();
    expect(reports[0]).toMatchObject({
      messageCount: 1,
      metrics: {
        bugReportCount: 0,
      },
    });
  });

  it("can retry a failed LLM run from persisted DB state", async () => {
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    await repository.upsertMessage(message);

    await handleMessageClassify(
      {
        repository,
        queues: new RecordingQueue(),
        llmClient: new FakeLlmClient({ failures: ["classification"] }),
      },
      { messageId: message.id },
    );

    const failedRun = (await repository.listLlmRuns("failed"))[0];
    const queue = new RecordingQueue();
    expect(failedRun).toBeDefined();
    if (failedRun !== undefined) {
      const { enqueueRetryRun } = await import("../../src/app/persistent-workflow.js");
      await enqueueRetryRun(repository, queue, failedRun.id);
    }

    expect(queue.jobs).toEqual([
      {
        queueName: "message.classify",
        payload: { messageId: message.id },
      },
    ]);
  });
});
