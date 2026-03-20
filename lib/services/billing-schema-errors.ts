function collectErrorText(error: unknown) {
  const candidate =
    error && typeof error === "object"
      ? (error as {
          message?: unknown;
          details?: unknown;
          hint?: unknown;
          error_description?: unknown;
          cause?: { message?: unknown; details?: unknown; hint?: unknown } | null;
        })
      : null;
  return [
    candidate?.message,
    candidate?.details,
    candidate?.hint,
    candidate?.error_description,
    candidate?.cause?.message,
    candidate?.cause?.details,
    candidate?.cause?.hint
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export function isMissingSchemaObjectError(error: unknown) {
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; cause?: { code?: unknown } | null })
      : null;
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "").toUpperCase();
  const message = collectErrorText(error);

  return (
    code === "PGRST205" ||
    code === "PGRST116" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("could not find the table") ||
    message.includes("schema cache") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("column") && message.includes("does not exist") ||
    message.includes("does not exist")
  );
}

export function buildMissingSchemaMessage(input: { objectName: string; migration: string }) {
  return `Missing Supabase schema object public.${input.objectName}. Apply migration ${input.migration} (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache.`;
}

export function handleNonCriticalMissingSchemaError(
  error: unknown,
  input: { objectName: string; migration: string }
) {
  if (!isMissingSchemaObjectError(error)) return;
  const original =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "Unknown schema error")
      : "Unknown schema error";
  throw new Error(`${buildMissingSchemaMessage(input)} Original error: ${original}`);
}
