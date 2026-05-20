import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

import type { LlmTaskType } from "../../shared/types.js";

export type LlmResponseFormat = "json_object" | "json_schema" | "prompt_only";

export type LlmConfig = {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly model: string | null;
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly responseFormat: LlmResponseFormat;
};

export type LlmJsonRequest = {
  readonly taskType: LlmTaskType;
  readonly messages: readonly ChatCompletionMessageParam[];
};

export type LlmJsonResult = {
  readonly modelName: string;
  readonly rawText: string;
  readonly rawJson: Record<string, unknown>;
};

export type LlmClient = {
  readonly modelName: string;
  readonly generateJson: (request: LlmJsonRequest) => Promise<LlmJsonResult>;
};

export class LlmError extends Error {
  readonly code: string;
  readonly rawOutput: Record<string, unknown> | null;

  constructor(code: string, message: string, rawOutput: Record<string, unknown> | null = null) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.rawOutput = rawOutput;
  }
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function responseFormatFromEnv(value: string | undefined): LlmResponseFormat {
  if (value === "json_schema" || value === "prompt_only") {
    return value;
  }
  return "json_object";
}

export function readLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    apiKey: env.LLM_API_KEY ?? null,
    baseUrl: env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    model: env.LLM_MODEL ?? null,
    timeoutMs: numberFromEnv(env.LLM_TIMEOUT_MS, 30_000),
    concurrency: numberFromEnv(env.LLM_CONCURRENCY, 2),
    responseFormat: responseFormatFromEnv(env.LLM_RESPONSE_FORMAT),
  };
}

function parseJsonObject(rawText: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new LlmError(
      "invalid_json",
      error instanceof Error ? error.message : "LLM output was not valid JSON",
      { rawText },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new LlmError("invalid_json_shape", "LLM output JSON must be an object", {
      parsed,
    });
  }
  return parsed as Record<string, unknown>;
}

export class OpenAICompatibleLlmClient implements LlmClient {
  readonly modelName: string;

  private readonly config: LlmConfig;
  private readonly openai: OpenAI | null;

  constructor(config = readLlmConfigFromEnv()) {
    this.config = config;
    this.modelName = config.model ?? "unconfigured";
    this.openai =
      config.apiKey === null
        ? null
        : new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            timeout: config.timeoutMs,
          });
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResult> {
    if (this.config.apiKey === null) {
      throw new LlmError("llm_api_key_missing", "LLM_API_KEY is not set");
    }
    if (this.config.model === null) {
      throw new LlmError("llm_model_missing", "LLM_MODEL is not set");
    }
    if (this.openai === null) {
      throw new LlmError("llm_client_unconfigured", "LLM client is not configured");
    }

    const params: ChatCompletionCreateParamsNonStreaming = {
      model: this.config.model,
      messages: [...request.messages],
    };
    const completion = await this.openai.chat.completions.create(
      this.config.responseFormat === "prompt_only"
        ? params
        : { ...params, response_format: { type: "json_object" } },
    );

    const rawText = completion.choices[0]?.message.content;
    if (rawText === undefined || rawText === null || rawText.trim().length === 0) {
      throw new LlmError("empty_output", "LLM returned empty content", {
        completionId: completion.id,
        model: completion.model,
      });
    }

    return {
      modelName: completion.model,
      rawText,
      rawJson: parseJsonObject(rawText),
    };
  }
}

export function createDefaultLlmClient(): LlmClient {
  return new OpenAICompatibleLlmClient();
}
