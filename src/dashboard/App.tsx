import type React from "react";
import { useEffect, useState } from "react";

type Settings = {
  readonly targetChannelIds: readonly string[];
  readonly excludedChannelIds: readonly string[];
  readonly adminNotificationChannelId: string;
  readonly retentionDays: number;
  readonly characterName: string;
  readonly characterTone: string;
};

type AutoReplyPolicy = {
  readonly enabled: boolean;
  readonly mode: string;
  readonly allowedChannelIds: readonly string[];
  readonly allowedLabels: readonly string[];
  readonly allowedCategories: readonly string[];
  readonly minConfidence: number;
  readonly requireSourceForFaq: boolean;
};

type LlmStatus = {
  readonly configured: boolean;
  readonly modelName: string;
  readonly baseUrl: string;
  readonly concurrency: number;
  readonly responseFormat: string;
  readonly failedCount: number;
};

type LlmRun = {
  readonly id: string;
  readonly taskType: string;
  readonly targetId: string;
  readonly status: string;
  readonly modelName: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
};

type NotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly importance: string;
  readonly status: string;
  readonly sentToChannelId: string;
  readonly sentMessageId: string | null;
  readonly failureReason: string | null;
};

type FaqCandidate = {
  readonly id: string;
  readonly topic: string;
  readonly draftQuestion: string;
  readonly draftAnswer: string;
  readonly status: string;
  readonly confidence: number;
};

type AutoReply = {
  readonly id: string;
  readonly body: string;
  readonly status: string;
  readonly replyCategory: string;
  readonly confidence: number;
  readonly decisionReason: string;
  readonly sentMessageId: string | null;
};

type WeeklyReport = {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly shortBody: string;
  readonly detailedBody: string;
  readonly status: string;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} failed`);
  return (await response.json()) as T;
}

async function sendJson<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} failed`);
  return (await response.json()) as T;
}

function lines(value: readonly string[]): string {
  return value.join("\n");
}

