import { Hono } from "hono";

import { nowIso } from "../app/ids.js";
import { createPhase1State, listByCreatedAt, listByIngestedAt } from "../app/store.js";
import {
  approveAutoReply,
  generateWeeklyReport,
  importSampleLog,
  recordFeedback,
  refreshFaqCandidates,
  rejectAutoReply,
  updateFaqCandidateStatus,
} from "../app/workflow.js";
import {
  autoReplyCategories,
  autoReplyModes,
  classificationLabels,
  feedbackKinds,
  type AutoReplyCategory,
  type AutoReplyMode,
  type ClassificationLabel,
  type FeedbackKind,
  type FaqCandidateStatus,
} from "../shared/types.js";

export const phase1State = createPhase1State();

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

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => ({}));
  return isRecord(body) ? body : {};
}

export function createApiApp() {
  const app = new Hono();

  app.get("/api/health", (context) =>
    context.json({
      ok: true,
      api: "ok",
      db: "not_configured_in_memory",
      redis: "not_configured_in_memory",
    }),
  );

  app.get("/api/settings", (context) => context.json(phase1State.settings));

  app.put("/api/settings", async (context) => {
    const body = await requestBody(context.req.raw);
    phase1State.settings = {
      ...phase1State.settings,
      targetChannelIds: stringArray(body.targetChannelIds, phase1State.settings.targetChannelIds),
      excludedChannelIds: stringArray(
        body.excludedChannelIds,
        phase1State.settings.excludedChannelIds,
      ),
      adminNotificationChannelId: stringValue(
        body.adminNotificationChannelId,
        phase1State.settings.adminNotificationChannelId,
      ),
      retentionDays: numberValue(body.retentionDays, phase1State.settings.retentionDays),
      characterName: stringValue(body.characterName, phase1State.settings.characterName),
      characterTone: stringValue(body.characterTone, phase1State.settings.characterTone),
      updatedAt: nowIso(),
    };
    return context.json(phase1State.settings);
  });

  app.get("/api/auto-reply/policy", (context) => context.json(phase1State.autoReplyPolicy));

  app.put("/api/auto-reply/policy", async (context) => {
    const body = await requestBody(context.req.raw);
    const mode = modeValue(body.mode, phase1State.autoReplyPolicy.mode);
    const enabled =
      typeof body.enabled === "boolean"
        ? body.enabled && mode !== "disabled"
        : phase1State.autoReplyPolicy.enabled && mode !== "disabled";
    phase1State.autoReplyPolicy = {
      ...phase1State.autoReplyPolicy,
      enabled,
      mode,
      allowedChannelIds: stringArray(
        body.allowedChannelIds,
        phase1State.autoReplyPolicy.allowedChannelIds,
      ),
      allowedLabels: labelArray(body.allowedLabels, phase1State.autoReplyPolicy.allowedLabels),
      allowedCategories: categoryArray(
        body.allowedCategories,
        phase1State.autoReplyPolicy.allowedCategories,
      ),
      minConfidence: numberValue(body.minConfidence, phase1State.autoReplyPolicy.minConfidence),
      requireSourceForFaq:
        typeof body.requireSourceForFaq === "boolean"
          ? body.requireSourceForFaq
          : phase1State.autoReplyPolicy.requireSourceForFaq,
      updatedAt: nowIso(),
    };
    return context.json(phase1State.autoReplyPolicy);
  });

  app.get("/api/auto-replies", (context) =>
    context.json(listByCreatedAt(phase1State.autoReplies.values())),
  );

  app.post("/api/auto-replies/:id/approve", (context) => {
    const reply = approveAutoReply(phase1State, context.req.param("id"), "alpha-admin");
    return context.json(reply);
  });

  app.post("/api/auto-replies/:id/reject", (context) =>
    context.json(rejectAutoReply(phase1State, context.req.param("id"))),
  );

  app.post("/api/auto-replies/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    const feedback = recordFeedback(
      phase1State,
      "auto_reply",
      context.req.param("id"),
      feedbackKind(body.feedbackKind),
      stringValue(body.note, ""),
    );
    return context.json(feedback);
  });

  app.post("/api/import/sample-log", async (context) => {
    const result = await importSampleLog(phase1State);
    refreshFaqCandidates(phase1State);
    return context.json(result);
  });

  app.get("/api/messages", (context) =>
    context.json(listByIngestedAt(phase1State.messages.values())),
  );

  app.get("/api/classifications", (context) =>
    context.json(listByCreatedAt(phase1State.classifications.values())),
  );

  app.get("/api/notifications", (context) =>
    context.json(listByCreatedAt(phase1State.notifications.values())),
  );

  app.post("/api/notifications/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    return context.json(
      recordFeedback(
        phase1State,
        "notification",
        context.req.param("id"),
        feedbackKind(body.feedbackKind),
        stringValue(body.note, ""),
      ),
    );
  });

  app.get("/api/faq-candidates", (context) => {
    refreshFaqCandidates(phase1State);
    return context.json(listByCreatedAt(phase1State.faqCandidates.values()));
  });

  app.post("/api/faq-candidates/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    const status = stringValue(body.status, "candidate") as FaqCandidateStatus;
    if (["candidate", "accepted", "rejected", "needs_review"].includes(status)) {
      updateFaqCandidateStatus(phase1State, context.req.param("id"), status);
    }
    return context.json(
      recordFeedback(
        phase1State,
        "faq_candidate",
        context.req.param("id"),
        feedbackKind(body.feedbackKind),
        stringValue(body.note, ""),
      ),
    );
  });

  app.post("/api/reports/weekly", async (context) => {
    const body = await requestBody(context.req.raw);
    const report = generateWeeklyReport(
      phase1State,
      stringValue(body.periodStart, "2026-01-01"),
      stringValue(body.periodEnd, "2026-01-07"),
    );
    return context.json(report);
  });

  app.get("/api/reports/weekly", (context) =>
    context.json(listByCreatedAt(phase1State.weeklyReports.values())),
  );

  app.get("/api/reports/weekly/:id", (context) => {
    const report = phase1State.weeklyReports.get(context.req.param("id"));
    return report === undefined ? context.json({ error: "not found" }, 404) : context.json(report);
  });

  app.post("/api/reports/weekly/:id/feedback", async (context) => {
    const body = await requestBody(context.req.raw);
    return context.json(
      recordFeedback(
        phase1State,
        "weekly_report",
        context.req.param("id"),
        feedbackKind(body.feedbackKind),
        stringValue(body.note, ""),
      ),
    );
  });

  return app;
}

export const apiApp = createApiApp();
