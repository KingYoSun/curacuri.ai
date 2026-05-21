import { describe, expect, it } from "vitest";

import {
  handleAutoReplyDecide,
  handleFaqGenerate,
  handleMessageClassify,
  handleReportWeekly,
  type QueuePublisher,
} from "../../src/app/persistent-workflow.js";
import { normalizeSampleRecord } from "../../src/app/intake.js";
import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "../../src/app/llm/client.js";
import type { Phase1Repository } from "../../src/app/repositories/types.js";
import { createPhase1State, type Phase1State } from "../../src/app/store.js";
import type {
  AdminFeedback,
  AdminNotification,
  AutoReply,
  AutoReplyPolicy,
  Classification,
  EscalationRule,
  FaqCandidate,
  GuildSettings,
  LlmGenerationRun,
  Message,
  WeeklyReport,
} from "../../src/shared/types.js";
import type { QueueName, QueuePayload } from "../../src/shared/queue.js";

class RecordingLlmClient implements LlmClient {
  readonly modelName = "recording-llm";
  readonly requests: LlmJsonRequest[] = [];

  constructor(
    private readonly outputs: Partial<Record<LlmJsonRequest["taskType"], Record<string, unknown>>>,
    private readonly failures: readonly LlmJsonRequest["taskType"][] = [],
  ) {}

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResult> {
    await Promise.resolve();
    this.requests.push(request);
    if (this.failures.includes(request.taskType)) {
      throw new Error(`${request.taskType} failed`);
    }
    const rawJson = this.outputs[request.taskType] ?? defaultOutput(request.taskType);
    return {
      modelName: this.modelName,
      rawText: JSON.stringify(rawJson),
      rawJson,
    };
  }
}

class MemoryRepository implements Phase1Repository {
  retentionSweepCount = 0;

  constructor(readonly state: Phase1State) {}

