import { useEffect, useState } from "react";

type Counts = {
  readonly messages: number;
  readonly classifications: number;
  readonly notifications: number;
  readonly faqCandidates: number;
  readonly autoReplies: number;
  readonly weeklyReports: number;
};

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
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} failed`);
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed`);
  }
  return (await response.json()) as T;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [policy, setPolicy] = useState<AutoReplyPolicy | null>(null);
  const [counts, setCounts] = useState<Counts>({
    messages: 0,
    classifications: 0,
    notifications: 0,
    faqCandidates: 0,
    autoReplies: 0,
    weeklyReports: 0,
  });
  const [latestReport, setLatestReport] = useState<string>("週次レポートは未生成です。");

  async function refresh() {
    const [
      nextSettings,
      nextPolicy,
      messages,
      classifications,
      notifications,
      faqCandidates,
      autoReplies,
      weeklyReports,
    ] = await Promise.all([
      getJson<Settings>("/api/settings"),
      getJson<AutoReplyPolicy>("/api/auto-reply/policy"),
      getJson<readonly unknown[]>("/api/messages"),
      getJson<readonly unknown[]>("/api/classifications"),
      getJson<readonly unknown[]>("/api/notifications"),
      getJson<readonly unknown[]>("/api/faq-candidates"),
      getJson<readonly unknown[]>("/api/auto-replies"),
      getJson<readonly { readonly shortBody: string }[]>("/api/reports/weekly"),
    ]);
    setSettings(nextSettings);
    setPolicy(nextPolicy);
    setCounts({
      messages: messages.length,
      classifications: classifications.length,
      notifications: notifications.length,
      faqCandidates: faqCandidates.length,
      autoReplies: autoReplies.length,
      weeklyReports: weeklyReports.length,
    });
    setLatestReport(weeklyReports[0]?.shortBody ?? "週次レポートは未生成です。");
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function importSample() {
    await postJson("/api/import/sample-log", {});
    await refresh();
  }

  async function generateReport() {
    const report = await postJson<{ readonly shortBody: string }>("/api/reports/weekly", {
      periodStart: "2026-01-01",
      periodEnd: "2026-01-07",
    });
    setLatestReport(report.shortBody);
    await refresh();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dogfood Alpha</p>
          <h1>curacuri.ai 管理画面</h1>
        </div>
        <div className="actions">
          <button type="button" onClick={() => void importSample()}>
            サンプル投入
          </button>
          <button type="button" onClick={() => void generateReport()}>
            週次レポート生成
          </button>
        </div>
      </header>

      <section className="metrics" aria-label="運営メトリクス">
        <Metric label="投稿" value={counts.messages} />
        <Metric label="分類" value={counts.classifications} />
        <Metric label="通知候補" value={counts.notifications} />
        <Metric label="FAQ候補" value={counts.faqCandidates} />
        <Metric label="自動返信ログ" value={counts.autoReplies} />
        <Metric label="週次レポート" value={counts.weeklyReports} />
      </section>

      <section className="grid">
        <article>
          <h2>対象設定</h2>
          <dl>
            <dt>対象チャンネル</dt>
            <dd>{settings?.targetChannelIds.join(", ") ?? "読み込み中"}</dd>
            <dt>対象外チャンネル</dt>
            <dd>
              {settings === null || settings.excludedChannelIds.length === 0
                ? "なし"
                : settings.excludedChannelIds.join(", ")}
            </dd>
            <dt>管理者通知</dt>
            <dd>{settings?.adminNotificationChannelId ?? "読み込み中"}</dd>
            <dt>保存期間</dt>
            <dd>{settings?.retentionDays ?? "-"}日</dd>
            <dt>キャラクター</dt>
            <dd>
              {settings?.characterName ?? "-"} / {settings?.characterTone ?? "-"}
            </dd>
          </dl>
        </article>

        <article>
          <h2>自動返信</h2>
          <dl>
            <dt>状態</dt>
            <dd>{policy?.enabled === true ? "ON" : "OFF"}</dd>
            <dt>モード</dt>
            <dd>{policy?.mode ?? "-"}</dd>
            <dt>許可チャンネル</dt>
            <dd>{policy?.allowedChannelIds.join(", ") ?? "-"}</dd>
            <dt>許可ラベル</dt>
            <dd>{policy?.allowedLabels.join(", ") ?? "-"}</dd>
            <dt>最小confidence</dt>
            <dd>{policy?.minConfidence ?? "-"}</dd>
          </dl>
        </article>
      </section>

      <section className="report">
        <h2>週次レポート短い版</h2>
        <pre>{latestReport}</pre>
      </section>

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
