import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../../src/api/app.js";
import type { Phase1Repository } from "../../src/app/repositories/types.js";
import type { AppRuntime } from "../../src/app/runtime.js";
import { createPhase1State } from "../../src/app/store.js";
import { loadDashboardData } from "../../src/dashboard/api.js";
import {
  allowedFaqStatusTransitions,
  canModerateAutoReply,
} from "../../src/dashboard/action-rules.js";
import type { QueueName, QueuePayload } from "../../src/shared/queue.js";
import type {
  AdminNotification,
  AutoReply,
  FaqCandidate,
  ManualKnowledge,
  ManualKnowledgeSearchResult,
} from "../../src/shared/types.js";

function unsupportedPromise<T>(): Promise<T> {
  return Promise.reject(new Error("unsupported in this test"));
}

function createDashboardRuntime(seed: {
  readonly notification?: AdminNotification;
  readonly faqCandidate?: FaqCandidate;
  readonly autoReply?: AutoReply;
  readonly manualKnowledge?: ManualKnowledge;
  readonly embeddingFailure?: boolean;
}): AppRuntime & {
  readonly enqueuedJobs: { readonly queueName: QueueName; readonly payload: QueuePayload }[];
} {
  const state = createPhase1State();
  const enqueuedJobs: { readonly queueName: QueueName; readonly payload: QueuePayload }[] = [];
  if (seed.notification !== undefined) {
    state.notifications.set(seed.notification.id, seed.notification);
  }
  if (seed.faqCandidate !== undefined) {
    state.faqCandidates.set(seed.faqCandidate.id, seed.faqCandidate);
  }
  if (seed.autoReply !== undefined) {
    state.autoReplies.set(seed.autoReply.id, seed.autoReply);
  }
  if (seed.manualKnowledge !== undefined) {
    state.manualKnowledge.set(seed.manualKnowledge.id, seed.manualKnowledge);
  }
  const repository: Phase1Repository = {
    ensureSeed() {
      return Promise.resolve();
    },
    close() {
      return Promise.resolve();
    },
    loadState() {
      return Promise.resolve(state);
    },
    saveState() {
      return Promise.resolve();
    },
    getSettings() {
      return Promise.resolve(state.settings);
    },
    updateSettings(settings) {
      state.settings = settings;
      return Promise.resolve(settings);
    },
    getAutoReplyPolicy() {
      return Promise.resolve(state.autoReplyPolicy);
    },
    updateAutoReplyPolicy(policy) {
      state.autoReplyPolicy = policy;
      return Promise.resolve(policy);
    },
    listEscalationRules() {
      return Promise.resolve(state.autoReplyPolicy.escalationRules);
    },
    replaceEscalationRules(_guildId, rules) {
      state.autoReplyPolicy = { ...state.autoReplyPolicy, escalationRules: rules };
      state.settings = { ...state.settings, autoReplyEscalationRules: rules };
      return Promise.resolve(rules);
    },
    upsertMessage() {
      return unsupportedPromise();
    },
    getMessage() {
      return Promise.resolve(null);
    },
    listMessages() {
      return Promise.resolve([]);
    },
    listClassifications() {
      return unsupportedPromise();
    },
    getClassification() {
      return unsupportedPromise();
    },
    findClassificationByMessageId() {
      return unsupportedPromise();
    },
    listNotifications() {
      return Promise.resolve([...state.notifications.values()]);
    },
    getNotification(id) {
      return Promise.resolve(state.notifications.get(id) ?? null);
    },
    saveNotification(notification) {
      state.notifications.set(notification.id, notification);
      return Promise.resolve();
    },
    claimPendingNotificationSend() {
      return unsupportedPromise();
    },
    markClaimedNotificationSent() {
      return unsupportedPromise();
    },
    markClaimedNotificationFailed() {
      return unsupportedPromise();
    },
    markNotificationSent() {
      return unsupportedPromise();
    },
    markNotificationFailed() {
      return unsupportedPromise();
    },
    dismissNotification(id) {
      const notification = state.notifications.get(id);
      if (notification !== undefined) {
        state.notifications.set(id, {
          ...notification,
          status: "dismissed",
          failureReason: null,
        });
      }
      return Promise.resolve();
    },
    listAutoReplies() {
      return Promise.resolve([...state.autoReplies.values()]);
    },
    getAutoReply(id) {
      return Promise.resolve(state.autoReplies.get(id) ?? null);
    },
    saveAutoReply(autoReply) {
      state.autoReplies.set(autoReply.id, autoReply);
      return Promise.resolve();
    },
    updateAutoReply(autoReply) {
      state.autoReplies.set(autoReply.id, autoReply);
      return Promise.resolve();
    },
    listFaqCandidates() {
      return Promise.resolve([...state.faqCandidates.values()]);
    },
    getFaqCandidate(id) {
      return Promise.resolve(state.faqCandidates.get(id) ?? null);
    },
    updateFaqCandidateStatus(id, status) {
      const candidate = state.faqCandidates.get(id);
      if (candidate !== undefined) {
        state.faqCandidates.set(id, { ...candidate, status });
      }
      return Promise.resolve();
    },
    updateFaqCandidate(candidate) {
      state.faqCandidates.set(candidate.id, candidate);
      return Promise.resolve(candidate);
    },
    listManualKnowledge() {
      return Promise.resolve([...state.manualKnowledge.values()]);
    },
    getManualKnowledge(id) {
      return Promise.resolve(state.manualKnowledge.get(id) ?? null);
    },
    createManualKnowledge(item) {
      state.manualKnowledge.set(item.id, item);
      return Promise.resolve(item);
    },
    updateManualKnowledge(item) {
      state.manualKnowledge.set(item.id, item);
      return Promise.resolve(item);
    },
    updateManualKnowledgeEmbedding(id, fields) {
      const item = state.manualKnowledge.get(id);
      if (item === undefined) return Promise.reject(new Error(`manual knowledge not found: ${id}`));
      const updated = {
        ...item,
        embeddingModel: fields.embeddingModel,
        embeddingUpdatedAt: fields.embeddingUpdatedAt,
        embeddingError: fields.embeddingError,
        updatedAt: fields.updatedAt,
      };
      state.manualKnowledge.set(id, updated);
      return Promise.resolve(updated);
    },
    searchManualKnowledge() {
      const results: ManualKnowledgeSearchResult[] = [...state.manualKnowledge.values()]
        .filter((item) => item.status === "published" && item.embeddingError === null)
        .map((item) => ({ item, score: 0.9 }));
      return Promise.resolve(results);
    },
    listWeeklyReports() {
      return unsupportedPromise();
    },
    getWeeklyReport() {
      return unsupportedPromise();
    },
    listLlmRuns() {
      return unsupportedPromise();
    },
    getLlmRun() {
      return unsupportedPromise();
    },
    saveFeedback() {
      return Promise.resolve();
    },
    logicalDeleteExpiredMessages() {
      return Promise.resolve(0);
    },
  };

  return {
    repository,
    queues: {
      add(queueName, payload) {
        enqueuedJobs.push({ queueName, payload });
        return Promise.resolve({ id: undefined });
      },
      close() {
        return Promise.resolve();
      },
      connection: {} as AppRuntime["queues"]["connection"],
    },
    llmClient: {
      modelName: "test",
      generateJson() {
        return unsupportedPromise();
      },
    },
    embeddingClient: {
      modelName: "fake-embedding",
      dimensions: 1536,
      embed() {
        if (seed.embeddingFailure === true) {
          return Promise.reject(new Error("embedding failed"));
        }
        return Promise.resolve({
          modelName: "fake-embedding",
          embedding: Array.from({ length: 1536 }, () => 0.1),
        });
      },
    },
    enqueuedJobs,
  };
}

