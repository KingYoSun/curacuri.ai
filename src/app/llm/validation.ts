import {
  autoReplyCategories,
  type AutoReplyCategory,
  type CurrentAnswerStatus,
  type FaqCandidateStatus,
  type SourceRef,
} from "../../shared/types.js";
import { LlmError } from "./client.js";

export const llmAutoReplyDecisions = [
  "do_not_reply",
  "send",
  "pending_approval",
  "escalate",
] as const;

export type LlmAutoReplyDecision = (typeof llmAutoReplyDecisions)[number];

export type LlmAutoReplyOutput = {
  readonly decision: LlmAutoReplyDecision;
  readonly replyCategory: AutoReplyCategory | "escalate" | "do_not_reply";
  readonly body: string;
  readonly sourceRefIds: readonly string[];
  readonly confidence: number;
  readonly reason: string;
  readonly escalationReason: string;
};

export type LlmFaqCandidateOutput = {
  readonly sourceMessageIds: readonly string[];
  readonly topic: string;
  readonly currentAnswerStatus: CurrentAnswerStatus;
  readonly draftQuestion: string;
  readonly draftAnswer: string;
  readonly confidence: number;
  readonly status: FaqCandidateStatus;
};

export type LlmWeeklyReportOutput = {
  readonly shortBody: string;
  readonly detailedBody: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  source: Record<string, unknown>,
  key: string,
  rawOutput: Record<string, unknown>,
): string {
  const value = source[key];
  if (typeof value !== "string") {
    throw new LlmError("invalid_output_schema", `${key} must be string`, rawOutput);
  }
  return value;
}

function numberField(
  source: Record<string, unknown>,
  key: string,
  rawOutput: Record<string, unknown>,
): number {
  const value = source[key];
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new LlmError("invalid_output_schema", `${key} must be number between 0 and 1`, rawOutput);
  }
  return value;
}

function stringArrayField(
  source: Record<string, unknown>,
  key: string,
  rawOutput: Record<string, unknown>,
): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new LlmError("invalid_output_schema", `${key} must be string[]`, rawOutput);
  }
  return value;
}

function oneOf<T extends readonly string[]>(
  value: string,
  candidates: T,
  fieldName: string,
  rawOutput: Record<string, unknown>,
): T[number] {
  if (!candidates.includes(value)) {
    throw new LlmError(
      "invalid_output_schema",
      `${fieldName} has unsupported value: ${value}`,
      rawOutput,
    );
  }
  return value;
}

export function parseLlmAutoReplyOutput(rawOutput: Record<string, unknown>): LlmAutoReplyOutput {
  const decision = oneOf(
    stringField(rawOutput, "decision", rawOutput),
    llmAutoReplyDecisions,
    "decision",
    rawOutput,
  );
  const rawCategory = stringField(rawOutput, "reply_category", rawOutput);
  const replyCategory =
    rawCategory === "escalate" || rawCategory === "do_not_reply"
      ? rawCategory
      : oneOf(rawCategory, autoReplyCategories, "reply_category", rawOutput);

  return {
    decision,
    replyCategory,
    body: stringField(rawOutput, "body", rawOutput),
    sourceRefIds: stringArrayField(rawOutput, "source_ref_ids", rawOutput),
    confidence: numberField(rawOutput, "confidence", rawOutput),
    reason: stringField(rawOutput, "reason", rawOutput),
    escalationReason: stringField(rawOutput, "escalation_reason", rawOutput),
  };
}

const currentAnswerStatuses = [
  "unknown",
  "answered_in_thread",
  "needs_official_answer",
  "existing_faq_possible",
] as const;

const faqCandidateStatuses = ["candidate", "accepted", "rejected", "needs_review"] as const;

export function parseLlmFaqCandidatesOutput(
  rawOutput: Record<string, unknown>,
): readonly LlmFaqCandidateOutput[] {
  const candidatesValue = rawOutput.candidates;
  if (!Array.isArray(candidatesValue)) {
    throw new LlmError("invalid_output_schema", "candidates must be array", rawOutput);
  }

  return candidatesValue.map((candidateValue) => {
    if (!isRecord(candidateValue)) {
      throw new LlmError("invalid_output_schema", "candidate must be object", rawOutput);
    }
    return {
      sourceMessageIds: stringArrayField(candidateValue, "source_message_ids", rawOutput),
      topic: stringField(candidateValue, "topic", rawOutput),
      currentAnswerStatus: oneOf(
        stringField(candidateValue, "current_answer_status", rawOutput),
        currentAnswerStatuses,
        "current_answer_status",
        rawOutput,
      ),
      draftQuestion: stringField(candidateValue, "draft_question", rawOutput),
      draftAnswer: stringField(candidateValue, "draft_answer", rawOutput),
      confidence: numberField(candidateValue, "confidence", rawOutput),
      status: oneOf(
        stringField(candidateValue, "status", rawOutput),
        faqCandidateStatuses,
        "status",
        rawOutput,
      ),
    };
  });
}

export function parseLlmWeeklyReportOutput(
  rawOutput: Record<string, unknown>,
): LlmWeeklyReportOutput {
  return {
    shortBody: stringField(rawOutput, "short_body", rawOutput),
    detailedBody: stringField(rawOutput, "detailed_body", rawOutput),
  };
}

export function sourceRefsByIds(
  refs: readonly SourceRef[],
  ids: readonly string[],
): readonly SourceRef[] {
  return refs.filter(
    (ref, index) => ids.includes(ref.url ?? ref.title) || ids.includes(String(index)),
  );
}
