import type {
  DashboardData,
  FeedbackDraft,
  LlmRun,
  LlmStatus,
  MessageFilters,
  Policy,
  Settings,
} from "./types.js";
import type {
  AdminNotification,
  AutoReply,
  Classification,
  FaqCandidate,
  FaqCandidateStatus,
  Message,
  WeeklyReport,
} from "../shared/types.js";

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await errorMessage(response, path));
  return (await response.json()) as T;
}

export async function sendJson<T>(
  method: "PATCH" | "POST" | "PUT",
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await errorMessage(response, path));
  return (await response.json()) as T;
}

async function errorMessage(response: Response, path: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return `${path} failed (${String(response.status)})`;
}

function queryFromFilters(filters: MessageFilters): string {
  const params = new URLSearchParams();
  if (filters.periodStart.length > 0) params.set("periodStart", filters.periodStart);
  if (filters.periodEnd.length > 0) params.set("periodEnd", filters.periodEnd);
  if (filters.channelId.length > 0) params.set("channelId", filters.channelId);
  if (filters.label.length > 0) params.set("label", filters.label);
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

export async function loadDashboardData(filters: MessageFilters): Promise<DashboardData> {
  const [
    settings,
    policy,
    messages,
    classifications,
    notifications,
    faqCandidates,
    autoReplies,
    weeklyReports,
    llmStatus,
    failedRuns,
  ] = await Promise.all([
    getJson<Settings>("/api/settings"),
    getJson<Policy>("/api/auto-reply/policy"),
    getJson<readonly Message[]>(`/api/messages${queryFromFilters(filters)}`),
    getJson<readonly Classification[]>("/api/classifications"),
    getJson<readonly AdminNotification[]>("/api/notifications"),
    getJson<readonly FaqCandidate[]>("/api/faq-candidates"),
    getJson<readonly AutoReply[]>("/api/auto-replies"),
    getJson<readonly WeeklyReport[]>("/api/reports/weekly"),
    getJson<LlmStatus>("/api/llm/status"),
    getJson<readonly LlmRun[]>("/api/llm/runs?status=failed"),
  ]);
  return {
    settings,
    policy,
    messages,
    classifications,
    notifications,
    faqCandidates,
    autoReplies,
    weeklyReports,
    llmStatus,
    failedRuns,
  };
}

export function postFeedback(path: string, draft: FeedbackDraft): Promise<unknown> {
  return sendJson("POST", path, draft);
}

export function patchFaqCandidate(
  id: string,
  body: {
    readonly topic?: string;
    readonly draftQuestion?: string;
    readonly draftAnswer?: string;
    readonly status?: FaqCandidateStatus;
  },
): Promise<FaqCandidate> {
  return sendJson("PATCH", `/api/faq-candidates/${id}`, body);
}