function notification(status: AdminNotification["status"]): AdminNotification {
  return {
    id: "notification-1",
    notificationType: "official_reply",
    messageIds: ["message-1"],
    title: "確認が必要です",
    body: "公式回答が必要です。",
    importance: "high",
    status,
    sentToChannelId: "admin-channel",
    sentMessageId: null,
    sentAt: null,
    failureReason: "送信前",
    createdAt: "2026-05-21T00:00:00.000Z",
  };
}

function faqCandidate(): FaqCandidate {
  return {
    id: "faq-1",
    sourceMessageIds: ["message-1"],
    topic: "古いトピック",
    currentAnswerStatus: "unknown",
    draftQuestion: "古い質問",
    draftAnswer: "古い回答",
    confidence: 0.82,
    status: "candidate",
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
  };
}

function autoReply(status: AutoReply["status"]): AutoReply {
  return {
    id: "auto-reply-1",
    messageId: "message-1",
    classificationId: "classification-1",
    mode: "approval_required",
    replyCategory: "faq_reference",
    body: "回答案です。",
    sourceRefs: [],
    confidence: 0.88,
    decisionReason: "承認待ちの回答案です。",
    status,
    sentMessageId: status === "sent" ? "discord-message-1" : null,
    approvedBy: null,
    sentAt: status === "sent" ? "2026-05-21T00:00:00.000Z" : null,
    createdAt: "2026-05-21T00:00:00.000Z",
  };
}

