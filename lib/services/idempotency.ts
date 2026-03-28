import "server-only";

import { createHash } from "node:crypto";

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

function normalizeForStableStringify(value: unknown): JsonLike {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStableStringify(entry));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeForStableStringify(entry)] as const);

    return Object.fromEntries(entries);
  }

  return String(value);
}

export function buildIdempotencyHash(scope: string, payload: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        scope: scope.trim(),
        payload: normalizeForStableStringify(payload)
      })
    )
    .digest("hex");
}

export function isPostgresUniqueViolation(error: unknown) {
  return String((error as { code?: string } | null | undefined)?.code ?? "") === "23505";
}
