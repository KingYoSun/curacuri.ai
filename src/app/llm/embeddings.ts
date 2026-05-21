import OpenAI from "openai";

import { LlmError } from "./client.js";

export type EmbeddingConfig = {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly model: string;
  readonly dimensions: number;
};

export type EmbeddingResult = {
  readonly embedding: readonly number[];
  readonly modelName: string;
};

export type EmbeddingClient = {
  readonly modelName: string;
  readonly dimensions: number;
  readonly embed: (input: string) => Promise<EmbeddingResult>;
};

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmptyEnv(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }
  return value;
}

export function readEmbeddingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig {
  const embeddingApiKey = nonEmptyEnv(env.EMBEDDING_API_KEY);
  const llmApiKey = nonEmptyEnv(env.LLM_API_KEY);
  const embeddingBaseUrl = nonEmptyEnv(env.EMBEDDING_BASE_URL);
  const llmBaseUrl = nonEmptyEnv(env.LLM_BASE_URL);
  const embeddingModel = nonEmptyEnv(env.EMBEDDING_MODEL);
  return {
    apiKey: embeddingApiKey ?? llmApiKey,
    baseUrl: embeddingBaseUrl ?? llmBaseUrl ?? "https://api.openai.com/v1",
    model: embeddingModel ?? "text-embedding-3-small",
    dimensions: numberFromEnv(env.EMBEDDING_DIMENSIONS, 1536),
  };
}

export class OpenAICompatibleEmbeddingClient implements EmbeddingClient {
  readonly modelName: string;
  readonly dimensions: number;

  private readonly config: EmbeddingConfig;
  private readonly openai: OpenAI | null;

  constructor(config = readEmbeddingConfigFromEnv()) {
    this.config = config;
    this.modelName = config.model;
    this.dimensions = config.dimensions;
    this.openai =
      config.apiKey === null
        ? null
        : new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
          });
  }

  async embed(input: string): Promise<EmbeddingResult> {
    if (this.config.apiKey === null) {
      throw new LlmError(
        "embedding_api_key_missing",
        "EMBEDDING_API_KEY or LLM_API_KEY is not set",
      );
    }
    if (this.openai === null) {
      throw new LlmError("embedding_client_unconfigured", "Embedding client is not configured");
    }
    const response = await this.openai.embeddings.create({
      input,
      model: this.config.model,
      dimensions: this.config.dimensions,
      encoding_format: "float",
    });
    const embedding = response.data[0]?.embedding;
    if (embedding === undefined || embedding.length === 0) {
      throw new LlmError("empty_embedding", "Embedding API returned empty embedding");
    }
    return {
      embedding,
      modelName: response.model,
    };
  }
}

export function createDefaultEmbeddingClient(): EmbeddingClient {
  return new OpenAICompatibleEmbeddingClient();
}
