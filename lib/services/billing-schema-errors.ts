function collectErrorText(error: any) {
  return [
    error?.message,
    error?.details,
    error?.hint,
    error?.error_description,
    error?.cause?.message,
    error?.cause?.details,
    error?.cause?.hint
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export function isMissingSchemaObjectError(error: any) {
  const code = String(error?.code ?? error?.cause?.code ?? "").toUpperCase();
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
  error: any,
  input: { objectName: string; migration: string }
) {
  if (!isMissingSchemaObjectError(error)) return;
  const original = String(error?.message ?? "Unknown schema error");
  throw new Error(`${buildMissingSchemaMessage(input)} Original error: ${original}`);
}
