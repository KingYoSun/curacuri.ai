import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import {
  autoReplyCategories,
  autoReplyModes,
  classificationLabels,
  escalationActions,
  escalationRuleTypes,
  importances,
  manualKnowledgeSourceTypes,
  manualKnowledgeStatuses,
  type EscalationRule,
  type EscalationRuleType,
  type FaqCandidate,
  type FaqCandidateStatus,
  type ManualKnowledge,
} from "../shared/types.js";
import { isNotificationSendClaim } from "../shared/notifications.js";
import { getLastCompletedWeekPeriod } from "../shared/report-period.js";
import { allowedFaqStatusTransitions, canModerateAutoReply } from "./action-rules.js";
import { loadDashboardData, patchFaqCandidate, postFeedback, sendJson } from "./api.js";
import {
  ConfirmAction,
  CountBadge,
  EmptyList,
  ErrorBanner,
  FeedbackForm,
  MetricCard,
  SectionCard,
  SelectField,
  TextAreaField,
  TextField,
} from "./DashboardComponents.js";
import {
  autoReplyCategoryLabels,
  autoReplyStatusLabels,
  confidenceLabel,
  escalationActionLabels,
  escalationRuleTypeLabels,
  faqPatchForStatus,
  faqStatusLabels,
  importanceLabels,
  manualKnowledgeSourceTypeLabels,
  manualKnowledgeStatusLabels,
  notificationStatusLabels,
  weeklyReportStatusLabels,
} from "./labels.js";
import type {
  DashboardData,
  EscalationRuleDraft,
  FeedbackDraft,
  ManualKnowledgeDraft,
  MessageFilters,
  PolicyDraft,
  SettingsDraft,
} from "./types.js";

const INITIAL_LIMIT = 8;

type ActionKey =
  | "auto-reply-approve"
  | "auto-reply-reject"
  | "faq-feedback"
  | "faq-save"
  | "feedback"
  | "filter"
  | "llm-reprocess"
  | "llm-retry"
  | "manual-knowledge-create"
  | "manual-knowledge-reindex"
  | "manual-knowledge-save"
  | "notification-dismiss"
  | "queue-retry"
  | "report-generate"
  | "sample-import"
  | "settings-save"
  | "policy-save";

const emptyFilters: MessageFilters = {
  periodStart: "",
  periodEnd: "",
  channelId: "",
  label: "",
};

function lines(value: readonly string[]): string {
  return value.join("\n");
}

function parseLines(value: string): readonly string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function conditionValueFromRule(rule: EscalationRule): string {
  if (rule.ruleType === "label") {
    return lines(Array.isArray(rule.condition.labels) ? (rule.condition.labels as string[]) : []);
  }
  if (rule.ruleType === "category") {
    return lines(
      Array.isArray(rule.condition.categories) ? (rule.condition.categories as string[]) : [],
    );
  }
  if (rule.ruleType === "keyword") {
    return lines(
      Array.isArray(rule.condition.keywords) ? (rule.condition.keywords as string[]) : [],
    );
  }
  if (rule.ruleType === "importance") {
    return lines(
      Array.isArray(rule.condition.importances) ? (rule.condition.importances as string[]) : [],
    );
  }
  if (rule.ruleType === "confidence") {
    const value = rule.condition.maxConfidence;
    return typeof value === "number" ? String(value) : "0.8";
  }
  return "";
}

function draftFromRule(rule: EscalationRule): EscalationRuleDraft {
  return {
    id: rule.id,
    enabled: rule.enabled,
    ruleType: rule.ruleType,
    action: rule.action,
    conditionValue: conditionValueFromRule(rule),
    createdAt: rule.createdAt,
  };
}

function defaultConditionValue(ruleType: EscalationRuleType): string {
  if (ruleType === "confidence") return "0.8";
  if (ruleType === "official_needed" || ruleType === "privacy_or_rule") return "";
  return "";
}

function newRuleDraft(): EscalationRuleDraft {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    ruleType: "keyword",
    action: "notify_admin",
    conditionValue: "",
  };
}

function conditionLabelFor(ruleType: EscalationRuleType): string {
  if (ruleType === "label") return "対象ラベル";
  if (ruleType === "category") return "対象カテゴリ";
  if (ruleType === "keyword") return "対象キーワード";
  if (ruleType === "importance") return "対象重要度";
  if (ruleType === "confidence") return "最大confidence";
  return "条件";
}

function conditionDescriptionFor(ruleType: EscalationRuleType): string {
  if (ruleType === "label") return `候補: ${classificationLabels.join(", ")}`;
  if (ruleType === "category") return `候補: ${autoReplyCategories.join(", ")}`;
  if (ruleType === "importance") return `候補: ${importances.join(", ")}`;
  if (ruleType === "confidence") return "0.0から1.0の範囲で指定します。";
  return "1行に1件ずつ指定します。";
}

function conditionFromRuleDraft(rule: EscalationRuleDraft): Record<string, unknown> {
  if (rule.ruleType === "label") return { labels: parseLines(rule.conditionValue) };
  if (rule.ruleType === "category") return { categories: parseLines(rule.conditionValue) };
  if (rule.ruleType === "keyword") return { keywords: parseLines(rule.conditionValue) };
  if (rule.ruleType === "importance") return { importances: parseLines(rule.conditionValue) };
  if (rule.ruleType === "confidence") {
    return { maxConfidence: Number.parseFloat(rule.conditionValue) };
  }
  return {};
}

function rulePayloadFromDraft(rule: EscalationRuleDraft): Record<string, unknown> {
  return {
    id: rule.id,
    ruleType: rule.ruleType,
    action: rule.action,
    enabled: rule.enabled,
    condition: conditionFromRuleDraft(rule),
    ...(rule.createdAt === undefined ? {} : { createdAt: rule.createdAt }),
  };
}

function settingsDraftFromData(data: DashboardData["settings"]): SettingsDraft {
  return {
    targetChannelIds: lines(data.targetChannelIds),
    excludedChannelIds: lines(data.excludedChannelIds),
    adminNotificationChannelId: data.adminNotificationChannelId,
    retentionDays: data.retentionDays,
    characterName: data.characterName,
    characterTone: data.characterTone,
  };
}

function policyDraftFromData(data: DashboardData["policy"]): PolicyDraft {
  return {
    enabled: data.enabled,
    mode: data.mode,
    allowedChannelIds: lines(data.allowedChannelIds),
    allowedLabels: lines(data.allowedLabels),
    allowedCategories: lines(data.allowedCategories),
    minConfidence: data.minConfidence,
    requireSourceForFaq: data.requireSourceForFaq,
    escalationRules: data.escalationRules.map(draftFromRule),
  };
}

function manualKnowledgeDraftFromItem(item: ManualKnowledge): ManualKnowledgeDraft {
  return {
    sourceType: item.sourceType,
    title: item.title,
    body: item.body,
    url: item.url ?? "",
    tags: lines(item.tags),
    status: item.status,
  };
}

function newManualKnowledgeDraft(): ManualKnowledgeDraft {
  return {
    sourceType: "official_faq",
    title: "",
    body: "",
    url: "",
    tags: "",
    status: "draft",
  };
}

function manualKnowledgePayloadFromDraft(draft: ManualKnowledgeDraft): Record<string, unknown> {
  return {
    sourceType: draft.sourceType,
    title: draft.title,
    body: draft.body,
    url: draft.url.trim().length === 0 ? null : draft.url.trim(),
    tags: parseLines(draft.tags),
    status: draft.status,
  };
}

function defaultFeedbackDraft(): FeedbackDraft {
  return { feedbackKind: "useful", note: "" };
}

