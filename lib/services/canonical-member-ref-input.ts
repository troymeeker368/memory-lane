import type { CanonicalMemberRefInput, CanonicalPersonRefInput } from "@/types/identity";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function toCanonicalMemberRefInput(input: CanonicalMemberRefInput | string): CanonicalPersonRefInput {
  if (typeof input === "string") {
    return {
      sourceType: "member",
      memberId: input
    };
  }

  return {
    sourceType: "member",
    memberId: input.memberId,
    selectedId: input.selectedId,
    leadId: input.leadId,
    externalId: input.externalId,
    legacyId: input.legacyId,
    displayName: input.displayName
  };
}

export function assertCanonicalMemberResolverInput(
  input: CanonicalMemberRefInput | string,
  actionLabel = "identity resolution"
): CanonicalPersonRefInput {
  const normalized = toCanonicalMemberRefInput(input);
  const hasCandidate = [
    normalized.memberId,
    normalized.selectedId,
    normalized.leadId,
    normalized.externalId,
    normalized.legacyId
  ].some((value) => clean(value));

  if (!hasCandidate) {
    throw new Error(
      `${actionLabel} requires memberId, selectedId, leadId, externalId, or legacyId to resolve a canonical member.`
    );
  }

  return normalized;
}