function parseLines(value: string): readonly string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function App() {
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [failedRuns, setFailedRuns] = useState<readonly LlmRun[]>([]);
  const [notifications, setNotifications] = useState<readonly NotificationItem[]>([]);
  const [faqCandidates, setFaqCandidates] = useState<readonly FaqCandidate[]>([]);
  const [autoReplies, setAutoReplies] = useState<readonly AutoReply[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<readonly WeeklyReport[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [classificationCount, setClassificationCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    targetChannelIds: "",
    excludedChannelIds: "",
    adminNotificationChannelId: "",
    retentionDays: 90,
    characterName: "",
    characterTone: "",
  });
  const [policyDraft, setPolicyDraft] = useState({
    enabled: false,
    mode: "disabled",
    allowedChannelIds: "",
    allowedLabels: "",
    allowedCategories: "",
    minConfidence: 0.8,
    requireSourceForFaq: true,
  });

  async function refresh() {
    const [
      nextSettings,
      nextPolicy,
      messages,
      classifications,
      nextNotifications,
      nextFaqCandidates,
      nextAutoReplies,
      nextWeeklyReports,
      nextLlmStatus,
      nextFailedRuns,
    ] = await Promise.all([
      getJson<Settings>("/api/settings"),
      getJson<AutoReplyPolicy>("/api/auto-reply/policy"),
      getJson<readonly unknown[]>("/api/messages"),
      getJson<readonly unknown[]>("/api/classifications"),
      getJson<readonly NotificationItem[]>("/api/notifications"),
      getJson<readonly FaqCandidate[]>("/api/faq-candidates"),
      getJson<readonly AutoReply[]>("/api/auto-replies"),
      getJson<readonly WeeklyReport[]>("/api/reports/weekly"),
      getJson<LlmStatus>("/api/llm/status"),
      getJson<readonly LlmRun[]>("/api/llm/runs?status=failed"),
    ]);
    setNotifications(nextNotifications);
    setFaqCandidates(nextFaqCandidates);
    setAutoReplies(nextAutoReplies);
    setWeeklyReports(nextWeeklyReports);
    setLlmStatus(nextLlmStatus);
    setFailedRuns(nextFailedRuns);
    setMessageCount(messages.length);
    setClassificationCount(classifications.length);
    setSettingsDraft({
      targetChannelIds: lines(nextSettings.targetChannelIds),
      excludedChannelIds: lines(nextSettings.excludedChannelIds),
      adminNotificationChannelId: nextSettings.adminNotificationChannelId,
      retentionDays: nextSettings.retentionDays,
      characterName: nextSettings.characterName,
      characterTone: nextSettings.characterTone,
    });
    setPolicyDraft({
      enabled: nextPolicy.enabled,
      mode: nextPolicy.mode,
      allowedChannelIds: lines(nextPolicy.allowedChannelIds),
      allowedLabels: lines(nextPolicy.allowedLabels),
      allowedCategories: lines(nextPolicy.allowedCategories),
      minConfidence: nextPolicy.minConfidence,
      requireSourceForFaq: nextPolicy.requireSourceForFaq,
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function runAction(action: () => Promise<void>) {
    try {
      setActionError(null);
      await action();
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      await refresh().catch(() => undefined);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dogfood Alpha</p>
          <h1>curacuri.ai 管理画面</h1>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={() =>
              void runAction(() =>
                sendJson("POST", "/api/import/sample-log", {}).then(() => undefined),
              )
            }
          >
            サンプル投入
          </button>
          <button
            type="button"
            onClick={() =>
              void runAction(() =>
                sendJson("POST", "/api/reports/weekly", {
                  periodStart: "2026-01-01",
                  periodEnd: "2026-01-07",
                }).then(() => undefined),
              )
            }
          >
            週次レポート生成
          </button>
          <button
            type="button"
            onClick={() =>
              void runAction(() =>
                sendJson("POST", "/api/llm/reprocess", { scope: "all" }).then(() => undefined),
              )
            }
          >
            LLM一括再実行
          </button>
        </div>
      </header>

      {actionError === null ? null : <p className="error-line">{actionError}</p>}

      <section className="metrics" aria-label="運営メトリクス">
        <Metric label="投稿" value={messageCount} />
        <Metric label="分類" value={classificationCount} />
        <Metric label="通知候補" value={notifications.length} />
        <Metric label="FAQ候補" value={faqCandidates.length} />
        <Metric label="自動返信ログ" value={autoReplies.length} />
        <Metric label="週次レポート" value={weeklyReports.length} />
      </section>

      <section className="grid">
        <article>
          <h2>対象設定</h2>
          <FormTextArea
            label="対象チャンネル"
            value={settingsDraft.targetChannelIds}
            onChange={(value) => {
              setSettingsDraft({ ...settingsDraft, targetChannelIds: value });
            }}
          />
          <FormTextArea
            label="対象外チャンネル"
            value={settingsDraft.excludedChannelIds}
            onChange={(value) => {
              setSettingsDraft({ ...settingsDraft, excludedChannelIds: value });
            }}
          />
          <FormInput
            label="管理者通知チャンネル"
            value={settingsDraft.adminNotificationChannelId}
            onChange={(value) => {
              setSettingsDraft({ ...settingsDraft, adminNotificationChannelId: value });
            }}
          />
          <FormInput
            label="保存期間（日）"
            type="number"
            value={String(settingsDraft.retentionDays)}
            onChange={(value) => {
              setSettingsDraft({ ...settingsDraft, retentionDays: Number.parseInt(value, 10) });
            }}
          />
          <FormInput
            label="キャラクター名"
            value={settingsDraft.characterName}
            onChange={(value) => {
              setSettingsDraft({ ...settingsDraft, characterName: value });
            }}
          />
          <FormInput
            label="口調"
            value={settingsDraft.characterTone}
            onChange={(value) => {
              setSettingsDraft({ ...settingsDraft, characterTone: value });
            }}
          />
          <button
            type="button"
            onClick={() =>
              void runAction(() =>
                sendJson("PUT", "/api/settings", {
                  targetChannelIds: parseLines(settingsDraft.targetChannelIds),
                  excludedChannelIds: parseLines(settingsDraft.excludedChannelIds),
                  adminNotificationChannelId: settingsDraft.adminNotificationChannelId,
                  retentionDays: settingsDraft.retentionDays,
                  characterName: settingsDraft.characterName,
                  characterTone: settingsDraft.characterTone,
                }).then(() => undefined),
              )
            }
          >
            設定を保存
          </button>
        </article>

        <article>
          <h2>自動返信ポリシー</h2>
          <label className="field inline-field">
            <input
              checked={policyDraft.enabled}
              type="checkbox"
              onChange={(event) => {
                setPolicyDraft({ ...policyDraft, enabled: event.target.checked });
              }}
            />
            自動返信を有効にする
          </label>
          <label className="field">
            <span>モード</span>
            <select
              value={policyDraft.mode}
              onChange={(event) => {
                setPolicyDraft({ ...policyDraft, mode: event.target.value });
              }}
            >
              <option value="disabled">disabled</option>
              <option value="intake_only">intake_only</option>
              <option value="faq_assist">faq_assist</option>
              <option value="approval_required">approval_required</option>
            </select>
          </label>
          <FormTextArea
            label="許可チャンネル"
            value={policyDraft.allowedChannelIds}
            onChange={(value) => {
              setPolicyDraft({ ...policyDraft, allowedChannelIds: value });
            }}
          />
          <FormTextArea
            label="許可ラベル"
            value={policyDraft.allowedLabels}
            onChange={(value) => {
              setPolicyDraft({ ...policyDraft, allowedLabels: value });
            }}
          />
          <FormTextArea
            label="許可カテゴリ"
            value={policyDraft.allowedCategories}
            onChange={(value) => {
              setPolicyDraft({ ...policyDraft, allowedCategories: value });
            }}
          />
          <FormInput
            label="最小confidence"
            type="number"
            value={String(policyDraft.minConfidence)}
            onChange={(value) => {
              setPolicyDraft({ ...policyDraft, minConfidence: Number.parseFloat(value) });
            }}
          />
          <label className="field inline-field">
            <input
              checked={policyDraft.requireSourceForFaq}
              type="checkbox"
              onChange={(event) => {
                setPolicyDraft({ ...policyDraft, requireSourceForFaq: event.target.checked });
              }}
            />
            FAQ参照元を必須にする
          </label>
          <button
            type="button"
            onClick={() =>
              void runAction(() =>
                sendJson("PUT", "/api/auto-reply/policy", {
                  enabled: policyDraft.enabled,
                  mode: policyDraft.mode,
                  allowedChannelIds: parseLines(policyDraft.allowedChannelIds),
                  allowedLabels: parseLines(policyDraft.allowedLabels),
                  allowedCategories: parseLines(policyDraft.allowedCategories),
                  minConfidence: policyDraft.minConfidence,
                  requireSourceForFaq: policyDraft.requireSourceForFaq,
                }).then(() => undefined),
              )
            }
          >
            ポリシーを保存
          </button>
        </article>

        <article>
          <h2>LLM接続</h2>
          <dl>
            <dt>状態</dt>
            <dd>{llmStatus?.configured === true ? "設定済み" : "未設定"}</dd>
            <dt>モデル</dt>
            <dd>{llmStatus?.modelName ?? "-"}</dd>
            <dt>Base URL</dt>
            <dd>{llmStatus?.baseUrl ?? "-"}</dd>
            <dt>JSON方式</dt>
            <dd>{llmStatus?.responseFormat ?? "-"}</dd>
            <dt>同時実行</dt>
            <dd>{llmStatus?.concurrency ?? "-"}</dd>
            <dt>失敗run</dt>
            <dd>{llmStatus?.failedCount ?? 0}件</dd>
          </dl>
        </article>

        <article>
          <h2>LLM失敗run</h2>
          <div className="stack">
            {failedRuns.length === 0 ? <p>失敗中のLLM生成はありません。</p> : null}
            {failedRuns.slice(0, 8).map((run) => (
              <div className="row" key={run.id}>
                <div>
                  <strong>{run.taskType}</strong>
                  <span>{run.targetId}</span>
                  <p>{run.errorMessage ?? run.errorCode ?? "詳細なし"}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void runAction(() =>
                      sendJson("POST", `/api/llm/runs/${run.id}/retry`, {}).then(() => undefined),
                    )
                  }
                >
                  再実行
                </button>
              </div>
            ))}
          </div>
        </article>
      </section>

      <Section title="通知一覧">
        {notifications.slice(0, 12).map((item) => (
          <div className="row" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.status} / {item.sentToChannelId} / {item.sentMessageId ?? "未送信"}
              </span>
              <p>{item.failureReason ?? item.body}</p>
            </div>
            <FeedbackButton path={`/api/notifications/${item.id}/feedback`} onDone={refresh} />
          </div>
        ))}
      </Section>

      <Section title="FAQ候補">
        {faqCandidates.slice(0, 12).map((item) => (
          <div className="row" key={item.id}>
            <div>
              <strong>{item.topic}</strong>
              <span>
                {item.status} / confidence {item.confidence}
              </span>
              <p>{item.draftQuestion}</p>
              <p>{item.draftAnswer}</p>
            </div>
            <div className="button-stack">
              {["accepted", "rejected", "needs_review"].map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() =>
                    void runAction(() =>
                      sendJson("POST", `/api/faq-candidates/${item.id}/feedback`, {
                        status,
                        feedbackKind: status === "accepted" ? "useful" : "unnecessary",
                      }).then(() => undefined),
                    )
                  }
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="自動返信ログ">
        {autoReplies.slice(0, 12).map((item) => (
          <div className="row" key={item.id}>
            <div>
              <strong>{item.replyCategory}</strong>
              <span>
                {item.status} / confidence {item.confidence} / {item.sentMessageId ?? "未送信"}
              </span>
              <p>{item.body || item.decisionReason}</p>
            </div>
            <div className="button-stack">
              <button
                type="button"
                onClick={() =>
                  void runAction(() =>
                    sendJson("POST", `/api/auto-replies/${item.id}/approve`, {}).then(
                      () => undefined,
                    ),
                  )
                }
              >
                承認
              </button>
              <button
                type="button"
                onClick={() =>
                  void runAction(() =>
                    sendJson("POST", `/api/auto-replies/${item.id}/reject`, {}).then(
                      () => undefined,
                    ),
                  )
                }
              >
                却下
              </button>
              <FeedbackButton path={`/api/auto-replies/${item.id}/feedback`} onDone={refresh} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="週次レポート">
        {weeklyReports.slice(0, 4).map((item) => (
          <div className="report-item" key={item.id}>
            <div className="row">
              <div>
                <strong>
                  {item.periodStart} - {item.periodEnd}
                </strong>
                <span>{item.status}</span>
              </div>
              <FeedbackButton path={`/api/reports/weekly/${item.id}/feedback`} onDone={refresh} />
            </div>
            <pre>{item.shortBody}</pre>
            <details>
              <summary>詳細版</summary>
              <pre>{item.detailedBody}</pre>
            </details>
          </div>
        ))}
      </Section>

      <section className="notice">
        <h2>導入告知テンプレート</h2>
        <p>
          指定された公開チャンネルの投稿だけを対象にし、DMは読みません。
          ユーザーを評価、採点、自動処分せず、質問、要望、不具合報告、不満を運営が見落とさないために整理します。
          自動返信はAIキャラクターの補助回答であり、公式判断が必要なものは運営者確認に回します。
        </p>
      </section>
    </main>
  );
}

function Metric(props: { readonly label: string; readonly value: number }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Section(props: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="report">
      <h2>{props.title}</h2>
      <div className="stack">{props.children}</div>
    </section>
  );
}

function FormInput(props: {
  readonly label: string;
  readonly value: string;
  readonly type?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
    </label>
  );
}

function FormTextArea(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
    </label>
  );
}

function FeedbackButton(props: { readonly path: string; readonly onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  return (
    <div className="feedback-box">
      <input
        value={note}
        placeholder="feedback"
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() =>
          void sendJson("POST", props.path, { feedbackKind: "useful", note }).then(props.onDone)
        }
      >
        feedback
      </button>
    </div>
  );
}
