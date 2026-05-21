import { describe, expect, it } from "vitest";

import { createApiApp } from "../../src/api/app.js";
import type { Phase1Repository } from "../../src/app/repositories/types.js";
import type { AppRuntime } from "../../src/app/runtime.js";
import { createPhase1State } from "../../src/app/store.js";
import type { AdminNotification, FaqCandidate } from "../../src/shared/types.js";

function unsupportedPromise<T>(): Promise<T> {
  return Promise.reject(new Error("unsupported in this test"));
}

function createDashboardRuntime(seed: {
  readonly notification?: AdminNotification;
  readonly faqCandidate?: FaqCandidate;
}): AppRuntime {
  const state = createPhase1State();
  if (seed.notification !== undefined) {
    state.notifications.set(seed.notification.id, seed.notification);
  }
  if (seed.faqCandidate !== undefined) {
    state.faqCandidates.set(seed.faqCandidate.id, seed.faqCandidate);
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
      return unsupportedPromise();
    },
    listMessages() {
      return unsupportedPromise();
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
      return unsupportedPromise();
    },
    getAutoReply() {
      return unsupportedPromise();
    },
    saveAutoReply() {
      return unsupportedPromise();
    },
    updateAutoReply() {
      return unsupportedPromise();
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
      add() {
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
});
