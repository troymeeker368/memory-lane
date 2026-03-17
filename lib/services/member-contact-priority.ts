type PreferredContactCandidate = {
  member_id: string;
  category: string | null;
  updated_at: string;
};

export function resolveMemberContactPriority(category: string | null | undefined): number {
  const normalized = String(category ?? "").trim().toLowerCase();
  if (normalized === "primary caregiver" || normalized === "responsible party") return 0;
  if (normalized === "family caregiver" || normalized === "care provider") return 1;
  if (normalized === "guardian") return 2;
  if (normalized === "emergency contact") return 3;
  if (normalized === "spouse") return 4;
  if (normalized === "child") return 5;
  if (normalized === "payor") return 6;
  if (normalized === "other") return 7;
  return 8;
}

export function buildPreferredContactByMember<T extends PreferredContactCandidate>(contacts: T[]) {
  const preferred = new Map<string, T>();

  [...contacts]
    .sort((left, right) => {
      const memberCompare = left.member_id.localeCompare(right.member_id);
      if (memberCompare !== 0) return memberCompare;
      const categoryCompare = resolveMemberContactPriority(left.category) - resolveMemberContactPriority(right.category);
      if (categoryCompare !== 0) return categoryCompare;
      if (left.updated_at === right.updated_at) return 0;
      return left.updated_at > right.updated_at ? -1 : 1;
    })
    .forEach((contact) => {
      if (!preferred.has(contact.member_id)) {
        preferred.set(contact.member_id, contact);
      }
    });

  return preferred;
}