function manualKnowledge(status: ManualKnowledge["status"] = "published"): ManualKnowledge {
  return {
    id: "knowledge-1",
    guildId: "dogfood-guild",
    sourceType: "official_faq",
    title: "Webhook設定",
    body: "Webhook通知は設定画面の連携タブから変更できます。",
    url: "https://example.com/docs/webhook",
    tags: ["webhook"],
    status,
    embeddingModel: "fake-embedding",
    embeddingUpdatedAt: "2026-05-21T00:00:00.000Z",
    embeddingError: null,
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dashboard action API", () => {
  it.each(["pending", "sent"] as const)("dismisses %s notifications", async (status) => {
    const app = createApiApp(createDashboardRuntime({ notification: notification(status) }));
    const response = await app.request("/api/notifications/notification-1/dismiss", {
      method: "POST",
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({
      id: "notification-1",
      status: "dismissed",
      failureReason: null,
    });
  });

  it("returns 404 when dismissing a missing notification", async () => {
    const app = createApiApp(createDashboardRuntime({}));
    const response = await app.request("/api/notifications/missing/dismiss", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("updates FAQ candidate editable fields", async () => {
    const app = createApiApp(createDashboardRuntime({ faqCandidate: faqCandidate() }));
    const response = await app.request("/api/faq-candidates/faq-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: "新しいトピック",
        draftQuestion: "新しい質問",
        draftAnswer: "新しい回答",
        status: "needs_review",
      }),
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({
      id: "faq-1",
      topic: "新しいトピック",
      draftQuestion: "新しい質問",
      draftAnswer: "新しい回答",
      status: "needs_review",
    });
  });

  it("rejects invalid FAQ candidate status without updating the candidate", async () => {
    const app = createApiApp(createDashboardRuntime({ faqCandidate: faqCandidate() }));
    const response = await app.request("/api/faq-candidates/faq-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    expect(response.status).toBe(400);

    const listResponse = await app.request("/api/faq-candidates");
    expect(await listResponse.json()).toMatchObject([{ id: "faq-1", status: "candidate" }]);
  });

  it("records FAQ feedback without resetting status when status is omitted", async () => {
    const candidate = { ...faqCandidate(), status: "accepted" as const };
    const app = createApiApp(createDashboardRuntime({ faqCandidate: candidate }));
    const response = await app.request("/api/faq-candidates/faq-1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedbackKind: "useful", note: "確認済み" }),
    });
    expect(response.ok).toBe(true);

    const listResponse = await app.request("/api/faq-candidates");
    expect(await listResponse.json()).toMatchObject([{ id: "faq-1", status: "accepted" }]);
  });

  it("passes FAQ generation filters to the queue payload", async () => {
    const runtime = createDashboardRuntime({});
    const app = createApiApp(runtime);
    const response = await app.request("/api/faq-candidates/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messageIds: ["message-1", "message-2"],
        periodStart: "2026-01-01",
        periodEnd: "2026-01-07",
      }),
    });
    expect(response.status).toBe(202);
    expect(runtime.enqueuedJobs).toEqual([
      {
        queueName: "faq.generate",
        payload: {
          messageIds: ["message-1", "message-2"],
          periodStart: "2026-01-01",
          periodEnd: "2026-01-07",
        },
      },
    ]);
  });

  it("creates, updates, lists, and reindexes manual knowledge", async () => {
    const runtime = createDashboardRuntime({});
    const app = createApiApp(runtime);
    const createResponse = await app.request("/api/manual-knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceType: "docs",
        title: "Webhook設定",
        body: "Webhook通知は設定画面の連携タブから変更できます。",
        url: "https://example.com/docs/webhook",
        tags: ["webhook", "通知"],
        status: "draft",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as ManualKnowledge;
    expect(created).toMatchObject({
      sourceType: "docs",
      status: "draft",
      embeddingModel: "fake-embedding",
      embeddingError: null,
    });

    const updateResponse = await app.request(`/api/manual-knowledge/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "published", sourceType: "official_faq" }),
    });
    expect(updateResponse.ok).toBe(true);
    expect(await updateResponse.json()).toMatchObject({
      id: created.id,
      sourceType: "official_faq",
      status: "published",
    });

    const reindexResponse = await app.request(`/api/manual-knowledge/${created.id}/reindex`, {
      method: "POST",
    });
    expect(reindexResponse.ok).toBe(true);

    const listResponse = await app.request("/api/manual-knowledge");
    expect(await listResponse.json()).toMatchObject([
      {
        id: created.id,
        title: "Webhook設定",
        status: "published",
      },
    ]);
  });

  it("rejects invalid manual knowledge source type and status", async () => {
    const app = createApiApp(createDashboardRuntime({}));
    const invalidSourceResponse = await app.request("/api/manual-knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceType: "memo",
        title: "Webhook設定",
        body: "本文",
      }),
    });
    expect(invalidSourceResponse.status).toBe(400);

    const invalidStatusResponse = await app.request("/api/manual-knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceType: "docs",
        title: "Webhook設定",
        body: "本文",
        status: "deleted",
      }),
    });
    expect(invalidStatusResponse.status).toBe(400);
  });

  it("stores embedding errors on manual knowledge instead of rejecting the save", async () => {
    const app = createApiApp(createDashboardRuntime({ embeddingFailure: true }));
    const response = await app.request("/api/manual-knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceType: "docs",
        title: "Webhook設定",
        body: "Webhook通知は設定画面の連携タブから変更できます。",
        status: "published",
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      embeddingModel: "fake-embedding",
      embeddingUpdatedAt: null,
      embeddingError: "embedding failed",
    });
  });

  it("uses the last completed week when weekly report period body is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T12:00:00.000Z"));
    const runtime = createDashboardRuntime({});
    const app = createApiApp(runtime);
    const response = await app.request("/api/reports/weekly", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      payload: {
        periodStart: "2026-05-11",
        periodEnd: "2026-05-17",
        channelIds: [
          "support",
          "bugs",
          "feature-requests",
          "general",
          "feedback",
          "dev-help",
          "tips",
          "welcome",
          "showcase",
        ],
      },
    });
    expect(runtime.enqueuedJobs).toMatchObject([
      {
        queueName: "report.weekly",
        payload: {
          periodStart: "2026-05-11",
          periodEnd: "2026-05-17",
        },
      },
    ]);
    expect(runtime.enqueuedJobs[0]?.payload).toMatchObject({
      channelIds: [
        "support",
        "bugs",
        "feature-requests",
        "general",
        "feedback",
        "dev-help",
        "tips",
        "welcome",
        "showcase",
      ],
    });
  });

  it("keeps explicit weekly report period values when provided", async () => {
    const runtime = createDashboardRuntime({});
    const app = createApiApp(runtime);
    const response = await app.request("/api/reports/weekly", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ periodStart: "2026-04-06", periodEnd: "2026-04-12" }),
    });
    expect(response.status).toBe(202);
    expect(runtime.enqueuedJobs).toMatchObject([
      {
        queueName: "report.weekly",
        payload: {
          periodStart: "2026-04-06",
          periodEnd: "2026-04-12",
        },
      },
    ]);
  });

  it("uses the last completed week when reprocessing all LLM tasks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T12:00:00.000Z"));
    const runtime = createDashboardRuntime({});
    const app = createApiApp(runtime);
    const response = await app.request("/api/llm/reprocess", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "all" }),
    });
    expect(response.status).toBe(202);
    expect(runtime.enqueuedJobs).toEqual([
      { queueName: "faq.generate", payload: {} },
      {
        queueName: "report.weekly",
        payload: {
          periodStart: "2026-05-11",
          periodEnd: "2026-05-17",
          channelIds: [
            "support",
            "bugs",
            "feature-requests",
            "general",
            "feedback",
            "dev-help",
            "tips",
            "welcome",
            "showcase",
          ],
        },
      },
    ]);
  });

  it("approves pending auto replies and enqueues a send job", async () => {
    const runtime = createDashboardRuntime({ autoReply: autoReply("pending_approval") });
    const app = createApiApp(runtime);
    const response = await app.request("/api/auto-replies/auto-reply-1/approve", {
      method: "POST",
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({
      id: "auto-reply-1",
      status: "drafted",
      approvedBy: "alpha-admin",
      sentMessageId: null,
      sentAt: null,
    });
    expect(runtime.enqueuedJobs).toEqual([
      { queueName: "auto_reply.send", payload: { autoReplyId: "auto-reply-1" } },
    ]);
  });

  it("rejects pending auto replies without enqueuing a send job", async () => {
    const runtime = createDashboardRuntime({ autoReply: autoReply("pending_approval") });
    const app = createApiApp(runtime);
    const response = await app.request("/api/auto-replies/auto-reply-1/reject", {
      method: "POST",
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toMatchObject({
      id: "auto-reply-1",
      status: "blocked",
      decisionReason: "管理者により却下されました。",
    });
    expect(runtime.enqueuedJobs).toEqual([]);
  });

  it("rejects non-pending auto reply approval without changing state or enqueuing jobs", async () => {
    const runtime = createDashboardRuntime({ autoReply: autoReply("sent") });
    const app = createApiApp(runtime);
    const response = await app.request("/api/auto-replies/auto-reply-1/approve", {
      method: "POST",
    });
    expect(response.status).toBe(409);
    expect(runtime.enqueuedJobs).toEqual([]);

    const listResponse = await app.request("/api/auto-replies");
    expect(await listResponse.json()).toMatchObject([
      { id: "auto-reply-1", status: "sent", sentMessageId: "discord-message-1" },
    ]);
  });

  it("returns 404 when approving a missing auto reply", async () => {
    const app = createApiApp(createDashboardRuntime({}));
    const response = await app.request("/api/auto-replies/missing/approve", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});

describe("dashboard action rules", () => {
  it("only allows auto reply moderation while pending approval", () => {
    expect(canModerateAutoReply("pending_approval")).toBe(true);
    expect(canModerateAutoReply("sent")).toBe(false);
    expect(canModerateAutoReply("blocked")).toBe(false);
  });

  it("hides the current FAQ status from status transition actions", () => {
    expect(allowedFaqStatusTransitions("accepted")).toEqual([
      "candidate",
      "rejected",
      "needs_review",
    ]);
    expect(allowedFaqStatusTransitions("candidate")).toEqual([
      "accepted",
      "rejected",
      "needs_review",
    ]);
  });
});

describe("dashboard API client", () => {
  it("loads manual knowledge with dashboard data", async () => {
    const responses: Record<string, unknown> = {
      "/api/settings": {
        targetChannelIds: [],
        excludedChannelIds: [],
        adminNotificationChannelId: "admin",
        retentionDays: 90,
        characterName: "クラクリAI",
        characterTone: "丁寧",
      },
      "/api/auto-reply/policy": {
        enabled: false,
        mode: "disabled",
        allowedChannelIds: [],
        allowedLabels: [],
        allowedCategories: [],
        minConfidence: 0.8,
        requireSourceForFaq: true,
        escalationRules: [],
      },
      "/api/messages": [],
      "/api/classifications": [],
      "/api/notifications": [],
      "/api/faq-candidates": [],
      "/api/manual-knowledge": [manualKnowledge()],
      "/api/auto-replies": [],
      "/api/reports/weekly": [],
      "/api/llm/status": {
        configured: true,
        modelName: "test",
        baseUrl: "https://example.com",
        concurrency: 1,
        responseFormat: "json_object",
        failedCount: 0,
      },
      "/api/llm/runs?status=failed": [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) =>
        Promise.resolve(
          new Response(JSON.stringify(responses[path]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const data = await loadDashboardData({
      periodStart: "",
      periodEnd: "",
      channelId: "",
      label: "",
    });

    expect(data.manualKnowledge).toMatchObject([{ id: "knowledge-1", title: "Webhook設定" }]);
  });
});
