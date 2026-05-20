import { createDefaultLlmClient } from "./llm/client.js";
import type { LlmClient } from "./llm/client.js";
import { createQueueRuntime, type QueueRuntime } from "./queues.js";
import { PostgresPhase1Repository } from "./repositories/postgres.js";
import type { Phase1Repository } from "./repositories/types.js";

export type AppRuntime = {
  readonly repository: Phase1Repository;
  readonly queues: QueueRuntime;
  readonly llmClient: LlmClient;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function createAppRuntime(): Promise<AppRuntime> {
  const repository = new PostgresPhase1Repository(requiredEnv("DATABASE_URL"));
  await repository.ensureSeed();
  return {
    repository,
    queues: createQueueRuntime(requiredEnv("REDIS_URL")),
    llmClient: createDefaultLlmClient(),
  };
}
