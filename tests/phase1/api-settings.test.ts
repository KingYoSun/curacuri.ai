import { describe, expect, it } from "vitest";

import { createApiApp } from "../../src/api/app.js";
import { createPhase1State } from "../../src/app/store.js";
import type { AppRuntime } from "../../src/app/runtime.js";
import type { Phase1Repository } from "../../src/app/repositories/types.js";

function unsupportedPromise<T>(): Promise<T> {
  return Promise.reject(new Error("unsupported in this test"));
}

function createSettingsRuntime(): AppRuntime {
  const state = createPhase1State();
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
    saveState(nextState) {
      state.settings = nextState.settings;
      state.autoReplyPolicy = nextState.autoReplyPolicy;
      return Promise.resolve();
    },
    getSettings() {
      return Promise.resolve(state.settings);
    },
    updateSettings(settings) {
      state.settings = settings;
      return Promise.resolve(state.settings);
    },
    getAutoReplyPolicy() {
      return Promise.resolve(state.autoReplyPolicy);
    },
    updateAutoReplyPolicy(policy) {
      state.autoReplyPolicy = policy;
      return Promise.resolve(state.autoReplyPolicy);
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
      return unsupportedPromise();
    },
    getNotification() {
      return unsupportedPromise();
    },
    saveNotification() {
      return unsupportedPromise();
    },
    markNotificationSent() {
      return unsupportedPromise();
    },
    markNotificationFailed() {
      return unsupportedPromise();
    },
    dismissNotification() {
      return unsupportedPromise();
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
      return unsupportedPromise();
    },
    getFaqCandidate() {
      return unsupportedPromise();
    },
    updateFaqCandidateStatus() {
      return unsupportedPromise();
    },
    updateFaqCandidate() {
      return unsupportedPromise();
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
      return unsupportedPromise();
    },
    logicalDeleteExpiredMessages() {
      return unsupportedPromise();
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

describe("settings API", () => {
  it("keeps /api/settings auto reply fields synchronized with the active policy", async () => {
    const app = createApiApp(createSettingsRuntime());
    const updateResponse = await app.request("/api/auto-reply/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        mode: "intake_only",
        allowedChannelIds: ["real-channel-id"],
        allowedLabels: ["質問"],
        allowedCategories: ["intake"],
        minConfidence: 0.72,
        requireSourceForFaq: false,
      }),
    });
    expect(updateResponse.ok).toBe(true);

    const settingsResponse = await app.request("/api/settings");
    const settings = (await settingsResponse.json()) as {
      readonly autoReplyMode: string;
      readonly autoReplyAllowedChannelIds: readonly string[];
      readonly autoReplyAllowedLabels: readonly string[];
      readonly autoReplyAllowedCategories: readonly string[];
      readonly autoReplyMinConfidence: number;
    };

    expect(settings).toMatchObject({
      autoReplyMode: "intake_only",
      autoReplyAllowedChannelIds: ["real-channel-id"],
      autoReplyAllowedLabels: ["質問"],
      autoReplyAllowedCategories: ["intake"],
      autoReplyMinConfidence: 0.72,
    });
  });

  it("reports disabled in /api/settings when policy is not enabled", async () => {
    const app = createApiApp(createSettingsRuntime());
    const updateResponse = await app.request("/api/auto-reply/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        mode: "intake_only",
        allowedChannelIds: ["real-channel-id"],
      }),
    });
    expect(updateResponse.ok).toBe(true);

    const settingsResponse = await app.request("/api/settings");
    const settings = (await settingsResponse.json()) as { readonly autoReplyMode: string };

    expect(settings.autoReplyMode).toBe("disabled");
  });

  it("round-trips auto reply escalation rules through policy and settings APIs", async () => {
    const app = createApiApp(createSettingsRuntime());
    const updateResponse = await app.request("/api/auto-reply/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        mode: "intake_only",
        escalationRules: [
          {
            ruleType: "keyword",
            action: "notify_admin",
            enabled: true,
            condition: { keywords: ["社外秘"] },
          },
        ],
      }),
    });
    expect(updateResponse.ok).toBe(true);

    const policyResponse = await app.request("/api/auto-reply/policy");
    const policy = (await policyResponse.json()) as {
      readonly escalationRules: readonly {
        readonly id: string;
        readonly ruleType: string;
        readonly action: string;
        readonly condition: { readonly keywords?: readonly string[] };
      }[];
    };
    expect(policy.escalationRules).toHaveLength(1);
    expect(typeof policy.escalationRules[0]?.id).toBe("string");
    expect(policy.escalationRules[0]).toMatchObject({
      ruleType: "keyword",
      action: "notify_admin",
      condition: { keywords: ["社外秘"] },
    });

    const settingsResponse = await app.request("/api/settings");
    const settings = (await settingsResponse.json()) as {
      readonly autoReplyEscalationRules: readonly unknown[];
    };
    expect(settings.autoReplyEscalationRules).toHaveLength(1);
  });

  it("rejects invalid auto reply escalation rule conditions", async () => {
    const app = createApiApp(createSettingsRuntime());
    const response = await app.request("/api/auto-reply/policy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        escalationRules: [
          {
            ruleType: "confidence",
            action: "do_not_reply",
            enabled: true,
            condition: { maxConfidence: 2 },
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "maxConfidence must be a number between 0 and 1",
    });
  });
});