  ensureSeed(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  loadState(): Promise<Phase1State> {
    return Promise.resolve(this.state);
  }

  saveState(nextState: Phase1State): Promise<void> {
    this.state.settings = nextState.settings;
    this.state.autoReplyPolicy = nextState.autoReplyPolicy;
    return Promise.resolve();
  }

  getSettings(): Promise<GuildSettings> {
    return Promise.resolve(this.state.settings);
  }

  updateSettings(settings: GuildSettings): Promise<GuildSettings> {
    this.state.settings = settings;
    return Promise.resolve(settings);
  }

  getAutoReplyPolicy(): Promise<AutoReplyPolicy> {
    return Promise.resolve(this.state.autoReplyPolicy);
  }

  updateAutoReplyPolicy(policy: AutoReplyPolicy): Promise<AutoReplyPolicy> {
    this.state.autoReplyPolicy = policy;
    return Promise.resolve(policy);
  }

  listEscalationRules(): Promise<readonly EscalationRule[]> {
    return Promise.resolve(this.state.autoReplyPolicy.escalationRules);
  }

  replaceEscalationRules(
    _guildId: string,
    rules: readonly EscalationRule[],
  ): Promise<readonly EscalationRule[]> {
    this.state.autoReplyPolicy = { ...this.state.autoReplyPolicy, escalationRules: rules };
    return Promise.resolve(rules);
  }

  upsertMessage(
    message: Message,
  ): Promise<{ readonly message: Message; readonly created: boolean }> {
    this.state.messages.set(message.id, message);
    return Promise.resolve({ message, created: true });
  }

  getMessage(id: string): Promise<Message | null> {
    return Promise.resolve(this.state.messages.get(id) ?? null);
  }

  listMessages(): Promise<readonly Message[]> {
    return Promise.resolve(
      [...this.state.messages.values()].filter((message) => message.deletedAt === null),
    );
  }

  listClassifications(): Promise<readonly Classification[]> {
    return Promise.resolve([...this.state.classifications.values()]);
  }

  getClassification(id: string): Promise<Classification | null> {
    return Promise.resolve(this.state.classifications.get(id) ?? null);
  }

  findClassificationByMessageId(messageId: string): Promise<Classification | null> {
    return Promise.resolve(
      [...this.state.classifications.values()].find(
        (classification) => classification.messageId === messageId,
      ) ?? null,
    );
  }

  listNotifications(): Promise<readonly AdminNotification[]> {
    return Promise.resolve([...this.state.notifications.values()]);
  }

  getNotification(id: string): Promise<AdminNotification | null> {
    return Promise.resolve(this.state.notifications.get(id) ?? null);
  }

  saveNotification(notification: AdminNotification): Promise<void> {
    this.state.notifications.set(notification.id, notification);
    return Promise.resolve();
  }

  claimPendingNotificationSend(id: string, claimToken: string): Promise<AdminNotification | null> {
    const notification = this.state.notifications.get(id);
    if (notification?.status !== "pending" || notification.sentMessageId !== null) {
      return Promise.resolve(null);
    }
    const claimed = { ...notification, sentMessageId: claimToken, failureReason: null };
    this.state.notifications.set(id, claimed);
    return Promise.resolve(claimed);
  }

  markClaimedNotificationSent(
    id: string,
    claimToken: string,
    sentMessageId: string,
  ): Promise<boolean> {
    const notification = this.state.notifications.get(id);
    if (notification?.status !== "pending" || notification.sentMessageId !== claimToken) {
      return Promise.resolve(false);
    }
    this.state.notifications.set(id, {
      ...notification,
      status: "sent",
      sentMessageId,
      sentAt: "2026-05-21T00:00:00.000Z",
      failureReason: null,
    });
    return Promise.resolve(true);
  }

  markClaimedNotificationFailed(id: string, claimToken: string, reason: string): Promise<boolean> {
    const notification = this.state.notifications.get(id);
    if (notification?.status !== "pending" || notification.sentMessageId !== claimToken) {
      return Promise.resolve(false);
    }
    this.state.notifications.set(id, {
      ...notification,
      status: "failed",
      sentMessageId: null,
      sentAt: null,
      failureReason: reason,
    });
    return Promise.resolve(true);
  }

  markNotificationSent(): Promise<void> {
    return Promise.resolve();
  }

  markNotificationFailed(): Promise<void> {
    return Promise.resolve();
  }

  dismissNotification(): Promise<void> {
    return Promise.resolve();
  }

  listAutoReplies(): Promise<readonly AutoReply[]> {
    return Promise.resolve([...this.state.autoReplies.values()]);
  }

  getAutoReply(id: string): Promise<AutoReply | null> {
    return Promise.resolve(this.state.autoReplies.get(id) ?? null);
  }

  saveAutoReply(autoReply: AutoReply): Promise<void> {
    this.state.autoReplies.set(autoReply.id, autoReply);
    return Promise.resolve();
  }

  updateAutoReply(autoReply: AutoReply): Promise<void> {
    this.state.autoReplies.set(autoReply.id, autoReply);
    return Promise.resolve();
  }

  listFaqCandidates(): Promise<readonly FaqCandidate[]> {
    return Promise.resolve([...this.state.faqCandidates.values()]);
  }

  getFaqCandidate(id: string): Promise<FaqCandidate | null> {
    return Promise.resolve(this.state.faqCandidates.get(id) ?? null);
  }

  updateFaqCandidateStatus(id: string, status: FaqCandidate["status"]): Promise<void> {
    const candidate = this.state.faqCandidates.get(id);
    if (candidate !== undefined) {
      this.state.faqCandidates.set(id, { ...candidate, status });
    }
    return Promise.resolve();
  }

  updateFaqCandidate(candidate: FaqCandidate): Promise<FaqCandidate> {
    this.state.faqCandidates.set(candidate.id, candidate);
    return Promise.resolve(candidate);
  }

  listWeeklyReports(): Promise<readonly WeeklyReport[]> {
    return Promise.resolve([...this.state.weeklyReports.values()]);
  }

  getWeeklyReport(id: string): Promise<WeeklyReport | null> {
    return Promise.resolve(this.state.weeklyReports.get(id) ?? null);
  }

  listLlmRuns(status?: LlmGenerationRun["status"]): Promise<readonly LlmGenerationRun[]> {
    const runs = [...this.state.llmGenerationRuns.values()];
    return Promise.resolve(
      status === undefined ? runs : runs.filter((run) => run.status === status),
    );
  }

  getLlmRun(id: string): Promise<LlmGenerationRun | null> {
    return Promise.resolve(this.state.llmGenerationRuns.get(id) ?? null);
  }

  saveFeedback(feedback: AdminFeedback): Promise<void> {
    this.state.feedback.set(feedback.id, feedback);
    return Promise.resolve();
  }

  logicalDeleteExpiredMessages(): Promise<number> {
    this.retentionSweepCount += 1;
    return Promise.resolve(0);
  }
}

class MemoryQueue implements QueuePublisher {
  readonly jobs: { readonly queueName: string; readonly payload: unknown }[] = [];