function badgeVariantForStatus(
  status: string,
): "default" | "destructive" | "outline" | "secondary" {
  if (status === "failed" || status === "blocked" || status === "rejected") return "destructive";
  if (status === "sent" || status === "accepted" || status === "ready") return "default";
  if (status === "dismissed") return "outline";
  return "secondary";
}

function itemLimit<T>(items: readonly T[], limit: number): readonly T[] {
  return items.slice(0, limit);
}

function formatEpochMs(value: number): string {
  return new Date(value).toISOString();
}

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [messageFilters, setMessageFilters] = useState<MessageFilters>(emptyFilters);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, FeedbackDraft>>({});
  const [faqDrafts, setFaqDrafts] = useState<
    Record<string, Pick<FaqCandidate, "draftAnswer" | "draftQuestion" | "topic">>
  >({});
  const [manualKnowledgeDrafts, setManualKnowledgeDrafts] = useState<
    Record<string, ManualKnowledgeDraft>
  >({});
  const [manualKnowledgeCreateDraft, setManualKnowledgeCreateDraft] =
    useState<ManualKnowledgeDraft>(newManualKnowledgeDraft);
  const [reportPeriod, setReportPeriod] = useState({
    ...getLastCompletedWeekPeriod(),
  });
  const [limits, setLimits] = useState({
    messages: INITIAL_LIMIT,
    classifications: INITIAL_LIMIT,
    notifications: INITIAL_LIMIT,
    faqCandidates: INITIAL_LIMIT,
    manualKnowledge: INITIAL_LIMIT,
    autoReplies: INITIAL_LIMIT,
    failedRuns: INITIAL_LIMIT,
    failedQueueJobs: INITIAL_LIMIT,
    weeklyReports: 4,
  });

  const refreshDashboard = useCallback(
    async (options: { readonly preserveDirtyDrafts: boolean } = { preserveDirtyDrafts: true }) => {
      const nextData = await loadDashboardData(messageFilters);
      setData(nextData);
      if (!options.preserveDirtyDrafts || !settingsDirty) {
        setSettingsDraft(settingsDraftFromData(nextData.settings));
        if (!options.preserveDirtyDrafts) setSettingsDirty(false);
      }
      if (!options.preserveDirtyDrafts || !policyDirty) {
        setPolicyDraft(policyDraftFromData(nextData.policy));
        if (!options.preserveDirtyDrafts) setPolicyDirty(false);
      }
      setFaqDrafts((current) => {
        const next = { ...current };
        for (const item of nextData.faqCandidates) {
          next[item.id] ??= {
            topic: item.topic,
            draftQuestion: item.draftQuestion,
            draftAnswer: item.draftAnswer,
          };
        }
        return next;
      });
      setManualKnowledgeDrafts((current) => {
        const next = { ...current };
        for (const item of nextData.manualKnowledge) {
          next[item.id] ??= manualKnowledgeDraftFromItem(item);
        }
        return next;
      });
    },
    [messageFilters, policyDirty, settingsDirty],
  );

  useEffect(() => {
    void refreshDashboard().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      toast.error("ダッシュボードの読み込みに失敗しました", { description: message });
    });
  }, [refreshDashboard]);

  async function runAction(
    actionKey: ActionKey,
    successLabel: string,
    action: () => Promise<void>,
    options: { readonly preserveDirtyDrafts?: boolean } = {},
  ) {
    try {
      setPendingAction(actionKey);
      setErrorMessage(null);
      setSuccessMessage(null);
      await action();
      await refreshDashboard({ preserveDirtyDrafts: options.preserveDirtyDrafts ?? true });
      setSuccessMessage(successLabel);
      toast.success(successLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      toast.error("操作に失敗しました", { description: message });
      await refreshDashboard().catch(() => undefined);
    } finally {
      setPendingAction(null);
    }
  }

  function feedbackDraft(path: string): FeedbackDraft {
    return feedbackDrafts[path] ?? defaultFeedbackDraft();
  }

  function updateFeedbackDraft(path: string, draft: FeedbackDraft) {
    setFeedbackDrafts((current) => ({ ...current, [path]: draft }));
  }

  function submitFeedback(path: string) {
    void runAction("feedback", "フィードバックを記録しました", async () => {
      await postFeedback(path, feedbackDraft(path));
      updateFeedbackDraft(path, defaultFeedbackDraft());
    });
  }

  const metrics = useMemo(
    () => ({
      messages: data?.messages.length ?? 0,
      classifications: data?.classifications.length ?? 0,
      notifications: data?.notifications.length ?? 0,
      faqCandidates: data?.faqCandidates.length ?? 0,
      manualKnowledge: data?.manualKnowledge.length ?? 0,
      autoReplies: data?.autoReplies.length ?? 0,
      weeklyReports: data?.weeklyReports.length ?? 0,
      failedRuns: data?.llmStatus.failedCount ?? 0,
      failedQueueJobs: data?.failedQueueJobs.length ?? 0,
    }),
    [data],
  );

  const isLoading = data === null;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 md:px-6 lg:px-8">
      <Toaster richColors position="top-right" />
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Dogfood Alpha</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            curacuri.ai 管理画面
          </h1>
          <p className="text-sm text-muted-foreground">
            運営者が投稿、分類、通知、FAQ候補、自動返信、週次レポートを確認する画面です。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pendingAction === "sample-import"}
            size="sm"
            variant="outline"
            onClick={() =>
              void runAction("sample-import", "サンプル投入を受け付けました", async () => {
                await sendJson("POST", "/api/import/sample-log", {});
              })
            }
          >
            {pendingAction === "sample-import" ? <Loader2Icon className="animate-spin" /> : null}
            サンプル投入
          </Button>
          <Button
            disabled={pendingAction === "report-generate"}
            size="sm"
            variant="outline"
            onClick={() =>
              void runAction("report-generate", "週次レポート生成を受け付けました", async () => {
                await sendJson("POST", "/api/reports/weekly", reportPeriod);
              })
            }
          >
            {pendingAction === "report-generate" ? <Loader2Icon className="animate-spin" /> : null}
            週次レポート生成
          </Button>
          <ConfirmAction
            description="全対象のLLM処理を再投入します。キュー投入後、結果の反映には時間がかかります。"
            disabled={pendingAction !== null}
            label="LLM一括再実行"
            pending={pendingAction === "llm-reprocess"}
            title="LLM生成を一括再実行しますか？"
            variant="destructive"
            onConfirm={() =>
              void runAction("llm-reprocess", "LLM一括再実行を受け付けました", async () => {
                await sendJson("POST", "/api/llm/reprocess", { scope: "all" });
              })
            }
          />
        </div>
      </header>

      {errorMessage === null ? null : <ErrorBanner message={errorMessage} />}
      {successMessage === null ? null : (
        <Alert>
          <CheckIcon className="size-4" />
          <AlertTitle>完了</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <section aria-label="運営メトリクス" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="投稿" value={metrics.messages} />
        <MetricCard label="分類" value={metrics.classifications} />
        <MetricCard label="通知" value={metrics.notifications} />
        <MetricCard label="FAQ候補" value={metrics.faqCandidates} />
        <MetricCard label="公式ナレッジ" value={metrics.manualKnowledge} />
        <MetricCard label="自動返信" value={metrics.autoReplies} />
        <MetricCard label="週次レポート" value={metrics.weeklyReports} />
        <MetricCard
          label="LLM失敗"
          tone={metrics.failedRuns > 0 ? "danger" : "default"}
          value={metrics.failedRuns}
        />
        <MetricCard
          label="Queue失敗"
          tone={metrics.failedQueueJobs > 0 ? "danger" : "default"}
          value={metrics.failedQueueJobs}
        />
      </section>

      {isLoading || settingsDraft === null || policyDraft === null ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            ダッシュボードを読み込んでいます。
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-5 xl:grid-cols-2">
            <SettingsPanel
              dirty={settingsDirty}
              draft={settingsDraft}
              pending={pendingAction === "settings-save"}
              onChange={(draft) => {
                setSettingsDraft(draft);
                setSettingsDirty(true);
              }}
              onSave={() =>
                void runAction(
                  "settings-save",
                  "対象設定を保存しました",
                  async () => {
                    await sendJson("PUT", "/api/settings", {
                      targetChannelIds: parseLines(settingsDraft.targetChannelIds),
                      excludedChannelIds: parseLines(settingsDraft.excludedChannelIds),
                      adminNotificationChannelId: settingsDraft.adminNotificationChannelId,
                      retentionDays: settingsDraft.retentionDays,
                      characterName: settingsDraft.characterName,
                      characterTone: settingsDraft.characterTone,
                    });
                  },
                  { preserveDirtyDrafts: false },
                )
              }
              onDiscard={() => {
                setSettingsDraft(settingsDraftFromData(data.settings));
                setSettingsDirty(false);
              }}
            />
            <PolicyPanel
              dirty={policyDirty}
              draft={policyDraft}
              pending={pendingAction === "policy-save"}
              onChange={(draft) => {
                setPolicyDraft(draft);
                setPolicyDirty(true);
              }}
              onSave={() =>
                void runAction(
                  "policy-save",
                  "自動返信ポリシーを保存しました",
                  async () => {
                    await sendJson("PUT", "/api/auto-reply/policy", {
                      enabled: policyDraft.enabled,
                      mode: policyDraft.mode,
                      allowedChannelIds: parseLines(policyDraft.allowedChannelIds),
                      allowedLabels: parseLines(policyDraft.allowedLabels),
                      allowedCategories: parseLines(policyDraft.allowedCategories),
                      minConfidence: policyDraft.minConfidence,
                      requireSourceForFaq: policyDraft.requireSourceForFaq,
                      escalationRules: policyDraft.escalationRules.map(rulePayloadFromDraft),
                    });
                  },
                  { preserveDirtyDrafts: false },
                )
              }
              onDiscard={() => {
                setPolicyDraft(policyDraftFromData(data.policy));
                setPolicyDirty(false);
              }}
            />
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <LlmPanel
              data={data}
              limit={limits.failedRuns}
              pending={pendingAction === "llm-retry"}
              onRetry={(id) =>
                void runAction("llm-retry", "LLM runの再実行を受け付けました", async () => {
                  await sendJson("POST", `/api/llm/runs/${id}/retry`, {});
                })
              }
              onShowMore={() => {
                setLimits((current) => ({
                  ...current,
                  failedRuns: current.failedRuns + INITIAL_LIMIT,
                }));
              }}
            />
            <QueueFailuresPanel
              data={data}
              limit={limits.failedQueueJobs}
              pending={pendingAction === "queue-retry"}
              onRetry={(queueName, id) =>
                void runAction("queue-retry", "Queue jobの再実行を受け付けました", async () => {
                  await sendJson("POST", `/api/queues/${queueName}/jobs/${id}/retry`, {});
                })
              }
              onShowMore={() => {
                setLimits((current) => ({
                  ...current,
                  failedQueueJobs: current.failedQueueJobs + INITIAL_LIMIT,
                }));
              }}
            />
            <ReportGenerator period={reportPeriod} onChange={setReportPeriod} />
          </section>

          <Tabs defaultValue="messages">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="messages">投稿</TabsTrigger>
              <TabsTrigger value="classifications">分類</TabsTrigger>
              <TabsTrigger value="notifications">通知</TabsTrigger>
              <TabsTrigger value="faq">FAQ候補</TabsTrigger>
              <TabsTrigger value="manualKnowledge">公式ナレッジ</TabsTrigger>
              <TabsTrigger value="autoReplies">自動返信</TabsTrigger>
              <TabsTrigger value="reports">週報</TabsTrigger>
            </TabsList>

            <TabsContent value="messages">
              <MessagesPanel
                filters={messageFilters}
                items={data.messages}
                limit={limits.messages}
                pending={pendingAction === "filter"}
                onApplyFilters={() => {
                  void runAction("filter", "投稿一覧を更新しました", () => Promise.resolve());
                }}
                onChangeFilters={setMessageFilters}
                onShowMore={() => {
                  setLimits((current) => ({
                    ...current,
                    messages: current.messages + INITIAL_LIMIT,
                  }));
                }}
              />
            </TabsContent>

            <TabsContent value="classifications">
              <ClassificationsPanel
                items={data.classifications}
                limit={limits.classifications}
                onShowMore={() => {
                  setLimits((current) => ({
                    ...current,
                    classifications: current.classifications + INITIAL_LIMIT,
                  }));
                }}
              />
            </TabsContent>

            <TabsContent value="notifications">
              <NotificationsPanel
                feedbackDraft={feedbackDraft}
                items={data.notifications}
                limit={limits.notifications}
                pendingAction={pendingAction}
                onDismiss={(id) =>
                  void runAction("notification-dismiss", "通知を非表示にしました", async () => {
                    await sendJson("POST", `/api/notifications/${id}/dismiss`, {});
                  })
                }
                onFeedbackChange={updateFeedbackDraft}
                onFeedbackSubmit={submitFeedback}
                onShowMore={() => {
                  setLimits((current) => ({
                    ...current,
                    notifications: current.notifications + INITIAL_LIMIT,
                  }));
                }}
              />
            </TabsContent>

            <TabsContent value="faq">
              <FaqPanel
                drafts={faqDrafts}
                feedbackDraft={feedbackDraft}
                items={data.faqCandidates}
                limit={limits.faqCandidates}
                pendingAction={pendingAction}
                onDraftChange={(id, draft) => {
                  setFaqDrafts((current) => ({ ...current, [id]: draft }));
                }}
                onFeedbackChange={updateFeedbackDraft}
                onFeedbackSubmit={submitFeedback}
                onSave={(item) =>
                  void runAction("faq-save", "FAQ候補を保存しました", async () => {
                    await patchFaqCandidate(
                      item.id,
                      faqDrafts[item.id] ?? {
                        topic: item.topic,
                        draftQuestion: item.draftQuestion,
                        draftAnswer: item.draftAnswer,
                      },
                    );
                  })
                }
                onStatus={(item, status) =>
                  void runAction("faq-feedback", "FAQ候補の状態を更新しました", async () => {
                    const patch = faqPatchForStatus(status);
                    await patchFaqCandidate(item.id, { status: patch.status });
                    await postFeedback(`/api/faq-candidates/${item.id}/feedback`, {
                      feedbackKind: patch.feedbackKind,
                      note: `${faqStatusLabels[status]}に変更`,
                    });
                  })
                }
                onShowMore={() => {
                  setLimits((current) => ({
                    ...current,
                    faqCandidates: current.faqCandidates + INITIAL_LIMIT,
                  }));
                }}
              />
            </TabsContent>

            <TabsContent value="manualKnowledge">
              <ManualKnowledgePanel
                createDraft={manualKnowledgeCreateDraft}
                drafts={manualKnowledgeDrafts}
                items={data.manualKnowledge}
                limit={limits.manualKnowledge}
                pendingAction={pendingAction}
                onCreate={() =>
                  void runAction(
                    "manual-knowledge-create",
                    "公式ナレッジを追加しました",
                    async () => {
                      await sendJson(
                        "POST",
                        "/api/manual-knowledge",
                        manualKnowledgePayloadFromDraft(manualKnowledgeCreateDraft),
                      );
                      setManualKnowledgeCreateDraft(newManualKnowledgeDraft());
                    },
                  )
                }
                onCreateDraftChange={setManualKnowledgeCreateDraft}
                onDraftChange={(id, draft) => {
                  setManualKnowledgeDrafts((current) => ({ ...current, [id]: draft }));
                }}
                onReindex={(id) =>
                  void runAction(
                    "manual-knowledge-reindex",
                    "公式ナレッジの再indexを実行しました",
                    async () => {
                      await sendJson("POST", `/api/manual-knowledge/${id}/reindex`, {});
                    },
                  )
                }
                onSave={(item) =>
                  void runAction(
                    "manual-knowledge-save",
                    "公式ナレッジを保存しました",
                    async () => {
                      await sendJson(
                        "PATCH",
                        `/api/manual-knowledge/${item.id}`,
                        manualKnowledgePayloadFromDraft(
                          manualKnowledgeDrafts[item.id] ?? manualKnowledgeDraftFromItem(item),
                        ),
                      );
                    },
                  )
                }
                onShowMore={() => {
                  setLimits((current) => ({
                    ...current,
                    manualKnowledge: current.manualKnowledge + INITIAL_LIMIT,
                  }));
                }}
              />
            </TabsContent>

            <TabsContent value="autoReplies">
              <AutoRepliesPanel
                feedbackDraft={feedbackDraft}
                items={data.autoReplies}
                limit={limits.autoReplies}
                pendingAction={pendingAction}
                onApprove={(id) =>
                  void runAction("auto-reply-approve", "自動返信を承認しました", async () => {
                    await sendJson("POST", `/api/auto-replies/${id}/approve`, {});
                  })
                }
                onFeedbackChange={updateFeedbackDraft}
                onFeedbackSubmit={submitFeedback}
                onReject={(id) =>
                  void runAction("auto-reply-reject", "自動返信を却下しました", async () => {
                    await sendJson("POST", `/api/auto-replies/${id}/reject`, {});
                  })
                }
                onShowMore={() => {
                  setLimits((current) => ({
                    ...current,
                    autoReplies: current.autoReplies + INITIAL_LIMIT,
                  }));
                }}
              />
            </TabsContent>

            <TabsContent value="reports">
              <WeeklyReportsPanel
                feedbackDraft={feedbackDraft}
                items={data.weeklyReports}
                limit={limits.weeklyReports}
                onFeedbackChange={updateFeedbackDraft}
                onFeedbackSubmit={submitFeedback}
                onShowMore={() => {
                  setLimits((current) => ({
                    ...current,
                    weeklyReports: current.weeklyReports + 4,
                  }));
                }}
              />
            </TabsContent>
          </Tabs>

          <SectionCard title="導入告知テンプレート">
            <p className="text-sm leading-7 text-muted-foreground">
              指定された公開チャンネルの投稿だけを対象にし、DMは読みません。
              ユーザーを評価、採点、自動処分せず、質問、要望、不具合報告、不満を運営が見落とさないために整理します。
              自動返信はAIキャラクターの補助回答であり、公式判断が必要なものは運営者確認に回します。
            </p>
          </SectionCard>
        </>
      )}
    </main>
  );
}

