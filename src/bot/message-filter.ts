const allowedCuracuriEnvs = ["local", "test", "dogfood", "production"] as const;

type CuracuriEnv = (typeof allowedCuracuriEnvs)[number];

export type DiscordBotAuthorTestGate = {
  readonly allowBotAuthors: boolean;
  readonly allowedBotAuthorIds: readonly string[];
  readonly curacuriEnv: string | undefined;
  readonly nodeEnv: string | undefined;
};

export type ProcessableDiscordMessage = {
  readonly author: {
    readonly id: string;
    readonly bot: boolean;
  };
  readonly content: string;
};

function parseAllowedAuthorIds(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

function isCuracuriEnv(value: string | undefined): value is CuracuriEnv {
  return allowedCuracuriEnvs.some((item) => item === value);
}

export function readDiscordBotAuthorTestGate(
  env: NodeJS.ProcessEnv = process.env,
): DiscordBotAuthorTestGate {
  return {
    allowBotAuthors: env.DISCORD_TEST_ALLOW_BOT_AUTHORS === "true",
    allowedBotAuthorIds: parseAllowedAuthorIds(env.DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS),
    curacuriEnv: env.CURACURI_ENV,
    nodeEnv: env.NODE_ENV,
  };
}

export function validateDiscordBotAuthorTestGate(gate: DiscordBotAuthorTestGate): void {
  if (!gate.allowBotAuthors) {
    return;
  }

  if (!isCuracuriEnv(gate.curacuriEnv)) {
    throw new Error(
      "CURACURI_ENV must be one of local, test, dogfood, production when DISCORD_TEST_ALLOW_BOT_AUTHORS=true",
    );
  }

  if (gate.curacuriEnv === "production") {
    throw new Error(
      "DISCORD_TEST_ALLOW_BOT_AUTHORS cannot be enabled when CURACURI_ENV=production",
    );
  }

  if (gate.nodeEnv === "production") {
    throw new Error("DISCORD_TEST_ALLOW_BOT_AUTHORS cannot be enabled when NODE_ENV=production");
  }

  if (gate.allowedBotAuthorIds.length === 0) {
    throw new Error(
      "DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS is required when DISCORD_TEST_ALLOW_BOT_AUTHORS=true",
    );
  }
}

function isAllowedTestBotAuthor(authorId: string, gate: DiscordBotAuthorTestGate): boolean {
  return (
    gate.allowBotAuthors &&
    isCuracuriEnv(gate.curacuriEnv) &&
    gate.curacuriEnv !== "production" &&
    gate.nodeEnv !== "production" &&
    gate.allowedBotAuthorIds.includes(authorId)
  );
}

export function shouldProcessDiscordMessage(
  message: ProcessableDiscordMessage,
  gate: DiscordBotAuthorTestGate,
): boolean {
  if (message.content.trim().length === 0) {
    return false;
  }

  if (!message.author.bot) {
    return true;
  }

  return isAllowedTestBotAuthor(message.author.id, gate);
}