  add(queueName: QueueName, payload: QueuePayload): Promise<{ readonly id: string | undefined }> {
    this.jobs.push({ queueName, payload });
    return Promise.resolve({ id: undefined });
  }
}

function defaultOutput(taskType: LlmJsonRequest["taskType"]): Record<string, unknown> {
  if (taskType === "classification") {
    return {
      labels: ["質問"],
      importance: "medium",
      admin_action_needed: false,
      admin_action_type: "weekly_report",
      confidence: 0.91,
      reason: "使い方を確認している投稿のため。",
      suggested_summary: "使い方に関する質問。",
    };
  }
  if (taskType === "auto_reply") {
    return {
      decision: "send",
      reply_category: "intake",
      body: "受け付けました。",
      source_ref_ids: [],
      confidence: 0.91,
      reason: "受付返信として安全な範囲のため。",
      escalation_reason: "none",
    };
  }
  if (taskType === "faq_candidates") {
    return {
      candidates: [],
    };
  }
  return {
    short_body: "# 今週のDiscord運営メモ\n\n## まず確認したいこと\n\n- 要追加確認",
    detailed_body: "# 週次運営レポート\n\n## 12. 次の推奨アクション\n\n1. 要追加確認",
  };
}

function classificationFor(message: Message, fields: Partial<Classification> = {}): Classification {
  return {
    id: `classification-${message.id}`,
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

function autoReplyFor(message: Message, classification: Classification): AutoReply {
  return {
    id: `auto-reply-${message.id}`,
    messageId: message.id,
    classificationId: classification.id,
    mode: "intake_only",
    replyCategory: "intake",
    body: "受け付けました。",
    sourceRefs: [],
    confidence: 0.91,
    decisionReason: "受付返信として安全な範囲のため。",
    status: "sent",
    sentMessageId: `sent-${message.id}`,
    approvedBy: null,
    sentAt: "2026-05-21T00:00:00.000Z",
    createdAt: "2026-05-21T00:00:00.000Z",
  };
}

function faqCandidateFor(message: Message): FaqCandidate {
  return {
    id: `faq-${message.id}`,
    sourceMessageIds: [message.id],
    topic: "使い方の確認",
    currentAnswerStatus: "existing_faq_possible",
    draftQuestion: "基本的な使い方はどこで確認できますか？",
    draftAnswer: "この回答文案は公式回答ではありません。",
    confidence: 0.82,
    status: "candidate",
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
  };
}

function userPrompt(client: RecordingLlmClient, taskType: LlmJsonRequest["taskType"]): string {
  const request = client.requests.find((item) => item.taskType === taskType);
  const content = request?.messages.find((message) => message.role === "user")?.content;
  return typeof content === "string" ? content : "";
}

describe("persistent workflow retention filtering", () => {
  it("does not enqueue auto reply decisions for low-value small talk", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["general"],
    };
    const message = normalizeSampleRecord(
      {
        text: "今日は夕方の空がきれいでした。",
        channel_context: "#general / 雑談",
      },
      0,
    );
    state.messages.set(message.id, message);
    const repository = new MemoryRepository(state);
    const queues = new MemoryQueue();
    const client = new RecordingLlmClient({
      classification: {
        labels: ["雑談"],
        importance: "low",
        admin_action_needed: false,
        admin_action_type: "none",
        confidence: 0.94,
        reason: "一般的な雑談のため。",
        suggested_summary: "夕方の空についての雑談。",
      },
    });

    await handleMessageClassify(
      { repository, queues, llmClient: client },
      { messageId: message.id },
    );

    expect(queues.jobs.map((job) => job.queueName)).not.toContain("auto_reply.decide");
    expect(state.autoReplies.size).toBe(0);
    expect(client.requests.map((request) => request.taskType)).toEqual(["classification"]);
  });

  it("does not create auto reply records for stale small talk decision jobs", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["general"],
    };
    const message = normalizeSampleRecord(
      {
        text: "今日は夕方の空がきれいでした。",
        channel_context: "#general / 雑談",
      },
      0,
    );
    const classification = classificationFor(message, {
      labels: ["雑談"],
      importance: "low",
      adminActionNeeded: false,
      adminActionType: "none",
    });
    state.messages.set(message.id, message);
    state.classifications.set(classification.id, classification);
    const repository = new MemoryRepository(state);
    const client = new RecordingLlmClient({});

    await handleAutoReplyDecide(
      { repository, queues: new MemoryQueue(), llmClient: client },
      { messageId: message.id, classificationId: classification.id },
    );

    expect(state.autoReplies.size).toBe(0);
    expect(client.requests).toEqual([]);
    expect([...state.llmGenerationRuns.values()].some((run) => run.taskType === "auto_reply")).toBe(
      false,
    );
  });

