import { Hono } from "hono";

import { nowIso } from "../app/ids.js";
import { readLlmConfigFromEnv } from "../app/llm/client.js";
import {
  approveAutoReplyInRepository,
  enqueueReprocess,
  enqueueRetryRun,
  enqueueSampleLog,
  recordFeedbackInRepository,
  rejectAutoReplyInRepository,
  updateFaqCandidateStatusInRepository,
} from "../app/persistent-workflow.js";
import type { AppRuntime } from "../app/runtime.js";
import {
  autoReplyCategories,
  autoReplyModes,
  classificationLabels,
  feedbackKinds,
  llmRunStatuses,
  llmTaskTypes,
  type AutoReplyCategory,
  type AutoReplyMode,
  type ClassificationLabel,
  type FeedbackKind,
  type FaqCandidateStatus,
  type LlmRunStatus,
  type LlmTaskType,
} from "../shared/types.js";
import type { FaqGeneratePayload, ReportWeeklyPayload } from "../shared/queue.js";
import type { MessageFilters } from "../app/repositories/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function labelArray(
  value: unknown,
  fallback: readonly ClassificationLabel[],
): readonly ClassificationLabel[] {
  return stringArray(value, fallback).filter((item): item is ClassificationLabel =>
    classificationLabels.includes(item as ClassificationLabel),
  );
}

function categoryArray(
  value: unknown,
  fallback: readonly AutoReplyCategory[],
): readonly AutoReplyCategory[] {
  return stringArray(value, fallback).filter((item): item is AutoReplyCategory =>
    autoReplyCategories.includes(item as AutoReplyCategory),
  );
}

function feedbackKind(value: unknown): FeedbackKind {
  if (typeof value === "string" && feedbackKinds.includes(value as FeedbackKind)) {
    return value as FeedbackKind;
  }
  return "useful";
}

function modeValue(value: unknown, fallback: AutoReplyMode): AutoReplyMode {
  if (typeof value === "string" && autoReplyModes.includes(value as AutoReplyMode)) {
    return value as AutoReplyMode;
  }
  return fallback;
}

function llmRunStatusValue(value: unknown): LlmRunStatus | undefined {
  if (typeof value === "string" && llmRunStatuses.includes(value as LlmRunStatus)) {
    return value as LlmRunStatus;
  }
  return undefined;
}

function reprocessScopeValue(value: unknown): LlmTaskType | "all" {
  if (value === "all") {
    return "all";
  }
  if (typeof value === "string" && llmTaskTypes.includes(value as LlmTaskType)) {
    return value as LlmTaskType;
  }
  return "all";
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => ({}));
  return isRecord(body) ? body : {};
}

