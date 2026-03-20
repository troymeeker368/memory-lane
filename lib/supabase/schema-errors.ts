export function isMissingSchemaObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const code = String((error as { code?: string }).code ?? "");
  const message = [
    (error as { message?: string }).message,
    (error as { details?: string }).details,
    (error as { hint?: string }).hint
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  return (
    code === "PGRST205" ||
    code === "PGRST116" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

export function isMissingSchemaColumnError(error: unknown, objectName?: string) {
  if (!error || typeof error !== "object") return false;

  const code = String((error as { code?: string }).code ?? "");
  const message = [
    (error as { message?: string }).message,
    (error as { details?: string }).details,
    (error as { hint?: string }).hint
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (code !== "42703") return false;
  if (!objectName) return message.includes("column");
  return message.includes(`column ${objectName.toLowerCase()}.`);
}

export function buildMissingSchemaMessage(input: { objectName: string; migration: string }) {
  return `Missing Supabase schema object public.${input.objectName}. Apply migration ${input.migration} (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache.`;
}

export function buildMissingSchemaColumnMessage(input: { objectName: string; migration: string }) {
  return `Supabase schema drift detected for public.${input.objectName}. Apply migration ${input.migration} (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache.`;
}