  it("does not create escalated records for ordinary posts outside allowed labels", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["general"],
    };
    const message = normalizeSampleRecord(
      {
        text: "今回のアップデート、雰囲気がよくて好きです。",
        channel_context: "#general / 雑談",
      },
      0,
    );
    state.messages.set(message.id, message);
    const repository = new MemoryRepository(state);
    const queues = new MemoryQueue();
    const client = new RecordingLlmClient({
      classification: {
        labels: ["称賛"],
        importance: "medium",
        admin_action_needed: false,
        admin_action_type: "weekly_report",
        confidence: 0.9,
        reason: "ポジティブな感想だが運営対応は不要なため。",
        suggested_summary: "アップデートへの称賛。",
      },
    });

    await handleMessageClassify(
      { repository, queues, llmClient: client },
      { messageId: message.id },
    );

    expect(queues.jobs.map((job) => job.queueName)).not.toContain("auto_reply.decide");
    expect(state.autoReplies.size).toBe(0);
  });

  it("keeps high-risk posts outside allowed labels on the auto reply safety path", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["support"],
      allowedLabels: ["質問"],
    };
    const message = normalizeSampleRecord(
      {
        text: "無料プランは来月で全部終了って本当ですか？",
        channel_context: "#support / 料金質問",
      },
      0,
    );
    state.messages.set(message.id, message);
    const repository = new MemoryRepository(state);
    const queues = new MemoryQueue();
    const client = new RecordingLlmClient({
      classification: {
        labels: ["公式回答待ち"],
        importance: "high",
        admin_action_needed: true,
        admin_action_type: "reply_check",
        confidence: 0.91,
        reason: "料金に関する公式確認が必要なため。",
        suggested_summary: "料金に関する公式確認が必要な質問。",
      },
    });

    await handleMessageClassify(
      { repository, queues, llmClient: client },
      { messageId: message.id },
    );
    const classification = [...state.classifications.values()][0];
    expect(queues.jobs.map((job) => job.queueName)).toContain("auto_reply.decide");
    expect(queues.jobs.map((job) => job.queueName)).toContain("ops.notify");

    if (classification !== undefined) {
      await handleAutoReplyDecide(
        { repository, queues, llmClient: client },
        { messageId: message.id, classificationId: classification.id },
      );
    }

    expect([...state.autoReplies.values()][0]).toMatchObject({
      status: "escalated",
      sentMessageId: null,
    });
    expect(state.notifications.size).toBeGreaterThan(0);
  });

  it("runs retention sweep at the start of each generation handler", async () => {
    const state = createPhase1State();
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);
    const repository = new MemoryRepository(state);
    const queues = new MemoryQueue();
    const client = new RecordingLlmClient({
      faq_candidates: {
        candidates: [
          {
            source_message_ids: [message.id],
            topic: "Webhook設定",
            current_answer_status: "existing_faq_possible",
            draft_question: "Webhook設定はどこで確認できますか？",
            draft_answer: "この回答文案は公式回答ではありません。",
            confidence: 0.82,
            status: "candidate",
          },
        ],
      },
    });

    await handleMessageClassify(
      { repository, queues, llmClient: client },
      { messageId: message.id },
    );
    const classification = [...state.classifications.values()][0];
    expect(classification).toBeDefined();
    if (classification !== undefined) {
      await handleAutoReplyDecide(
        { repository, queues, llmClient: client },
        { messageId: message.id, classificationId: classification.id },
      );
    }
    await handleFaqGenerate({ repository, queues, llmClient: client });
    await handleReportWeekly(
      { repository, queues, llmClient: client },
      { periodStart: "2026-01-01", periodEnd: "2026-01-07", channelIds: ["support"] },
    );

    expect(repository.retentionSweepCount).toBe(4);
  });

  it("passes only active messages and classifications to FAQ generation", async () => {
    const state = createPhase1State();
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
          text: "削除済みのFAQ候補質問です。",
          channel_context: "#support / 使い方質問",
        },
        1,
      ),
      deletedAt: "2026-05-21T00:00:00.000Z",
    };
    state.messages.set(activeMessage.id, activeMessage);
    state.messages.set(deletedMessage.id, deletedMessage);
    state.classifications.set("active-classification", classificationFor(activeMessage));
    state.classifications.set("deleted-classification", classificationFor(deletedMessage));
    const repository = new MemoryRepository(state);
    const client = new RecordingLlmClient({
      faq_candidates: {
        candidates: [
          {
            source_message_ids: [activeMessage.id],
            topic: "Webhook設定",
            current_answer_status: "existing_faq_possible",
            draft_question: "Webhook設定はどこで確認できますか？",
            draft_answer: "この回答文案は公式回答ではありません。",
            confidence: 0.82,
            status: "candidate",
          },
        ],
      },
    });

    await handleFaqGenerate({ repository, queues: new MemoryQueue(), llmClient: client });

    const prompt = userPrompt(client, "faq_candidates");
    expect(prompt).toContain(activeMessage.id);
    expect(prompt).not.toContain(deletedMessage.id);
    expect([...state.faqCandidates.values()]).toEqual([
      expect.objectContaining({ sourceMessageIds: [activeMessage.id] }),
    ]);
  });

  it("uses faq.generate messageIds to scope FAQ generation input", async () => {
    const state = createPhase1State();
    const targetMessage = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    const otherMessage = normalizeSampleRecord(
      {
        text: "料金設定について雑談しています。",
        channel_context: "#general / 雑談",
      },
      1,
    );
    state.messages.set(targetMessage.id, targetMessage);
    state.messages.set(otherMessage.id, otherMessage);
    state.classifications.set("target-classification", classificationFor(targetMessage));
    state.classifications.set("other-classification", classificationFor(otherMessage));
    const repository = new MemoryRepository(state);
    const client = new RecordingLlmClient({
      faq_candidates: {
        candidates: [
          {
            source_message_ids: [targetMessage.id],
            topic: "Webhook設定",
            current_answer_status: "existing_faq_possible",
            draft_question: "Webhook設定はどこで確認できますか？",
            draft_answer: "この回答文案は公式回答ではありません。",
            confidence: 0.82,
            status: "candidate",
          },
        ],
      },
    });

    await handleFaqGenerate(
      { repository, queues: new MemoryQueue(), llmClient: client },
      { messageIds: [targetMessage.id] },
    );

    const prompt = userPrompt(client, "faq_candidates");
    expect(prompt).toContain(targetMessage.id);
    expect(prompt).not.toContain(otherMessage.id);
    expect([...state.faqCandidates.values()]).toEqual([
      expect.objectContaining({ sourceMessageIds: [targetMessage.id] }),
    ]);
  });

  it("uses faq.generate period filters and preserves out-of-scope FAQ candidates", async () => {
    const state = createPhase1State();
    const inPeriodMessage = {
      ...normalizeSampleRecord(
        {
          text: "Webhook通知の設定ってどこからできますか？",
          channel_context: "#support / 使い方質問",
        },
        0,
      ),
      postedAt: "2026-01-03T12:00:00.000Z",
    };
    const outOfPeriodMessage = {
      ...normalizeSampleRecord(
        {
          text: "管理画面の通知設定を確認したいです。",
          channel_context: "#support / 使い方質問",
        },
        1,
      ),
      postedAt: "2026-01-10T12:00:00.000Z",
    };
    state.messages.set(inPeriodMessage.id, inPeriodMessage);
    state.messages.set(outOfPeriodMessage.id, outOfPeriodMessage);
    state.classifications.set("in-period-classification", classificationFor(inPeriodMessage));
    state.classifications.set(
      "out-of-period-classification",
      classificationFor(outOfPeriodMessage),
    );
    state.faqCandidates.set(`faq-${inPeriodMessage.id}`, faqCandidateFor(inPeriodMessage));
    state.faqCandidates.set(`faq-${outOfPeriodMessage.id}`, faqCandidateFor(outOfPeriodMessage));
    const repository = new MemoryRepository(state);
    const client = new RecordingLlmClient({
      faq_candidates: {
        candidates: [
          {
            source_message_ids: [inPeriodMessage.id],
            topic: "Webhook設定の確認",
            current_answer_status: "existing_faq_possible",
            draft_question: "Webhook設定はどこで確認できますか？",
            draft_answer: "この回答文案は公式回答ではありません。",
            confidence: 0.82,
            status: "candidate",
          },
        ],
      },
    });

    await handleFaqGenerate(
      { repository, queues: new MemoryQueue(), llmClient: client },
      { periodStart: "2026-01-01", periodEnd: "2026-01-07" },
    );

    const prompt = userPrompt(client, "faq_candidates");
    expect(prompt).toContain(inPeriodMessage.id);
    expect(prompt).not.toContain(outOfPeriodMessage.id);
    expect(state.faqCandidates.has(`faq-${inPeriodMessage.id}`)).toBe(false);
    expect(state.faqCandidates.has(`faq-${outOfPeriodMessage.id}`)).toBe(true);
    expect([...state.faqCandidates.values()]).toContainEqual(
      expect.objectContaining({
        sourceMessageIds: [inPeriodMessage.id],
        topic: "Webhook設定の確認",
      }),
    );
  });

  it("excludes deleted message derived data from report metrics", async () => {
    const state = createPhase1State();
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
    const activeClassification = classificationFor(activeMessage, {
      id: "active-classification",
      labels: ["未回答質問"],
    });
    const deletedClassification = classificationFor(deletedMessage, {
      id: "deleted-classification",
      labels: ["バグ報告"],
    });
    state.messages.set(activeMessage.id, activeMessage);
    state.messages.set(deletedMessage.id, deletedMessage);
    state.classifications.set(activeClassification.id, activeClassification);
    state.classifications.set(deletedClassification.id, deletedClassification);
    state.autoReplies.set("active-reply", autoReplyFor(activeMessage, activeClassification));
    state.autoReplies.set("deleted-reply", autoReplyFor(deletedMessage, deletedClassification));
    state.faqCandidates.set("active-faq", faqCandidateFor(activeMessage));
    state.faqCandidates.set("deleted-faq", faqCandidateFor(deletedMessage));
    const repository = new MemoryRepository(state);
    const client = new RecordingLlmClient({}, ["faq_candidates"]);

    await handleReportWeekly(
      { repository, queues: new MemoryQueue(), llmClient: client },
      { periodStart: "2026-01-01", periodEnd: "2026-01-07", channelIds: ["support"] },
    );

    const report = [...state.weeklyReports.values()][0];
    const weeklyPrompt = userPrompt(client, "weekly_report");
    expect(report?.metrics).toMatchObject({
      unansweredQuestionCount: 1,
      bugReportCount: 0,
      faqCandidateCount: 1,
      autoReplySentCount: 1,
    });
    expect(weeklyPrompt).toContain(activeMessage.id);
    expect(weeklyPrompt).not.toContain(deletedMessage.id);
  });

  it("uses report.weekly channelIds for report inputs, metrics, and metadata", async () => {
    const state = createPhase1State();
    const supportMessage = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    const bugsMessage = normalizeSampleRecord(
      {
        text: "ログイン時に500エラーになります。",
        channel_context: "#bugs / 不具合報告",
      },
      1,
    );
    const supportClassification = classificationFor(supportMessage, {
      id: "support-classification",
      labels: ["未回答質問"],
    });
    const bugsClassification = classificationFor(bugsMessage, {
      id: "bugs-classification",
      labels: ["バグ報告"],
    });
    state.messages.set(supportMessage.id, supportMessage);
    state.messages.set(bugsMessage.id, bugsMessage);
    state.classifications.set(supportClassification.id, supportClassification);
    state.classifications.set(bugsClassification.id, bugsClassification);
    state.autoReplies.set("support-reply", autoReplyFor(supportMessage, supportClassification));
    state.autoReplies.set("bugs-reply", autoReplyFor(bugsMessage, bugsClassification));
    state.faqCandidates.set("support-faq", faqCandidateFor(supportMessage));
    state.faqCandidates.set("bugs-faq", faqCandidateFor(bugsMessage));
    const repository = new MemoryRepository(state);
    const client = new RecordingLlmClient({
      faq_candidates: {
        candidates: [
          {
            source_message_ids: [supportMessage.id],
            topic: "Webhook設定",
            current_answer_status: "existing_faq_possible",
            draft_question: "Webhook設定はどこで確認できますか？",
            draft_answer: "この回答文案は公式回答ではありません。",
            confidence: 0.82,
            status: "candidate",
          },
        ],
      },
    });

    await handleReportWeekly(
      { repository, queues: new MemoryQueue(), llmClient: client },
      { periodStart: "2026-01-01", periodEnd: "2026-01-07", channelIds: ["support"] },
    );

    const report = [...state.weeklyReports.values()][0];
    const weeklyPrompt = userPrompt(client, "weekly_report");
    expect(report).toMatchObject({
      targetChannelIds: ["support"],
      messageCount: 1,
      metrics: {
        unansweredQuestionCount: 1,
        bugReportCount: 0,
        faqCandidateCount: 1,
        autoReplySentCount: 1,
      },
    });
    expect(weeklyPrompt).toContain(supportMessage.id);
    expect(weeklyPrompt).not.toContain(bugsMessage.id);
    expect(weeklyPrompt).toContain("対象チャンネル:\nsupport");
  });
});
