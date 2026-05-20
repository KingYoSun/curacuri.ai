import { newId, nowIso } from "../ids.js";
import type { Phase1State } from "../store.js";
import { type LlmGenerationRun, type LlmRunStatus, type LlmTaskType } from "../../shared/types.js";
import { LlmError } from "./client.js";

export function startLlmRun(
  state: Phase1State,
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
  state.llmGenerationRuns.set(run.id, run);
  return run;
}

export function finishLlmRun(
  state: Phase1State,
  run: LlmGenerationRun,
  rawOutput: Record<string, unknown>,
): LlmGenerationRun {
  return updateLlmRun(state, run, "succeeded", null, null, rawOutput);
}

export function failLlmRun(
  state: Phase1State,
  run: LlmGenerationRun,
  error: unknown,
): LlmGenerationRun {
  if (error instanceof LlmError) {
    return updateLlmRun(state, run, "failed", error.code, error.message, error.rawOutput);
  }
  if (error instanceof Error) {
    return updateLlmRun(state, run, "failed", "llm_error", error.message, null);
  }
  return updateLlmRun(state, run, "failed", "llm_error", String(error), null);
}

function updateLlmRun(
  state: Phase1State,
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
  state.llmGenerationRuns.set(next.id, next);
  return next;
}