function SettingsPanel(props: {
  readonly dirty: boolean;
  readonly draft: SettingsDraft;
  readonly pending: boolean;
  readonly onChange: (draft: SettingsDraft) => void;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}) {
  return (
    <SectionCard
      action={<DirtyBadge dirty={props.dirty} />}
      description="分析対象チャンネル、保存期間、AIキャラクターの基本設定です。"
      title="対象設定"
    >
      <div className="grid gap-4">
        <TextAreaField
          description="1行に1つのチャンネルIDを入力します。"
          label="対象チャンネル"
          value={props.draft.targetChannelIds}
          onChange={(value) => {
            props.onChange({ ...props.draft, targetChannelIds: value });
          }}
        />
        <TextAreaField
          description="分析から除外するチャンネルIDです。"
          label="対象外チャンネル"
          value={props.draft.excludedChannelIds}
          onChange={(value) => {
            props.onChange({ ...props.draft, excludedChannelIds: value });
          }}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="管理者通知チャンネル"
            value={props.draft.adminNotificationChannelId}
            onChange={(value) => {
              props.onChange({ ...props.draft, adminNotificationChannelId: value });
            }}
          />
          <TextField
            description="1から365日の範囲で指定します。"
            label="保存期間（日）"
            max={365}
            min={1}
            type="number"
            value={String(props.draft.retentionDays)}
            onChange={(value) => {
              props.onChange({
                ...props.draft,
                retentionDays: Number.parseInt(value, 10) || 1,
              });
            }}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="キャラクター名"
            value={props.draft.characterName}
            onChange={(value) => {
              props.onChange({ ...props.draft, characterName: value });
            }}
          />
          <TextField
            label="口調"
            value={props.draft.characterTone}
            onChange={(value) => {
              props.onChange({ ...props.draft, characterTone: value });
            }}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={!props.dirty || props.pending}
            variant="outline"
            onClick={props.onDiscard}
          >
            変更を破棄
          </Button>
          <Button disabled={!props.dirty || props.pending} onClick={props.onSave}>
            {props.pending ? <Loader2Icon className="animate-spin" /> : null}
            設定を保存
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function PolicyPanel(props: {
  readonly dirty: boolean;
  readonly draft: PolicyDraft;
  readonly pending: boolean;
  readonly onChange: (draft: PolicyDraft) => void;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}) {
  return (
    <SectionCard
      action={<DirtyBadge dirty={props.dirty} />}
      description="自動返信の許可範囲、モード、最低confidenceを制御します。"
      title="自動返信ポリシー"
    >
      <div className="grid gap-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">自動返信を有効にする</div>
            <div className="text-sm text-muted-foreground">
              disabledモードでは自動的に無効です。
            </div>
          </div>
          <Switch
            checked={props.draft.enabled}
            onCheckedChange={(checked) => {
              props.onChange({ ...props.draft, enabled: checked });
            }}
          />
        </div>
        <SelectField
          label="モード"
          options={autoReplyModes.map((mode) => ({ value: mode, label: autoReplyModeLabel(mode) }))}
          value={props.draft.mode}
          onChange={(mode) => {
            props.onChange({ ...props.draft, mode });
          }}
        />
        <TextAreaField
          label="許可チャンネル"
          value={props.draft.allowedChannelIds}
          onChange={(value) => {
            props.onChange({ ...props.draft, allowedChannelIds: value });
          }}
        />
        <TextAreaField
          label="許可ラベル"
          value={props.draft.allowedLabels}
          onChange={(value) => {
            props.onChange({ ...props.draft, allowedLabels: value });
          }}
        />
        <SelectField
          label="許可カテゴリを追加"
          options={[
            { value: "", label: "選択してください" },
            ...autoReplyCategories.map((category) => ({
              value: category,
              label: autoReplyCategoryLabels[category],
            })),
          ]}
          value=""
          onChange={(value) => {
            if (value.length === 0) return;
            const current = parseLines(props.draft.allowedCategories);
            props.onChange({
              ...props.draft,
              allowedCategories: lines([...new Set([...current, value])]),
            });
          }}
        />
        <TextAreaField
          label="許可カテゴリ"
          value={props.draft.allowedCategories}
          onChange={(value) => {
            props.onChange({ ...props.draft, allowedCategories: value });
          }}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            description="0.0から1.0の範囲で指定します。"
            label="最小confidence"
            max={1}
            min={0}
            step={0.01}
            type="number"
            value={String(props.draft.minConfidence)}
            onChange={(value) => {
              props.onChange({ ...props.draft, minConfidence: Number.parseFloat(value) || 0 });
            }}
          />
          <label className="flex items-center gap-2 rounded-lg border p-3 text-sm font-medium">
            <Checkbox
              checked={props.draft.requireSourceForFaq}
              onCheckedChange={(checked) => {
                props.onChange({
                  ...props.draft,
                  requireSourceForFaq: checked === true,
                });
              }}
            />
            FAQ参照元を必須にする
          </label>
        </div>
        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">エスカレーションルール</div>
              <div className="text-sm text-muted-foreground">
                条件に一致した投稿は自動返信せず、指定した扱いに切り替えます。
              </div>
            </div>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                props.onChange({
                  ...props.draft,
                  escalationRules: [...props.draft.escalationRules, newRuleDraft()],
                });
              }}
            >
              <PlusIcon />
              追加
            </Button>
          </div>
          {props.draft.escalationRules.length === 0 ? (
            <EmptyList description="追加ルールはありません。" title="ルール未設定" />
          ) : (
            props.draft.escalationRules.map((rule, index) => (
              <EscalationRuleEditor
                key={rule.id}
                rule={rule}
                onChange={(updatedRule) => {
                  props.onChange({
                    ...props.draft,
                    escalationRules: props.draft.escalationRules.map((candidate, ruleIndex) =>
                      ruleIndex === index ? updatedRule : candidate,
                    ),
                  });
                }}
                onRemove={() => {
                  props.onChange({
                    ...props.draft,
                    escalationRules: props.draft.escalationRules.filter(
                      (_candidate, ruleIndex) => ruleIndex !== index,
                    ),
                  });
                }}
              />
            ))
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={!props.dirty || props.pending}
            variant="outline"
            onClick={props.onDiscard}
          >
            変更を破棄
          </Button>
          <Button disabled={!props.dirty || props.pending} onClick={props.onSave}>
            {props.pending ? <Loader2Icon className="animate-spin" /> : null}
            ポリシーを保存
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function EscalationRuleEditor(props: {
  readonly rule: EscalationRuleDraft;
  readonly onChange: (rule: EscalationRuleDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={props.rule.enabled}
            onCheckedChange={(checked) => {
              props.onChange({ ...props.rule, enabled: checked === true });
            }}
          />
          有効
        </label>
        <Button size="icon-sm" type="button" variant="ghost" onClick={props.onRemove}>
          <Trash2Icon />
          <span className="sr-only">削除</span>
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          label="ルール種別"
          options={escalationRuleTypes.map((ruleType) => ({
            value: ruleType,
            label: escalationRuleTypeLabels[ruleType],
          }))}
          value={props.rule.ruleType}
          onChange={(ruleType) => {
            props.onChange({
              ...props.rule,
              ruleType,
              conditionValue: defaultConditionValue(ruleType),
            });
          }}
        />
        <SelectField
          label="アクション"
          options={escalationActions.map((action) => ({
            value: action,
            label: escalationActionLabels[action],
          }))}
          value={props.rule.action}
          onChange={(action) => {
            props.onChange({ ...props.rule, action });
          }}
        />
      </div>
      {props.rule.ruleType === "official_needed" || props.rule.ruleType === "privacy_or_rule" ? (
        <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          このルール種別は分類結果と固定キーワードから判定します。
        </div>
      ) : props.rule.ruleType === "confidence" ? (
        <TextField
          description={conditionDescriptionFor(props.rule.ruleType)}
          label={conditionLabelFor(props.rule.ruleType)}
          max={1}
          min={0}
          step={0.01}
          type="number"
          value={props.rule.conditionValue}
          onChange={(value) => {
            props.onChange({ ...props.rule, conditionValue: value });
          }}
        />
      ) : (
        <TextAreaField
          description={conditionDescriptionFor(props.rule.ruleType)}
          label={conditionLabelFor(props.rule.ruleType)}
          value={props.rule.conditionValue}
          onChange={(value) => {
            props.onChange({ ...props.rule, conditionValue: value });
          }}
        />
      )}
    </div>
  );
}

function LlmPanel(props: {
  readonly data: DashboardData;
  readonly limit: number;
  readonly pending: boolean;
  readonly onRetry: (id: string) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.data.failedRuns, props.limit);
  return (
    <SectionCard description="接続状態と失敗runの再実行導線です。" title="LLM接続">
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 text-sm">
        <dt className="text-muted-foreground">状態</dt>
        <dd>{props.data.llmStatus.configured ? "設定済み" : "未設定"}</dd>
        <dt className="text-muted-foreground">モデル</dt>
        <dd className="break-all">{props.data.llmStatus.modelName}</dd>
        <dt className="text-muted-foreground">Base URL</dt>
        <dd className="break-all">{props.data.llmStatus.baseUrl}</dd>
        <dt className="text-muted-foreground">JSON方式</dt>
        <dd>{props.data.llmStatus.responseFormat}</dd>
        <dt className="text-muted-foreground">同時実行</dt>
        <dd>{props.data.llmStatus.concurrency}</dd>
      </dl>
      <Separator className="my-4" />
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">失敗run</h3>
        <CountBadge shown={shown.length} total={props.data.failedRuns.length} />
      </div>
      <div className="grid gap-2">
        {props.data.failedRuns.length === 0 ? (
          <EmptyList description="失敗中のLLM生成はありません。" title="失敗runはありません" />
        ) : (
          shown.map((run) => (
            <div
              className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              key={run.id}
            >
              <div className="min-w-0">
                <div className="font-medium">{run.taskType}</div>
                <div className="break-all text-xs text-muted-foreground">{run.targetId}</div>
                <p className="mt-1 break-words text-sm">
                  {run.errorMessage ?? run.errorCode ?? "詳細なし"}
                </p>
              </div>
              <ConfirmAction
                description="このLLM runの対象だけを再実行キューに入れます。"
                disabled={props.pending}
                label="再実行"
                pending={props.pending}
                title="LLM runを再実行しますか？"
                onConfirm={() => {
                  props.onRetry(run.id);
                }}
              />
            </div>
          ))
        )}
        <ShowMore
          shown={shown.length}
          total={props.data.failedRuns.length}
          onShowMore={props.onShowMore}
        />
      </div>
    </SectionCard>
  );
}

function QueueFailuresPanel(props: {
  readonly data: DashboardData;
  readonly limit: number;
  readonly pending: boolean;
  readonly onRetry: (queueName: string, id: string) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.data.failedQueueJobs, props.limit);
  return (
    <SectionCard description="BullMQ job自体の失敗一覧と再実行導線です。" title="Queue失敗">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">failed jobs</h3>
        <CountBadge shown={shown.length} total={props.data.failedQueueJobs.length} />
      </div>
      <div className="grid gap-2">
        {props.data.failedQueueJobs.length === 0 ? (
          <EmptyList description="失敗中のQueue jobはありません。" title="Queue失敗はありません" />
        ) : (
          shown.map((job) => (
            <div
              className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              key={`${job.queueName}:${job.id}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{job.queueName}</Badge>
                  <span className="break-all text-sm font-medium">{job.id}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  試行 {job.attemptsMade} / 終了 {formatEpochMs(job.finishedOn ?? job.timestamp)}
                </div>
                <p className="mt-1 break-words text-sm">{job.failedReason ?? "詳細なし"}</p>
              </div>
              <ConfirmAction
                description="このfailed jobをBullMQの待機状態へ戻します。"
                disabled={props.pending}
                label="再実行"
                pending={props.pending}
                title="Queue jobを再実行しますか？"
                onConfirm={() => {
                  props.onRetry(job.queueName, job.id);
                }}
              />
            </div>
          ))
        )}
        <ShowMore
          shown={shown.length}
          total={props.data.failedQueueJobs.length}
          onShowMore={props.onShowMore}
        />
      </div>
    </SectionCard>
  );
}

function ReportGenerator(props: {
  readonly period: { readonly periodStart: string; readonly periodEnd: string };
  readonly onChange: (period: { readonly periodStart: string; readonly periodEnd: string }) => void;
}) {
  return (
    <SectionCard
      description="生成ボタンは画面右上にあります。直近完了週を初期値にしています。"
      title="週次レポート生成期間"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="開始日"
          type="date"
          value={props.period.periodStart}
          onChange={(value) => {
            props.onChange({ ...props.period, periodStart: value });
          }}
        />
        <TextField
          label="終了日"
          type="date"
          value={props.period.periodEnd}
          onChange={(value) => {
            props.onChange({ ...props.period, periodEnd: value });
          }}
        />
      </div>
    </SectionCard>
  );
}

function MessagesPanel(props: {
  readonly filters: MessageFilters;
  readonly items: DashboardData["messages"];
  readonly limit: number;
  readonly pending: boolean;
  readonly onApplyFilters: () => void;
  readonly onChangeFilters: (filters: MessageFilters) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.items, props.limit);
  return (
    <SectionCard
      action={<CountBadge shown={shown.length} total={props.items.length} />}
      description="期間、チャンネル、ラベルで投稿を絞り込みます。"
      title="投稿一覧"
    >
      <div className="mb-4 grid gap-3 lg:grid-cols-5">
        <TextField
          label="開始日"
          type="date"
          value={props.filters.periodStart}
          onChange={(value) => {
            props.onChangeFilters({ ...props.filters, periodStart: value });
          }}
        />
        <TextField
          label="終了日"
          type="date"
          value={props.filters.periodEnd}
          onChange={(value) => {
            props.onChangeFilters({ ...props.filters, periodEnd: value });
          }}
        />
        <TextField
          label="チャンネルID"
          value={props.filters.channelId}
          onChange={(value) => {
            props.onChangeFilters({ ...props.filters, channelId: value });
          }}
        />
        <SelectField
          label="ラベル"
          options={[
            { value: "", label: "すべて" },
            ...classificationLabels.map((label) => ({ value: label, label })),
          ]}
          value={props.filters.label}
          onChange={(label) => {
            props.onChangeFilters({ ...props.filters, label });
          }}
        />
        <div className="flex items-end gap-2">
          <Button className="w-full" disabled={props.pending} onClick={props.onApplyFilters}>
            {props.pending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
            絞り込み
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {props.items.length === 0 ? (
          <EmptyList description="条件に一致する投稿はありません。" title="投稿はありません" />
        ) : (
          shown.map((item) => (
            <div className="rounded-lg border p-3" key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.channelName}</Badge>
                <span className="text-xs text-muted-foreground">{item.postedAt}</span>
              </div>
              <p className="mt-2 break-words text-sm">{item.content}</p>
              <div className="mt-2 break-all text-xs text-muted-foreground">
                messageId: {item.messageId}
              </div>
            </div>
          ))
        )}
        <ShowMore shown={shown.length} total={props.items.length} onShowMore={props.onShowMore} />
      </div>
    </SectionCard>
  );
}

function ClassificationsPanel(props: {
  readonly items: DashboardData["classifications"];
  readonly limit: number;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.items, props.limit);
  return (
    <SectionCard
      action={<CountBadge shown={shown.length} total={props.items.length} />}
      description="LLM分類結果、重要度、要対応理由を確認します。"
      title="分類結果一覧"
    >
      <div className="grid gap-2">
        {props.items.length === 0 ? (
          <EmptyList description="分類結果はまだありません。" title="分類結果はありません" />
        ) : (
          shown.map((item) => (
            <div className="rounded-lg border p-3" key={item.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={item.importance === "critical" ? "destructive" : "outline"}>
                  重要度: {importanceLabels[item.importance]}
                </Badge>
                {item.adminActionNeeded ? (
                  <Badge>要対応</Badge>
                ) : (
                  <Badge variant="secondary">対応不要</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  confidence {confidenceLabel(item.confidence)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.labels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-sm font-medium">{item.suggestedSummary}</p>
              <p className="mt-1 break-words text-sm text-muted-foreground">{item.reason}</p>
              <div className="mt-2 break-all text-xs text-muted-foreground">
                messageId: {item.messageId}
              </div>
            </div>
          ))
        )}
        <ShowMore shown={shown.length} total={props.items.length} onShowMore={props.onShowMore} />
      </div>
    </SectionCard>
  );
}

function NotificationsPanel(props: {
  readonly items: DashboardData["notifications"];
  readonly limit: number;
  readonly pendingAction: ActionKey | null;
  readonly feedbackDraft: (path: string) => FeedbackDraft;
  readonly onDismiss: (id: string) => void;
  readonly onFeedbackChange: (path: string, draft: FeedbackDraft) => void;
  readonly onFeedbackSubmit: (path: string) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.items, props.limit);
  const notificationSendLabel = (sentMessageId: string | null): string => {
    if (isNotificationSendClaim(sentMessageId)) {
      return "送信処理中";
    }
    return sentMessageId ?? "未送信";
  };
  return (
    <SectionCard
      action={<CountBadge shown={shown.length} total={props.items.length} />}
      description="運営者通知の状態確認、dismiss、フィードバックを行います。"
      title="通知一覧"
    >
      <div className="grid gap-2">
        {props.items.length === 0 ? (
          <EmptyList description="通知はまだありません。" title="通知はありません" />
        ) : (
          shown.map((item) => {
            const path = `/api/notifications/${item.id}/feedback`;
            return (
              <div className="grid gap-3 rounded-lg border p-3" key={item.id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">{item.title}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge variant={badgeVariantForStatus(item.status)}>
                        {notificationStatusLabels[item.status]}
                      </Badge>
                      <Badge variant="outline">{item.importance}</Badge>
                      <span className="break-all text-xs text-muted-foreground">
                        {item.sentToChannelId} / {notificationSendLabel(item.sentMessageId)}
                      </span>
                    </div>
                    <p className="mt-2 break-words text-sm text-muted-foreground">
                      {item.failureReason ?? item.body}
                    </p>
                  </div>
                  <ConfirmAction
                    description="この通知を一覧上でdismissedにします。送信済みメッセージは削除しません。"
                    disabled={props.pendingAction !== null || item.status === "dismissed"}
                    label="非表示"
                    pending={props.pendingAction === "notification-dismiss"}
                    title="通知を非表示にしますか？"
                    variant="outline"
                    onConfirm={() => {
                      props.onDismiss(item.id);
                    }}
                  />
                </div>
                <FeedbackForm
                  disabled={props.pendingAction === "feedback"}
                  draft={props.feedbackDraft(path)}
                  onChange={(draft) => {
                    props.onFeedbackChange(path, draft);
                  }}
                  onSubmit={() => {
                    props.onFeedbackSubmit(path);
                  }}
                />
              </div>
            );
          })
        )}
        <ShowMore shown={shown.length} total={props.items.length} onShowMore={props.onShowMore} />
      </div>
    </SectionCard>
  );
}

function FaqPanel(props: {
  readonly items: DashboardData["faqCandidates"];
  readonly limit: number;
  readonly drafts: Record<string, Pick<FaqCandidate, "draftAnswer" | "draftQuestion" | "topic">>;
  readonly pendingAction: ActionKey | null;
  readonly feedbackDraft: (path: string) => FeedbackDraft;
  readonly onDraftChange: (
    id: string,
    draft: Pick<FaqCandidate, "draftAnswer" | "draftQuestion" | "topic">,
  ) => void;
  readonly onFeedbackChange: (path: string, draft: FeedbackDraft) => void;
  readonly onFeedbackSubmit: (path: string) => void;
  readonly onSave: (item: FaqCandidate) => void;
  readonly onStatus: (item: FaqCandidate, status: FaqCandidateStatus) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.items, props.limit);
  return (
    <SectionCard
      action={<CountBadge shown={shown.length} total={props.items.length} />}
      description="FAQ候補を編集し、採用、却下、要確認へ変更します。"
      title="FAQ候補"
    >
      <div className="grid gap-3">
        {props.items.length === 0 ? (
          <EmptyList description="FAQ候補はまだありません。" title="FAQ候補はありません" />
        ) : (
          shown.map((item) => {
            const draft = props.drafts[item.id] ?? {
              topic: item.topic,
              draftQuestion: item.draftQuestion,
              draftAnswer: item.draftAnswer,
            };
            const path = `/api/faq-candidates/${item.id}/feedback`;
            return (
              <div className="grid gap-3 rounded-lg border p-3" key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badgeVariantForStatus(item.status)}>
                    {faqStatusLabels[item.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    confidence {confidenceLabel(item.confidence)}
                  </span>
                </div>
                <TextField
                  label="トピック"
                  value={draft.topic}
                  onChange={(topic) => {
                    props.onDraftChange(item.id, { ...draft, topic });
                  }}
                />
                <TextAreaField
                  label="質問案"
                  value={draft.draftQuestion}
                  onChange={(draftQuestion) => {
                    props.onDraftChange(item.id, { ...draft, draftQuestion });
                  }}
                />
                <TextAreaField
                  label="回答案"
                  value={draft.draftAnswer}
                  onChange={(draftAnswer) => {
                    props.onDraftChange(item.id, { ...draft, draftAnswer });
                  }}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    disabled={props.pendingAction === "faq-save"}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      props.onSave(item);
                    }}
                  >
                    保存
                  </Button>
                  {allowedFaqStatusTransitions(item.status).map((status) => (
                    <ConfirmAction
                      description={`このFAQ候補を「${faqStatusLabels[status]}」に変更し、フィードバックも記録します。`}
                      disabled={props.pendingAction !== null}
                      key={status}
                      label={faqStatusLabels[status]}
                      pending={props.pendingAction === "faq-feedback"}
                      title="FAQ候補の状態を変更しますか？"
                      variant={status === "rejected" ? "destructive" : "outline"}
                      onConfirm={() => {
                        props.onStatus(item, status);
                      }}
                    />
                  ))}
                </div>
                <FeedbackForm
                  disabled={props.pendingAction === "feedback"}
                  draft={props.feedbackDraft(path)}
                  onChange={(nextDraft) => {
                    props.onFeedbackChange(path, nextDraft);
                  }}
                  onSubmit={() => {
                    props.onFeedbackSubmit(path);
                  }}
                />
              </div>
            );
          })
        )}
        <ShowMore shown={shown.length} total={props.items.length} onShowMore={props.onShowMore} />
      </div>
    </SectionCard>
  );
}

function ManualKnowledgePanel(props: {
  readonly items: DashboardData["manualKnowledge"];
  readonly limit: number;
  readonly drafts: Record<string, ManualKnowledgeDraft>;
  readonly createDraft: ManualKnowledgeDraft;
  readonly pendingAction: ActionKey | null;
  readonly onCreateDraftChange: (draft: ManualKnowledgeDraft) => void;
  readonly onDraftChange: (id: string, draft: ManualKnowledgeDraft) => void;
  readonly onCreate: () => void;
  readonly onSave: (item: ManualKnowledge) => void;
  readonly onReindex: (id: string) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.items, props.limit);
  const sourceOptions = manualKnowledgeSourceTypes.map((sourceType) => ({
    value: sourceType,
    label: manualKnowledgeSourceTypeLabels[sourceType],
  }));
  const statusOptions = manualKnowledgeStatuses.map((status) => ({
    value: status,
    label: manualKnowledgeStatusLabels[status],
  }));
  return (
    <SectionCard
      action={<CountBadge shown={shown.length} total={props.items.length} />}
      description="公式FAQ、Docs、チャンネル案内、定型回答を公式情報ソースとして管理します。"
      title="公式ナレッジ"
    >
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="font-medium">新規追加</div>
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="種別"
              options={sourceOptions}
              value={props.createDraft.sourceType}
              onChange={(sourceType) => {
                props.onCreateDraftChange({ ...props.createDraft, sourceType });
              }}
            />
            <SelectField
              label="状態"
              options={statusOptions}
              value={props.createDraft.status}
              onChange={(status) => {
                props.onCreateDraftChange({ ...props.createDraft, status });
              }}
            />
          </div>
          <TextField
            label="タイトル"
            value={props.createDraft.title}
            onChange={(title) => {
              props.onCreateDraftChange({ ...props.createDraft, title });
            }}
          />
          <TextAreaField
            label="本文"
            value={props.createDraft.body}
            onChange={(body) => {
              props.onCreateDraftChange({ ...props.createDraft, body });
            }}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="URL"
              value={props.createDraft.url}
              onChange={(url) => {
                props.onCreateDraftChange({ ...props.createDraft, url });
              }}
            />
            <TextAreaField
              description="1行に1タグずつ入力します。"
              label="タグ"
              value={props.createDraft.tags}
              onChange={(tags) => {
                props.onCreateDraftChange({ ...props.createDraft, tags });
              }}
            />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={
                props.pendingAction !== null ||
                props.createDraft.title.trim().length === 0 ||
                props.createDraft.body.trim().length === 0
              }
              size="sm"
              onClick={props.onCreate}
            >
              {props.pendingAction === "manual-knowledge-create" ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <PlusIcon />
              )}
              追加
            </Button>
          </div>
        </div>

        {props.items.length === 0 ? (
          <EmptyList
            description="公式ナレッジはまだありません。"
            title="公式ナレッジはありません"
          />
        ) : (
          shown.map((item) => {
            const draft = props.drafts[item.id] ?? manualKnowledgeDraftFromItem(item);
            return (
              <div className="grid gap-3 rounded-lg border p-3" key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={badgeVariantForStatus(item.status)}>
                    {manualKnowledgeStatusLabels[item.status]}
                  </Badge>
                  <Badge variant="outline">
                    {manualKnowledgeSourceTypeLabels[item.sourceType]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {item.embeddingError === null
                      ? item.embeddingUpdatedAt === null
                        ? "embedding未生成"
                        : `embedding更新 ${item.embeddingUpdatedAt.slice(0, 10)}`
                      : `embedding失敗: ${item.embeddingError}`}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <SelectField
                    label="種別"
                    options={sourceOptions}
                    value={draft.sourceType}
                    onChange={(sourceType) => {
                      props.onDraftChange(item.id, { ...draft, sourceType });
                    }}
                  />
                  <SelectField
                    label="状態"
                    options={statusOptions}
                    value={draft.status}
                    onChange={(status) => {
                      props.onDraftChange(item.id, { ...draft, status });
                    }}
                  />
                </div>
                <TextField
                  label="タイトル"
                  value={draft.title}
                  onChange={(title) => {
                    props.onDraftChange(item.id, { ...draft, title });
                  }}
                />
                <TextAreaField
                  label="本文"
                  value={draft.body}
                  onChange={(body) => {
                    props.onDraftChange(item.id, { ...draft, body });
                  }}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField
                    label="URL"
                    value={draft.url}
                    onChange={(url) => {
                      props.onDraftChange(item.id, { ...draft, url });
                    }}
                  />
                  <TextAreaField
                    description="1行に1タグずつ入力します。"
                    label="タグ"
                    value={draft.tags}
                    onChange={(tags) => {
                      props.onDraftChange(item.id, { ...draft, tags });
                    }}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    disabled={
                      props.pendingAction !== null ||
                      draft.title.trim().length === 0 ||
                      draft.body.trim().length === 0
                    }
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      props.onReindex(item.id);
                    }}
                  >
                    {props.pendingAction === "manual-knowledge-reindex" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : null}
                    再index
                  </Button>
                  <Button
                    disabled={
                      props.pendingAction !== null ||
                      draft.title.trim().length === 0 ||
                      draft.body.trim().length === 0
                    }
                    size="sm"
                    onClick={() => {
                      props.onSave(item);
                    }}
                  >
                    {props.pendingAction === "manual-knowledge-save" ? (
                      <Loader2Icon className="animate-spin" />
                    ) : null}
                    保存
                  </Button>
                </div>
              </div>
            );
          })
        )}
        <ShowMore shown={shown.length} total={props.items.length} onShowMore={props.onShowMore} />
      </div>
    </SectionCard>
  );
}

function AutoRepliesPanel(props: {
  readonly items: DashboardData["autoReplies"];
  readonly limit: number;
  readonly pendingAction: ActionKey | null;
  readonly feedbackDraft: (path: string) => FeedbackDraft;
  readonly onApprove: (id: string) => void;
  readonly onReject: (id: string) => void;
  readonly onFeedbackChange: (path: string, draft: FeedbackDraft) => void;
  readonly onFeedbackSubmit: (path: string) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.items, props.limit);
  return (
    <SectionCard
      action={<CountBadge shown={shown.length} total={props.items.length} />}
      description="自動返信の承認、却下、品質フィードバックを行います。"
      title="自動返信ログ"
    >
      <div className="grid gap-2">
        {props.items.length === 0 ? (
          <EmptyList
            description="自動返信ログはまだありません。"
            title="自動返信ログはありません"
          />
        ) : (
          shown.map((item) => {
            const path = `/api/auto-replies/${item.id}/feedback`;
            const canModerate = canModerateAutoReply(item.status);
            return (
              <div className="grid gap-3 rounded-lg border p-3" key={item.id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{autoReplyCategoryLabels[item.replyCategory]}</Badge>
                      <Badge variant={badgeVariantForStatus(item.status)}>
                        {autoReplyStatusLabels[item.status]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        confidence {confidenceLabel(item.confidence)} /{" "}
                        {item.sentMessageId ?? "未送信"}
                      </span>
                    </div>
                    <p className="mt-2 break-words text-sm">
                      {item.body.length > 0 ? item.body : item.decisionReason}
                    </p>
                  </div>
                  {canModerate ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <ConfirmAction
                        description="この自動返信を承認し、送信キューへ投入します。"
                        disabled={props.pendingAction !== null}
                        label="承認"
                        pending={props.pendingAction === "auto-reply-approve"}
                        title="自動返信を承認しますか？"
                        onConfirm={() => {
                          props.onApprove(item.id);
                        }}
                      />
                      <ConfirmAction
                        description="この自動返信を却下し、送信しない状態にします。"
                        disabled={props.pendingAction !== null}
                        label="却下"
                        pending={props.pendingAction === "auto-reply-reject"}
                        title="自動返信を却下しますか？"
                        variant="destructive"
                        onConfirm={() => {
                          props.onReject(item.id);
                        }}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      この状態では承認操作の対象外です。
                    </p>
                  )}
                </div>
                <FeedbackForm
                  disabled={props.pendingAction === "feedback"}
                  draft={props.feedbackDraft(path)}
                  onChange={(draft) => {
                    props.onFeedbackChange(path, draft);
                  }}
                  onSubmit={() => {
                    props.onFeedbackSubmit(path);
                  }}
                />
              </div>
            );
          })
        )}
        <ShowMore shown={shown.length} total={props.items.length} onShowMore={props.onShowMore} />
      </div>
    </SectionCard>
  );
}

function WeeklyReportsPanel(props: {
  readonly items: DashboardData["weeklyReports"];
  readonly limit: number;
  readonly feedbackDraft: (path: string) => FeedbackDraft;
  readonly onFeedbackChange: (path: string, draft: FeedbackDraft) => void;
  readonly onFeedbackSubmit: (path: string) => void;
  readonly onShowMore: () => void;
}) {
  const shown = itemLimit(props.items, props.limit);
  return (
    <SectionCard
      action={<CountBadge shown={shown.length} total={props.items.length} />}
      description="週次レポートの短い版、メトリクス、詳細版を確認します。"
      title="週次レポート"
    >
      <div className="grid gap-3">
        {props.items.length === 0 ? (
          <EmptyList
            description="週次レポートはまだありません。"
            title="週次レポートはありません"
          />
        ) : (
          shown.map((item) => {
            const path = `/api/reports/weekly/${item.id}/feedback`;
            return (
              <div className="grid gap-3 rounded-lg border p-3" key={item.id}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-medium">
                      {item.periodStart} - {item.periodEnd}
                    </div>
                    <Badge className="mt-2" variant={badgeVariantForStatus(item.status)}>
                      {weeklyReportStatusLabels[item.status]}
                    </Badge>
                  </div>
                  <FeedbackForm
                    draft={props.feedbackDraft(path)}
                    onChange={(draft) => {
                      props.onFeedbackChange(path, draft);
                    }}
                    onSubmit={() => {
                      props.onFeedbackSubmit(path);
                    }}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard label="投稿" value={item.messageCount} />
                  <MetricCard label="未回答質問" value={item.metrics.unansweredQuestionCount} />
                  <MetricCard label="不具合" value={item.metrics.bugReportCount} />
                  <MetricCard label="不満" value={item.metrics.complaintCount} />
                </div>
                <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">
                  {item.shortBody}
                </pre>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">詳細版</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">
                    {item.detailedBody}
                  </pre>
                </details>
              </div>
            );
          })
        )}
        <ShowMore shown={shown.length} total={props.items.length} onShowMore={props.onShowMore} />
      </div>
    </SectionCard>
  );
}

function DirtyBadge(props: { readonly dirty: boolean }) {
  return props.dirty ? (
    <Badge variant="secondary">未保存の変更あり</Badge>
  ) : (
    <Badge variant="outline">保存済み</Badge>
  );
}

function ShowMore(props: {
  readonly shown: number;
  readonly total: number;
  readonly onShowMore: () => void;
}) {
  if (props.shown >= props.total) return null;
  return (
    <Button className="mt-2 w-full" variant="outline" onClick={props.onShowMore}>
      <ChevronsUpDownIcon />
      続きを見る
    </Button>
  );
}

function autoReplyModeLabel(mode: string): string {
  switch (mode) {
    case "disabled":
      return "無効";
    case "intake_only":
      return "受付のみ";
    case "faq_assist":
      return "FAQ補助";
    case "approval_required":
      return "承認必須";
    default:
      return mode;
  }
}
