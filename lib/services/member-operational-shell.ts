import "server-only";

export type MemberOperationalShellRepairResult = {
  commandCentersInserted: number;
  schedulesInserted: number;
  memberHealthProfilesInserted: number;
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export async function ensureCanonicalMemberOperationalShellRows(
  memberId: string
): Promise<MemberOperationalShellRepairResult> {
  const canonicalMemberId = clean(memberId);
  if (!canonicalMemberId) {
    throw new Error("Member ID is required to ensure operational shell rows.");
  }

  const [{ backfillMissingMemberCommandCenterRows }, { backfillMissingMemberHealthProfiles }] =
    await Promise.all([
      import("@/lib/services/member-command-center"),
      import("@/lib/services/member-health-profiles")
    ]);

  const [mccResult, mhpResult] = await Promise.all([
    backfillMissingMemberCommandCenterRows([canonicalMemberId]),
    backfillMissingMemberHealthProfiles([canonicalMemberId])
  ]);

  return {
    commandCentersInserted: mccResult.commandCentersInserted,
    schedulesInserted: mccResult.schedulesInserted,
    memberHealthProfilesInserted: mhpResult.inserted
  };
}