export function createApiApp(runtime: AppRuntime) {
  const app = new Hono();

  app.get("/api/health", (context) =>
    context.json({
      ok: true,
      api: "ok",
      db: "ok",
      redis: "ok",
      dryRun: process.env.DISCORD_DRY_RUN !== "false",
    }),
  );

  app.get("/api/llm/status", async (context) => {
    const config = readLlmConfigFromEnv();
    const failedCount = (await runtime.repository.listLlmRuns("failed")).length;
    return context.json({
      configured: config.apiKey !== null && config.model !== null,
      modelName: config.model ?? "unconfigured",
      baseUrl: config.baseUrl,
      concurrency: config.concurrency,
      responseFormat: config.responseFormat,
      failedCount,
    });
  });

  app.get("/api/llm/runs", async (context) => {
    const status = llmRunStatusValue(context.req.query("status"));
    return context.json(await runtime.repository.listLlmRuns(status));
  });

  app.post("/api/llm/runs/:id/retry", async (context) => {
    await enqueueRetryRun(runtime.repository, runtime.queues, context.req.param("id"));
    return context.json({ ok: true, accepted: true }, 202);
  });

  app.post("/api/llm/reprocess", async (context) => {
    const body = await requestBody(context.req.raw);
    await enqueueReprocess(runtime.repository, runtime.queues, reprocessScopeValue(body.scope));
    return context.json({ ok: true, accepted: true }, 202);
  });

  app.get("/api/settings", async (context) => context.json(await runtime.repository.getSettings()));

  app.put("/api/settings", async (context) => {
    const body = await requestBody(context.req.raw);
    const settings = await runtime.repository.getSettings();
    const updated = await runtime.repository.updateSettings({
      ...settings,
      targetChannelIds: stringArray(body.targetChannelIds, settings.targetChannelIds),
      excludedChannelIds: stringArray(body.excludedChannelIds, settings.excludedChannelIds),
      adminNotificationChannelId: stringValue(
        body.adminNotificationChannelId,
        settings.adminNotificationChannelId,
      ),
      retentionDays: numberValue(body.retentionDays, settings.retentionDays),
      characterName: stringValue(body.characterName, settings.characterName),
      characterTone: stringValue(body.characterTone, settings.characterTone),
      updatedAt: nowIso(),
    });
    return context.json(updated);
  });

  app.get("/api/auto-reply/policy", async (context) =>
    context.json(await runtime.repository.getAutoReplyPolicy()),
  );

  app.put("/api/auto-reply/policy", async (context) => {
    const body = await requestBody(context.req.raw);
    const policy = await runtime.repository.getAutoReplyPolicy();
    const mode = modeValue(body.mode, policy.mode);
    const enabled =
      typeof body.enabled === "boolean" ? body.enabled && mode !== "disabled" : policy.enabled;
    const updated = await runtime.repository.updateAutoReplyPolicy({
      ...policy,
      enabled,
      mode,
      allowedChannelIds: stringArray(body.allowedChannelIds, policy.allowedChannelIds),
      allowedLabels: labelArray(body.allowedLabels, policy.allowedLabels),
      allowedCategories: categoryArray(body.allowedCategories, policy.allowedCategories),
      minConfidence: numberValue(body.minConfidence, policy.minConfidence),
      requireSourceForFaq:
        typeof body.requireSourceForFaq === "boolean"
          ? body.requireSourceForFaq
          : policy.requireSourceForFaq,
      updatedAt: nowIso(),
    });
    return context.json(updated);
  });

  app.get("/api/auto-replies", async (context) =>
    context.json(await runtime.repository.listAutoReplies()),
  );

  app.post("/api/auto-replies/:id/approve", async (context) => {
    const reply = await approveAutoReplyInRepository(
      runtime.repository,
      runtime.queues,
      context.req.param("id"),
      "alpha-admin",
    );
    return context.json(reply);
  });

  app.post("/api/auto-replies/:id/reject", async (context) =>
    context.json(await rejectAutoReplyInRepository(runtime.repository, context.req.param("id"))),
  );

  app.post("/api/auto-replies/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    return context.json(
      await recordFeedbackInRepository(
        runtime.repository,
        "auto_reply",
        context.req.param("id"),
        feedbackKind(body.feedbackKind),
        stringValue(body.note, ""),
      ),
    );
  });

  app.post("/api/import/sample-log", async (context) =>
    context.json(await enqueueSampleLog(runtime.repository, runtime.queues), 202),
  );

  app.get("/api/messages", async (context) => {
    const periodStart = context.req.query("periodStart");
    const periodEnd = context.req.query("periodEnd");
    const channelId = context.req.query("channelId");
    const label = context.req.query("label");
    const filters: MessageFilters = {
      ...(periodStart === undefined ? {} : { periodStart }),
      ...(periodEnd === undefined ? {} : { periodEnd }),
      ...(channelId === undefined ? {} : { channelId }),
      ...(label === undefined ? {} : { label }),
    };
    return context.json(await runtime.repository.listMessages(filters));
  });

  app.get("/api/classifications", async (context) =>
    context.json(await runtime.repository.listClassifications()),
  );

  app.get("/api/notifications", async (context) =>
    context.json(await runtime.repository.listNotifications()),
  );

  app.post("/api/notifications/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    return context.json(
      await recordFeedbackInRepository(
        runtime.repository,
        "notification",
        context.req.param("id"),
        feedbackKind(body.feedbackKind),
        stringValue(body.note, ""),
      ),
    );
  });

  app.get("/api/faq-candidates", async (context) =>
    context.json(await runtime.repository.listFaqCandidates()),
  );

  app.post("/api/faq-candidates/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    const status = stringValue(body.status, "candidate") as FaqCandidateStatus;
    if (["candidate", "accepted", "rejected", "needs_review"].includes(status)) {
      await updateFaqCandidateStatusInRepository(
        runtime.repository,
        context.req.param("id"),
        status,
      );
    }
    return context.json(
      await recordFeedbackInRepository(
        runtime.repository,
        "faq_candidate",
        context.req.param("id"),
        feedbackKind(body.feedbackKind),
        stringValue(body.note, ""),
      ),
    );
  });

  app.post("/api/faq-candidates/generate", async (context) => {
    const body = await requestBody(context.req.raw);
    const payload: FaqGeneratePayload = {
      periodStart: stringValue(body.periodStart, ""),
      periodEnd: stringValue(body.periodEnd, ""),
    };
    await runtime.queues.add("faq.generate", payload);
    return context.json({ ok: true, accepted: true }, 202);
  });

  app.post("/api/reports/weekly", async (context) => {
    const body = await requestBody(context.req.raw);
    const settings = await runtime.repository.getSettings();
    const payload: ReportWeeklyPayload = {
      periodStart: stringValue(body.periodStart, "2026-01-01"),
      periodEnd: stringValue(body.periodEnd, "2026-01-07"),
      channelIds: settings.targetChannelIds,
    };
    await runtime.queues.add("report.weekly", payload);
    return context.json({ ok: true, accepted: true, payload }, 202);
  });

  app.get("/api/reports/weekly", async (context) =>
    context.json(await runtime.repository.listWeeklyReports()),
  );

  app.get("/api/reports/weekly/:id", async (context) => {
    const report = await runtime.repository.getWeeklyReport(context.req.param("id"));
    return report === null ? context.json({ error: "not found" }, 404) : context.json(report);
  });

  app.post("/api/reports/weekly/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    return context.json(
      await recordFeedbackInRepository(
        runtime.repository,
        "weekly_report",
        context.req.param("id"),
        feedbackKind(body.feedbackKind),
        stringValue(body.note, ""),
      ),
    );
  });

  return app;
}
