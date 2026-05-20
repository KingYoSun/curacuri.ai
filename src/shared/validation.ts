import {
  adminActionTypes,
  classificationLabels,
  importances,
  type AdminActionType,
  type Classification,
  type ClassificationLabel,
  type Importance,
} from "./types.js";

type ClassificationJson = {
  readonly labels: readonly ClassificationLabel[];
  readonly importance: Importance;
  readonly admin_action_needed: boolean;
  readonly admin_action_type: AdminActionType;
  readonly confidence: number;
  readonly reason: string;
  readonly suggested_summary: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(value: unknown, candidates: T): value is T[number] {
  return typeof value === "string" && candidates.includes(value);
}

function readClassificationJson(value: unknown): ClassificationJson {
  if (!isRecord(value)) {
    throw new Error("classification output must be an object");
  }

  const labelsValue = value.labels;
  if (!Array.isArray(labelsValue) || labelsValue.length === 0) {
    throw new Error("labels must be a non-empty array");
  }

  const labels = labelsValue.map((label) => {
    if (!isOneOf(label, classificationLabels)) {
      throw new Error(`unsupported classification label: ${String(label)}`);
    }
    return label;
  });

  const importanceValue = value.importance;
  if (!isOneOf(importanceValue, importances)) {
    throw new Error(`unsupported importance: ${String(importanceValue)}`);
  }

  const actionTypeValue = value.admin_action_type;
  if (!isOneOf(actionTypeValue, adminActionTypes)) {
    throw new Error(`unsupported admin_action_type: ${String(actionTypeValue)}`);
  }

  const adminActionNeeded = value.admin_action_needed;
  if (typeof adminActionNeeded !== "boolean") {
    throw new Error("admin_action_needed must be boolean");
  }

  const confidence = value.confidence;
  if (
    typeof confidence !== "number" ||
    Number.isNaN(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error("confidence must be a number between 0 and 1");
  }

  const reason = value.reason;
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("reason must be a non-empty string");
  }

  const summary = value.suggested_summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("suggested_summary must be a non-empty string");
  }

  return {
    labels,
    importance: importanceValue,
    admin_action_needed: adminActionNeeded,
    admin_action_type: actionTypeValue,
    confidence,
    reason,
    suggested_summary: summary,
  };
}

export function parseClassificationOutputJson(text: string): ClassificationJson {
  const parsed: unknown = JSON.parse(text);
  return readClassificationJson(parsed);
}

export function buildClassification(
  value: unknown,
  fields: {
    readonly id: string;
    readonly messageId: string;
    readonly modelName: string;
    readonly createdAt: string;
  },
): Classification {
  const parsed = readClassificationJson(value);
  return {
    id: fields.id,
    messageId: fields.messageId,
    labels: parsed.labels,
    importance: parsed.importance,
    adminActionNeeded: parsed.admin_action_needed,
    adminActionType: parsed.admin_action_type,
    confidence: parsed.confidence,
    reason: parsed.reason,
    suggestedSummary: parsed.suggested_summary,
    modelName: fields.modelName,
    rawOutput: isRecord(value) ? value : {},
    createdAt: fields.createdAt,
  };
}
