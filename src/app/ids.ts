import { createHash, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function stableId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
}

export function hashAuthorId(authorId: string): string {
  return createHash("sha256").update(authorId).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}
