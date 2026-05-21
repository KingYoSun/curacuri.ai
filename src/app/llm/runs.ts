import { newId, nowIso } from "../ids.js";
import { type LlmGenerationRun, type LlmRunStatus, type LlmTaskType } from "../../shared/types.js";
import { LlmError } from "./client.js";

export function startLlmRun(
  taskType: LlmTaskType,
  targetId: string,
  modelName: string,
): LlmGenerationRun {
  const now = nowIso();
  const run: LlmGenerationRun = {
    id: newId(),
    taskType,
    targetId,
    status: "running",
    modelName,
    errorCode: null,
    errorMessage: null,
    rawOutput: null,
    createdAt: now,
    updatedAt: now,
  };
  return run;
}

export function finishLlmRun(
  run: LlmGenerationRun,
  rawOutput: Record<string, unknown>,
): LlmGenerationRun {
  return updateLlmRun(run, "succeeded", null, null, rawOutput);
}

export function failLlmRun(run: LlmGenerationRun, error: unknown): LlmGenerationRun {
  if (error instanceof LlmError) {
    return updateLlmRun(run, "failed", error.code, error.message, error.rawOutput);
  }
  if (error instanceof Error) {
    return updateLlmRun(run, "failed", "llm_error", error.message, null);
  }
  return updateLlmRun(run, "failed", "llm_error", String(error), null);
}

function updateLlmRun(
  run: LlmGenerationRun,
  status: LlmRunStatus,
  errorCode: string | null,
  errorMessage: string | null,
  rawOutput: Record<string, unknown> | null,
): LlmGenerationRun {
  const next: LlmGenerationRun = {
    ...run,
    status,
    errorCode,
    errorMessage,
    rawOutput,
    updatedAt: nowIso(),
  };
  return next;
}
