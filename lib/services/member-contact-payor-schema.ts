export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export const MEMBER_CONTACT_PAYOR_MIGRATION = "0065_member_contact_payor_canonicalization.sql";

export const MEMBER_CONTACT_SELECT_WITH_PAYOR =
  "id, member_id, contact_name, relationship_to_member, category, category_other, email, cellular_number, work_number, home_number, street_address, city, state, zip, is_payor, created_by_user_id, created_by_name, created_at, updated_at";

export const MEMBER_CONTACT_SELECT_LEGACY =
  "id, member_id, contact_name, relationship_to_member, category, category_other, email, cellular_number, work_number, home_number, street_address, city, state, zip, created_by_user_id, created_by_name, created_at, updated_at";

function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

export function isMemberContactsPayorColumnMissingError(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  return (
    (error?.code === "42703" && text.includes("is_payor")) ||
    ((error?.code === "PGRST204" || error?.code === "PGRST205") &&
      text.includes("member_contacts") &&
      text.includes("is_payor")) ||
    (text.includes("member_contacts") &&
      text.includes("is_payor") &&
      (text.includes("schema cache") || text.includes("column") || text.includes("does not exist")))
  );
}

export function isAmbiguousColumnReferenceError(
  error: PostgrestErrorLike | null | undefined,
  columnName?: string
) {
  const text = extractErrorText(error);
  if (!text) return false;
  if (error?.code !== "42702" && !text.includes("is ambiguous")) return false;
  if (!columnName) return true;
  return text.includes(columnName.toLowerCase());
}

export function buildMemberContactsSchemaOutOfDateMessage() {
  return "Database schema is out of date for member contacts. Apply the latest Supabase migrations and refresh generated types.";
}

export function buildMemberContactsSchemaOutOfDateError() {
  return new Error(buildMemberContactsSchemaOutOfDateMessage());
}
