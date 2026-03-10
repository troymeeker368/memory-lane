import type { MockDb, StoredReview } from "@/lib/mock/types";
import { ANCILLARY_CHARGE_CATALOG, canonicalLeadStatus } from "@/lib/canonical";
import { buildSeededMockDb } from "@/lib/mock/seed";
import { readMockStateJson, writeMockStateJson } from "@/lib/mock-persistence";
import { generateClosureDatesFromRules, type ClosureRuleLike } from "@/lib/services/closure-rules";
import { getStandardDailyRateForAttendanceDays } from "@/lib/services/billing-rate-tiers";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import type { AppRole, AuditAction } from "@/types/app";

export type { MockDb, ReviewStatus, StoredReview } from "@/lib/mock/types";

interface PersistedMockRepoState {
  version: 1;
  counter: number;
  db: MockDb;
  timeReviews: Array<{ key: string; review: StoredReview }>;
  documentationReviews: Array<{ key: string; review: StoredReview }>;
  leadMemberLinks: Array<{ leadId: string; memberId: string }>;
  lockerHistory: Array<{
    lockerNumber: string;
    previousMemberId: string | null;
    previousMemberName: string;
    recordedAt: string;
  }>;
  operationalConfig: {
    busNumbers: string[];
    makeupPolicy: "rolling_30_day_expiration" | "running_total";
    latePickupRules: {
      graceStartTime: string;
      firstWindowMinutes: number;
      firstWindowFeeCents: number;
      additionalPerMinuteCents: number;
      additionalMinutesCap: number;
    };
  };
  makeupLedger: Array<{
    id: string;
    memberId: string;
    deltaDays: number;
    reason: string;
    source: string;
    effectiveDate: string;
    expiresAt: string | null;
    createdAt: string;
    createdByUserId: string;
    createdByName: string;
  }>;
}

const MOCK_REPO_STATE_FILE = "mock-repo.json";

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function buildBaselineAuditLogs(seedDb: MockDb) {
  const baseline: MockDb["auditLogs"] = [];

  const push = (entry: Omit<MockDb["auditLogs"][number], "id">) => {
    baseline.push({
      id: `audit-bootstrap-${baseline.length + 1}`,
      ...entry
    });
  };

  seedDb.leads.slice(0, 80).forEach((lead) => {
    push({
      actor_user_id: lead.created_by_user_id,
      actor_name: lead.created_by_name,
      actor_role: "admin",
      action: "create_lead",
      entity_type: "lead",
      entity_id: lead.id,
      details_json: safeStringify({ stage: lead.stage, status: lead.status }),
      occurred_at: lead.created_at
    });
  });

  seedDb.timePunches.slice(0, 120).forEach((punch) => {
    push({
      actor_user_id: punch.staff_user_id,
      actor_name: punch.staff_name,
      actor_role: "program-assistant",
      action: punch.punch_type === "in" ? "clock_in" : "clock_out",
      entity_type: "time_punch",
      entity_id: punch.id,
      details_json: safeStringify({ site: punch.site_id, withinFence: punch.within_fence }),
      occurred_at: punch.punch_at
    });
  });

  seedDb.ancillaryLogs.slice(0, 120).forEach((charge) => {
    push({
      actor_user_id: charge.staff_user_id,
      actor_name: charge.staff_name,
      actor_role: "program-assistant",
      action: "create_log",
      entity_type: "ancillary_charge",
      entity_id: charge.id,
      details_json: safeStringify({
        category: charge.category_name,
        amountCents: charge.amount_cents,
        serviceDate: charge.service_date
      }),
      occurred_at: charge.created_at || charge.timestamp
    });
  });

  return baseline;
}

function buildAssessmentResponsesFromAssessments(seedDb: MockDb) {
  const responses: MockDb["assessmentResponses"] = [];
  const push = (
    assessment: MockDb["assessments"][number],
    section: string,
    fieldKey: string,
    fieldLabel: string,
    fieldValue: string | number | boolean,
    fieldValueType: MockDb["assessmentResponses"][number]["field_value_type"]
  ) => {
    responses.push({
      id: `assessment-response-bootstrap-${assessment.id}-${fieldKey}`,
      assessment_id: assessment.id,
      member_id: assessment.member_id,
      field_key: fieldKey,
      field_label: fieldLabel,
      section_type: section,
      field_value: String(fieldValue),
      field_value_type: fieldValueType,
      created_at: assessment.created_at
    });
  };

  seedDb.assessments.forEach((assessment) => {
    push(assessment, "Orientation & General Health", "feeling_today", "How Member Is Feeling Today", assessment.feeling_today, "string");
    push(assessment, "Orientation & General Health", "health_lately", "Health Lately", assessment.health_lately, "string");
    push(assessment, "Orientation & General Health", "allergies", "Allergies", assessment.allergies, "string");
    push(assessment, "Orientation & General Health", "code_status", "Code Status", assessment.code_status, "string");
    push(assessment, "Orientation & General Health", "orientation_dob_verified", "Orientation DOB Verified", assessment.orientation_dob_verified, "boolean");
    push(assessment, "Orientation & General Health", "orientation_city_verified", "Orientation City Verified", assessment.orientation_city_verified, "boolean");
    push(assessment, "Orientation & General Health", "orientation_year_verified", "Orientation Current Year Verified", assessment.orientation_year_verified, "boolean");
    push(assessment, "Orientation & General Health", "orientation_occupation_verified", "Orientation Former Occupation Verified", assessment.orientation_occupation_verified, "boolean");
    push(assessment, "Independence & Daily Routines", "medication_management_status", "Medication Management", assessment.medication_management_status, "string");
    push(assessment, "Independence & Daily Routines", "dressing_support_status", "Dressing Support", assessment.dressing_support_status, "string");
    push(assessment, "Independence & Daily Routines", "assistive_devices", "Assistive Devices", assessment.assistive_devices, "string");
    push(assessment, "Independence & Daily Routines", "incontinence_products", "Incontinence Products", assessment.incontinence_products, "string");
    push(assessment, "Independence & Daily Routines", "on_site_medication_use", "On-site Medication Use", assessment.on_site_medication_use ?? "", "string");
    push(assessment, "Independence & Daily Routines", "on_site_medication_list", "On-site Medication List", assessment.on_site_medication_list ?? "", "string");
    push(assessment, "Diet & Nutrition", "diet_type", "Diet Type", assessment.diet_type, "string");
    push(assessment, "Mobility & Safety", "mobility_steadiness", "Steadiness / Mobility", assessment.mobility_steadiness, "string");
    push(assessment, "Social Engagement & Emotional Wellness", "social_triggers", "Known Triggers", assessment.social_triggers, "string");
    push(assessment, "Scoring", "total_score", "Total Score", assessment.total_score, "number");
    push(assessment, "Scoring", "recommended_track", "Recommended Track", assessment.recommended_track, "string");
    push(assessment, "Transportation Screening", "transport_appropriate", "Appropriate for Center Transportation", assessment.transport_appropriate, "boolean");
    push(assessment, "Vital Signs", "vitals_hr", "HR", assessment.vitals_hr, "number");
    push(assessment, "Vital Signs", "vitals_bp", "BP", assessment.vitals_bp, "string");
    push(assessment, "Vital Signs", "vitals_o2_percent", "O2 %", assessment.vitals_o2_percent, "number");
    push(assessment, "Vital Signs", "vitals_rr", "RR", assessment.vitals_rr, "number");
  });

  return responses;
}

function buildInitialCounter(seedDb: MockDb) {
  return (
    1000 +
    Object.values(seedDb)
      .filter((value) => Array.isArray(value))
      .reduce((sum, rows) => sum + rows.length, 0)
  );
}

function createInitialState(): PersistedMockRepoState {
  const seedDb = buildSeededMockDb();
  return {
    version: 1,
    counter: buildInitialCounter(seedDb),
    db: seedDb,
    timeReviews: [],
    documentationReviews: [],
    leadMemberLinks: [],
    lockerHistory: [],
    operationalConfig: {
      busNumbers: ["1", "2", "3"],
      makeupPolicy: "rolling_30_day_expiration",
      latePickupRules: {
        graceStartTime: "17:00",
        firstWindowMinutes: 15,
        firstWindowFeeCents: 2500,
        additionalPerMinuteCents: 200,
        additionalMinutesCap: 15
      }
    },
    makeupLedger: []
  };
}

function normalizeBusNumberList(values: unknown): string[] {
  if (!Array.isArray(values)) return ["1", "2", "3"];
  const next = Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value) && Number(value) > 0)
    )
  ).sort((left, right) => Number(left) - Number(right));
  return next.length > 0 ? next : ["1", "2", "3"];
}

function normalizeAncillaryCategoryName(name: string | null | undefined) {
  const trimmed = (name ?? "").trim();
  const normalized = trimmed.toLowerCase();
  if (!normalized) return null;
  if (
    normalized.includes("refused/no show") ||
    normalized.includes("refused / no show") ||
    normalized.includes("no show") ||
    normalized.includes("noshow")
  ) {
    return "Transport - Refused/No Show";
  }
  if (normalized === "transportation" || normalized.includes("bus stop") || normalized.includes("bus-stop")) {
    return "Transport - Bus Stop";
  }
  if (normalized.includes("door to door") || normalized.includes("door-to-door") || normalized === "d2d") {
    return "Transport - Door to Door";
  }
  return trimmed;
}

function normalizePriceCents(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function normalizeBusStopName(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeLockerNumber(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }
  return normalized.toUpperCase();
}

function timestampFromRowValue(row: Record<string, unknown>) {
  const rawUpdatedAt = row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt;
  if (typeof rawUpdatedAt !== "string" || rawUpdatedAt.trim().length === 0) {
    return Number.NaN;
  }
  const parsed = Date.parse(rawUpdatedAt);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function shouldReplaceDuplicateRow(existing: Record<string, unknown>, next: Record<string, unknown>) {
  const existingTs = timestampFromRowValue(existing);
  const nextTs = timestampFromRowValue(next);

  if (Number.isFinite(nextTs) && Number.isFinite(existingTs)) {
    return nextTs >= existingTs;
  }
  if (Number.isFinite(nextTs)) return true;
  if (Number.isFinite(existingTs)) return false;
  return true;
}

function dedupeRowsById<T extends Record<string, unknown>>(rows: T[]) {
  const deduped: T[] = [];
  const indexById = new Map<string, number>();

  rows.forEach((row) => {
    const id = String(row.id ?? "").trim();
    if (!id) {
      deduped.push(row);
      return;
    }

    const existingIndex = indexById.get(id);
    if (existingIndex == null) {
      indexById.set(id, deduped.length);
      deduped.push(row);
      return;
    }

    const existing = deduped[existingIndex];
    if (existing && shouldReplaceDuplicateRow(existing, row)) {
      deduped[existingIndex] = row;
    }
  });

  return deduped;
}

function dedupeMockDbTablesById(db: MockDb) {
  const mutableDb = db as unknown as Record<string, unknown>;
  Object.keys(mutableDb).forEach((key) => {
    const rows = mutableDb[key];
    if (!Array.isArray(rows) || rows.length < 2) return;
    if (!rows.every((row) => row && typeof row === "object")) return;
    if (!rows.some((row) => Object.prototype.hasOwnProperty.call(row as object, "id"))) return;
    mutableDb[key] = dedupeRowsById(rows as Record<string, unknown>[]);
  });
}

function ensureBalancedMemberTracks(members: MockDb["members"]) {
  const trackCycle: Array<"Track 1" | "Track 2" | "Track 3"> = ["Track 1", "Track 2", "Track 3"];
  const activeMembers = members.filter((member) => member.status === "active");
  const counts: Record<(typeof trackCycle)[number], number> = {
    "Track 1": 0,
    "Track 2": 0,
    "Track 3": 0
  };
  let hasMissing = false;
  activeMembers.forEach((member) => {
    if (member.latest_assessment_track === "Track 1" || member.latest_assessment_track === "Track 2" || member.latest_assessment_track === "Track 3") {
      counts[member.latest_assessment_track] += 1;
      return;
    }
    hasMissing = true;
  });

  const minCount = Math.min(counts["Track 1"], counts["Track 2"], counts["Track 3"]);
  const maxCount = Math.max(counts["Track 1"], counts["Track 2"], counts["Track 3"]);
  const isBalanced = maxCount - minCount <= 1;
  if (!hasMissing && isBalanced) return members;

  const scoreByTrack: Record<(typeof trackCycle)[number], number> = {
    "Track 1": 68,
    "Track 2": 52,
    "Track 3": 34
  };

  const activeSorted = [...activeMembers].sort((left, right) =>
    left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" })
  );

  activeSorted.forEach((member, idx) => {
    const track = trackCycle[idx % trackCycle.length]!;
    member.latest_assessment_track = track;
    member.latest_assessment_score = member.latest_assessment_score ?? scoreByTrack[track];
    member.latest_assessment_admission_review_required = false;
  });

  return members;
}

function collectBusStopNamesFromSchedules(
  schedules: MockDb["memberAttendanceSchedules"]
): string[] {
  return Array.from(
    new Set(
      schedules
        .flatMap((row) => [
          row.transport_monday_am_bus_stop,
          row.transport_monday_pm_bus_stop,
          row.transport_tuesday_am_bus_stop,
          row.transport_tuesday_pm_bus_stop,
          row.transport_wednesday_am_bus_stop,
          row.transport_wednesday_pm_bus_stop,
          row.transport_thursday_am_bus_stop,
          row.transport_thursday_pm_bus_stop,
          row.transport_friday_am_bus_stop,
          row.transport_friday_pm_bus_stop
        ])
        .map((value) => normalizeBusStopName(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function busStopDirectoryIdFromName(name: string) {
  return `bus-stop-directory-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function hospitalPreferenceDirectoryIdFromName(name: string) {
  return `hospital-preference-directory-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function hashFromKey(value: string) {
  let hash = 2166136261;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash ^= value.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildDefaultAddress(parts: Array<string | null | undefined>) {
  return (
    parts
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(", ") || "Fort Mill, SC"
  );
}

function normalizePersistedState(candidate: PersistedMockRepoState | null | undefined): PersistedMockRepoState {
  if (!candidate || candidate.version !== 1 || !candidate.db) {
    return createInitialState();
  }

  const seededDb = buildSeededMockDb();
  const db: MockDb = {
    ...seededDb,
    ...candidate.db
  };

  if (Array.isArray(db.members)) {
    const seededLockerByMemberId = new Map(
      seededDb.members.map((member) => [member.id, normalizeLockerNumber((member as { locker_number?: unknown }).locker_number)] as const)
    );
    const usedActiveLockers = new Set<string>();

    db.members = db.members.map((member) => {
      const fromMember = normalizeLockerNumber((member as { locker_number?: unknown }).locker_number);
      const fromSeed = seededLockerByMemberId.get(member.id) ?? null;
      let locker = fromMember ?? fromSeed;

      if (member.status === "active" && locker) {
        if (usedActiveLockers.has(locker)) {
          locker = null;
        } else {
          usedActiveLockers.add(locker);
        }
      }

      return {
        ...member,
        locker_number: locker,
        discharge_date: member.discharge_date ?? null,
        discharge_reason: member.discharge_reason ?? null,
        discharge_disposition: member.discharge_disposition ?? null,
        discharged_by: member.discharged_by ?? null,
        on_site_medication_list: member.on_site_medication_list ?? null
      };
    });

    const activeMembers = db.members.filter((member) => member.status === "active");
    const targetAssignedCount = Math.ceil(activeMembers.length * 0.75);
    const preferredLockers = ["5", "11", "27", "33", "34"];
    const activeWithoutLocker = () => db.members.filter((member) => member.status === "active" && !member.locker_number);

    preferredLockers.forEach((locker) => {
      if (usedActiveLockers.has(locker)) return;
      const target = activeWithoutLocker()[0];
      if (!target) return;
      target.locker_number = locker;
      usedActiveLockers.add(locker);
    });

    let nextLocker = 1;
    activeWithoutLocker().forEach((member) => {
      if (usedActiveLockers.size >= targetAssignedCount) return;
      while (usedActiveLockers.has(String(nextLocker))) {
        nextLocker += 1;
      }
      member.locker_number = String(nextLocker);
      usedActiveLockers.add(member.locker_number);
      nextLocker += 1;
    });

    db.members = ensureBalancedMemberTracks(db.members);
  }

  if (Array.isArray(db.assessments)) {
    db.assessments = db.assessments.map((assessment) => ({
      ...assessment,
      lead_id: assessment.lead_id ?? null,
      lead_stage_at_assessment: assessment.lead_stage_at_assessment ?? null,
      lead_status_at_assessment: assessment.lead_status_at_assessment ?? null,
      on_site_medication_list: assessment.on_site_medication_list ?? "",
      vitals_hr: typeof assessment.vitals_hr === "number" ? assessment.vitals_hr : 72,
      vitals_bp: assessment.vitals_bp ?? "120/80",
      vitals_o2_percent: typeof assessment.vitals_o2_percent === "number" ? assessment.vitals_o2_percent : 98,
      vitals_rr: typeof assessment.vitals_rr === "number" ? assessment.vitals_rr : 16
    }));
  }

  if (Array.isArray(db.leads)) {
    db.leads = db.leads.map((lead) => ({
      ...lead,
      member_dob: (lead.member_dob as string | null | undefined) ?? null,
      lead_source_other: (lead.lead_source_other as string | null | undefined) ?? null,
      referral_source_id: (lead.referral_source_id as string | null | undefined) ?? null
    }));
  }

  db.memberHealthProfiles = Array.isArray(db.memberHealthProfiles) ? db.memberHealthProfiles : [];
  db.memberDiagnoses = Array.isArray(db.memberDiagnoses) ? db.memberDiagnoses : [];
  db.memberMedications = Array.isArray(db.memberMedications) ? db.memberMedications : [];
  db.memberAllergies = Array.isArray(db.memberAllergies) ? db.memberAllergies : [];
  db.memberProviders = Array.isArray(db.memberProviders) ? db.memberProviders : [];
  db.providerDirectory = Array.isArray(db.providerDirectory) ? db.providerDirectory : [];
  db.hospitalPreferenceDirectory = Array.isArray(db.hospitalPreferenceDirectory) ? db.hospitalPreferenceDirectory : [];
  db.busStopDirectory = Array.isArray(db.busStopDirectory) ? db.busStopDirectory : [];
  db.memberEquipment = Array.isArray(db.memberEquipment) ? db.memberEquipment : [];
  db.memberNotes = Array.isArray(db.memberNotes) ? db.memberNotes : [];
  db.memberCommandCenters = Array.isArray(db.memberCommandCenters) ? db.memberCommandCenters : [];
  db.memberAttendanceSchedules = Array.isArray(db.memberAttendanceSchedules) ? db.memberAttendanceSchedules : [];
  db.memberHolds = Array.isArray(db.memberHolds) ? db.memberHolds : [];
  db.attendanceRecords = Array.isArray(db.attendanceRecords) ? db.attendanceRecords : [];
  db.transportationManifestAdjustments = Array.isArray(db.transportationManifestAdjustments)
    ? db.transportationManifestAdjustments
    : [];
  db.centerBillingSettings = Array.isArray(db.centerBillingSettings) ? db.centerBillingSettings : [];
  db.closureRules = Array.isArray(db.closureRules) ? db.closureRules : [];
  db.centerClosures = Array.isArray(db.centerClosures) ? db.centerClosures : [];
  db.payors = Array.isArray(db.payors) ? db.payors : [];
  db.memberBillingSettings = Array.isArray(db.memberBillingSettings) ? db.memberBillingSettings : [];
  db.billingScheduleTemplates = Array.isArray(db.billingScheduleTemplates) ? db.billingScheduleTemplates : [];
  db.billingAdjustments = Array.isArray(db.billingAdjustments) ? db.billingAdjustments : [];
  db.billingBatches = Array.isArray(db.billingBatches) ? db.billingBatches : [];
  db.billingInvoices = Array.isArray(db.billingInvoices) ? db.billingInvoices : [];
  db.billingInvoiceLines = Array.isArray(db.billingInvoiceLines) ? db.billingInvoiceLines : [];
  db.billingExportJobs = Array.isArray(db.billingExportJobs) ? db.billingExportJobs : [];
  db.billingCoverages = Array.isArray(db.billingCoverages) ? db.billingCoverages : [];
  db.memberContacts = Array.isArray(db.memberContacts) ? db.memberContacts : [];
  db.memberFiles = Array.isArray(db.memberFiles) ? db.memberFiles : [];
  dedupeMockDbTablesById(db);

  if (Array.isArray(db.memberCommandCenters)) {
    db.memberCommandCenters = db.memberCommandCenters.map((row) => ({
      ...row,
      gender: row.gender === "M" || row.gender === "F" ? row.gender : null,
      photo_consent: typeof row.photo_consent === "boolean" ? row.photo_consent : null,
      no_known_allergies: typeof row.no_known_allergies === "boolean" ? row.no_known_allergies : null,
      dnr: typeof row.dnr === "boolean" ? row.dnr : null,
      dni: typeof row.dni === "boolean" ? row.dni : null,
      hospice: typeof row.hospice === "boolean" ? row.hospice : null,
      advanced_directives_obtained:
        typeof row.advanced_directives_obtained === "boolean" ? row.advanced_directives_obtained : null,
      is_veteran: typeof row.is_veteran === "boolean" ? row.is_veteran : null,
      veteran_branch: row.veteran_branch ?? null,
      created_at: row.created_at ?? toEasternISO(),
      updated_at: row.updated_at ?? toEasternISO(),
      updated_by_user_id: row.updated_by_user_id ?? null,
      updated_by_name: row.updated_by_name ?? null
    }));

    const now = toEasternISO();
    const seededCommandCentersByMember = new Map(
      seededDb.memberCommandCenters.map((row) => [row.member_id, row] as const)
    );
    const existingByMember = new Map(
      db.memberCommandCenters.map((row) => [row.member_id, row] as const)
    );

    db.members.forEach((member, idx) => {
      if (existingByMember.has(member.id)) return;
      const seeded = seededCommandCentersByMember.get(member.id);
      const generatedAddress = `${120 + (idx % 250)} Main St`;
      const generatedZip = `297${String((idx % 40) + 10).padStart(2, "0")}`;
      const generated: MockDb["memberCommandCenters"][number] = {
        id: `member-command-center-${member.id}`,
        member_id: member.id,
        gender: idx % 2 === 0 ? "M" : "F",
        payor: "Private Pay",
        original_referral_source: "Referral",
        photo_consent: true,
        profile_image_url: null,
        location: "Fort Mill",
        street_address: generatedAddress,
        city: member.city ?? "Fort Mill",
        state: "SC",
        zip: generatedZip,
        marital_status: "Unknown",
        primary_language: "English",
        secondary_language: null,
        religion: null,
        ethnicity: null,
        is_veteran: false,
        veteran_branch: null,
        code_status: member.code_status ?? "Full Code",
        dnr: (member.code_status ?? "Full Code") === "DNR",
        dni: false,
        polst_molst_colst: null,
        hospice: false,
        advanced_directives_obtained: false,
        power_of_attorney: null,
        funeral_home: null,
        legal_comments: null,
        diet_type: member.diet_type ?? "Regular",
        dietary_preferences_restrictions: member.diet_restrictions_notes ?? null,
        swallowing_difficulty: null,
        supplements: null,
        food_dislikes: null,
        foods_to_omit: null,
        diet_texture: "Regular",
        no_known_allergies: null,
        medication_allergies: null,
        food_allergies: null,
        environmental_allergies: null,
        command_center_notes: null,
        source_assessment_id: null,
        source_assessment_at: null,
        updated_by_user_id: null,
        updated_by_name: null,
        created_at: now,
        updated_at: now
      };

      const next = seeded ?? generated;
      db.memberCommandCenters.push(next);
      existingByMember.set(member.id, next);
    });
  }

  if (Array.isArray(db.memberAllergies) && Array.isArray(db.memberCommandCenters)) {
    const now = toEasternISO();
    const systemStaff = db.staff[0] ?? seededDb.staff[0] ?? null;
    const mccByMember = new Map(db.memberCommandCenters.map((row) => [row.member_id, row] as const));
    const allergyTemplate = [
      { group: "food", name: "Peanuts", severity: "Moderate" },
      { group: "medication", name: "Penicillin", severity: "High" },
      { group: "environmental", name: "Pollen", severity: "Mild" }
    ] as const;

    db.members.forEach((member) => {
      const memberAllergies = db.memberAllergies.filter((row) => row.member_id === member.id);
      const mcc = mccByMember.get(member.id);

      if (memberAllergies.length === 0) {
        const shouldSetNka = hashFromKey(`mcc-allergy-nka:${member.id}`) % 5 === 0;
        if (shouldSetNka) {
          if (mcc) {
            mcc.no_known_allergies = true;
            mcc.food_allergies = null;
            mcc.medication_allergies = null;
            mcc.environmental_allergies = null;
          }
          if (!member.allergies) {
            member.allergies = "NKA";
          }
          return;
        }

        const primary = allergyTemplate[hashFromKey(`mcc-allergy-primary:${member.id}`) % allergyTemplate.length];
        const secondary = allergyTemplate[(hashFromKey(`mcc-allergy-secondary:${member.id}`) + 1) % allergyTemplate.length];
        const includeSecondary = hashFromKey(`mcc-allergy-secondary-flag:${member.id}`) % 4 === 0;
        const toSeed = includeSecondary && secondary.group !== primary.group ? [primary, secondary] : [primary];

        toSeed.forEach((entry, allergyIdx) => {
          db.memberAllergies.push({
            id: `member-allergy-seed-${member.id}-${allergyIdx + 1}`,
            member_id: member.id,
            allergy_group: entry.group,
            allergy_name: entry.name,
            severity: entry.severity,
            comments: null,
            created_by_user_id: systemStaff?.id ?? "system",
            created_by_name: systemStaff?.full_name ?? "System",
            created_at: now,
            updated_at: now
          });
        });
      }

      const refreshed = db.memberAllergies.filter((row) => row.member_id === member.id);
      const food = refreshed.filter((row) => row.allergy_group === "food").map((row) => row.allergy_name.trim()).filter(Boolean);
      const medication = refreshed.filter((row) => row.allergy_group === "medication").map((row) => row.allergy_name.trim()).filter(Boolean);
      const environmental = refreshed.filter((row) => row.allergy_group === "environmental").map((row) => row.allergy_name.trim()).filter(Boolean);

      if (mcc) {
        mcc.no_known_allergies = refreshed.length === 0 ? true : false;
        mcc.food_allergies = food.length > 0 ? food.join(", ") : null;
        mcc.medication_allergies = medication.length > 0 ? medication.join(", ") : null;
        mcc.environmental_allergies = environmental.length > 0 ? environmental.join(", ") : null;
      }

      if (!member.allergies) {
        const summary = [...food, ...medication, ...environmental];
        member.allergies = summary.length > 0 ? summary.join(", ") : "NKA";
      }
    });
  }

  if (Array.isArray(db.memberAttendanceSchedules)) {
    type WeekdayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
    const dayKeys: WeekdayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    const busStopPool = [
      "Main & Academy",
      "Springfield Park",
      "Ridge Rd Plaza",
      "Dobys Bridge",
      "Carowinds Blvd",
      "Kingsley Loop"
    ];
    const normalizeTransportMode = (value: unknown): "Door to Door" | "Bus Stop" | null =>
      value === "Door to Door" || value === "Bus Stop" ? value : null;
    const normalizeTransportBusNumber = (value: unknown): "1" | "2" | "3" | null =>
      value === "1" || value === "2" || value === "3" ? value : null;
    const normalizeTransportPeriod = (value: unknown): "AM" | "PM" | null => (value === "AM" || value === "PM" ? value : null);

    const existingByMember = new Map(
      db.memberAttendanceSchedules.map((row) => [row.member_id, row] as const)
    );
    const commandCenterByMember = new Map(
      db.memberCommandCenters.map((row) => [row.member_id, row] as const)
    );

    db.members.forEach((member) => {
      if (existingByMember.has(member.id)) return;

      const commandCenter = commandCenterByMember.get(member.id);
      const defaultDoorToDoorAddress = buildDefaultAddress([
        commandCenter?.street_address,
        commandCenter?.city ?? member.city,
        commandCenter?.state,
        commandCenter?.zip
      ]);
      const scheduleHash = hashFromKey(`attendance-default:${member.id}`);
      const monday = true;
      const tuesday = (scheduleHash & 1) === 1;
      const wednesday = true;
      const thursday = (scheduleHash & 2) === 2;
      const friday = true;
      const transportationRequired = hashFromKey(`transport-required:${member.id}`) % 10 < 8;
      const dayEnabled: Record<WeekdayKey, boolean> = { monday, tuesday, wednesday, thursday, friday };
      const buildSlot = (
        dayKey: WeekdayKey,
        shift: "AM" | "PM"
      ): {
        mode: "Door to Door" | "Bus Stop" | null;
        busNumber: "1" | "2" | "3" | null;
        busStop: string | null;
        doorToDoorAddress: string | null;
      } => {
        if (!transportationRequired || !dayEnabled[dayKey]) {
          return {
            mode: null,
            busNumber: null,
            busStop: null,
            doorToDoorAddress: null
          };
        }

        const modePick = hashFromKey(`transport-slot:${member.id}:${dayKey}:${shift}`) % 3;
        const mode: "Door to Door" | "Bus Stop" | null =
          modePick === 0 ? "Bus Stop" : modePick === 1 ? "Door to Door" : null;
        if (mode === "Bus Stop") {
          const busNumber = String((hashFromKey(`transport-bus:${member.id}:${dayKey}:${shift}`) % 3) + 1) as "1" | "2" | "3";
          const busStop = busStopPool[hashFromKey(`transport-stop:${member.id}:${dayKey}:${shift}`) % busStopPool.length];
          return {
            mode,
            busNumber,
            busStop,
            doorToDoorAddress: null
          };
        }
        if (mode === "Door to Door") {
          return {
            mode,
            busNumber: null,
            busStop: null,
            doorToDoorAddress: defaultDoorToDoorAddress
          };
        }
        return {
          mode: null,
          busNumber: null,
          busStop: null,
          doorToDoorAddress: null
        };
      };

      const mondayAm = buildSlot("monday", "AM");
      const mondayPm = buildSlot("monday", "PM");
      const tuesdayAm = buildSlot("tuesday", "AM");
      const tuesdayPm = buildSlot("tuesday", "PM");
      const wednesdayAm = buildSlot("wednesday", "AM");
      const wednesdayPm = buildSlot("wednesday", "PM");
      const thursdayAm = buildSlot("thursday", "AM");
      const thursdayPm = buildSlot("thursday", "PM");
      const fridayAm = buildSlot("friday", "AM");
      const fridayPm = buildSlot("friday", "PM");
      const firstMode =
        mondayAm.mode ??
        mondayPm.mode ??
        tuesdayAm.mode ??
        tuesdayPm.mode ??
        wednesdayAm.mode ??
        wednesdayPm.mode ??
        thursdayAm.mode ??
        thursdayPm.mode ??
        fridayAm.mode ??
        fridayPm.mode;
      const firstBusNumber =
        mondayAm.busNumber ??
        mondayPm.busNumber ??
        tuesdayAm.busNumber ??
        tuesdayPm.busNumber ??
        wednesdayAm.busNumber ??
        wednesdayPm.busNumber ??
        thursdayAm.busNumber ??
        thursdayPm.busNumber ??
        fridayAm.busNumber ??
        fridayPm.busNumber;
      const firstBusStop =
        mondayAm.busStop ??
        mondayPm.busStop ??
        tuesdayAm.busStop ??
        tuesdayPm.busStop ??
        wednesdayAm.busStop ??
        wednesdayPm.busStop ??
        thursdayAm.busStop ??
        thursdayPm.busStop ??
        fridayAm.busStop ??
        fridayPm.busStop;
      const attendanceDaysPerWeek = [monday, tuesday, wednesday, thursday, friday].filter(Boolean).length;
      const defaultDailyRate = getStandardDailyRateForAttendanceDays(attendanceDaysPerWeek);

      existingByMember.set(member.id, {
        id: `member-attendance-${member.id}`,
        member_id: member.id,
        enrollment_date: member.enrollment_date ?? null,
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        full_day: true,
        transportation_required: transportationRequired,
        transportation_mode: firstMode,
        transport_bus_number: firstMode === "Bus Stop" ? firstBusNumber : null,
        transportation_bus_stop: firstMode === "Bus Stop" ? firstBusStop : null,
        transport_monday_period: mondayAm.mode ? "AM" : mondayPm.mode ? "PM" : null,
        transport_tuesday_period: tuesdayAm.mode ? "AM" : tuesdayPm.mode ? "PM" : null,
        transport_wednesday_period: wednesdayAm.mode ? "AM" : wednesdayPm.mode ? "PM" : null,
        transport_thursday_period: thursdayAm.mode ? "AM" : thursdayPm.mode ? "PM" : null,
        transport_friday_period: fridayAm.mode ? "AM" : fridayPm.mode ? "PM" : null,
        transport_monday_am_mode: mondayAm.mode,
        transport_monday_am_door_to_door_address: mondayAm.doorToDoorAddress,
        transport_monday_am_bus_number: mondayAm.busNumber,
        transport_monday_am_bus_stop: mondayAm.busStop,
        transport_monday_pm_mode: mondayPm.mode,
        transport_monday_pm_door_to_door_address: mondayPm.doorToDoorAddress,
        transport_monday_pm_bus_number: mondayPm.busNumber,
        transport_monday_pm_bus_stop: mondayPm.busStop,
        transport_tuesday_am_mode: tuesdayAm.mode,
        transport_tuesday_am_door_to_door_address: tuesdayAm.doorToDoorAddress,
        transport_tuesday_am_bus_number: tuesdayAm.busNumber,
        transport_tuesday_am_bus_stop: tuesdayAm.busStop,
        transport_tuesday_pm_mode: tuesdayPm.mode,
        transport_tuesday_pm_door_to_door_address: tuesdayPm.doorToDoorAddress,
        transport_tuesday_pm_bus_number: tuesdayPm.busNumber,
        transport_tuesday_pm_bus_stop: tuesdayPm.busStop,
        transport_wednesday_am_mode: wednesdayAm.mode,
        transport_wednesday_am_door_to_door_address: wednesdayAm.doorToDoorAddress,
        transport_wednesday_am_bus_number: wednesdayAm.busNumber,
        transport_wednesday_am_bus_stop: wednesdayAm.busStop,
        transport_wednesday_pm_mode: wednesdayPm.mode,
        transport_wednesday_pm_door_to_door_address: wednesdayPm.doorToDoorAddress,
        transport_wednesday_pm_bus_number: wednesdayPm.busNumber,
        transport_wednesday_pm_bus_stop: wednesdayPm.busStop,
        transport_thursday_am_mode: thursdayAm.mode,
        transport_thursday_am_door_to_door_address: thursdayAm.doorToDoorAddress,
        transport_thursday_am_bus_number: thursdayAm.busNumber,
        transport_thursday_am_bus_stop: thursdayAm.busStop,
        transport_thursday_pm_mode: thursdayPm.mode,
        transport_thursday_pm_door_to_door_address: thursdayPm.doorToDoorAddress,
        transport_thursday_pm_bus_number: thursdayPm.busNumber,
        transport_thursday_pm_bus_stop: thursdayPm.busStop,
        transport_friday_am_mode: fridayAm.mode,
        transport_friday_am_door_to_door_address: fridayAm.doorToDoorAddress,
        transport_friday_am_bus_number: fridayAm.busNumber,
        transport_friday_am_bus_stop: fridayAm.busStop,
        transport_friday_pm_mode: fridayPm.mode,
        transport_friday_pm_door_to_door_address: fridayPm.doorToDoorAddress,
        transport_friday_pm_bus_number: fridayPm.busNumber,
        transport_friday_pm_bus_stop: fridayPm.busStop,
        daily_rate: defaultDailyRate,
        transportation_billing_status: "BillNormally",
        billing_rate_effective_date: member.enrollment_date ?? null,
        billing_notes: null,
        attendance_days_per_week: attendanceDaysPerWeek,
        default_daily_rate: defaultDailyRate,
        use_custom_daily_rate: false,
        custom_daily_rate: null,
        make_up_days_available: hashFromKey(`transport-makeup:${member.id}`) % 3,
        attendance_notes: null,
        updated_by_user_id: null,
        updated_by_name: null,
        created_at: toEasternISO(),
        updated_at: toEasternISO()
      });
    });

    db.memberAttendanceSchedules = Array.from(existingByMember.values());

    db.memberAttendanceSchedules = db.memberAttendanceSchedules.map((row) => {
      const source = row as unknown as Record<string, unknown>;
      const rawMonday = Boolean(row.monday);
      const rawTuesday = Boolean(row.tuesday);
      const rawWednesday = Boolean(row.wednesday);
      const rawThursday = Boolean(row.thursday);
      const rawFriday = Boolean(row.friday);
      const hasAnyDay = rawMonday || rawTuesday || rawWednesday || rawThursday || rawFriday;
      const monday = hasAnyDay ? rawMonday : true;
      const tuesday = hasAnyDay ? rawTuesday : false;
      const wednesday = hasAnyDay ? rawWednesday : true;
      const thursday = hasAnyDay ? rawThursday : false;
      const friday = hasAnyDay ? rawFriday : true;
      const dayEnabled: Record<WeekdayKey, boolean> = { monday, tuesday, wednesday, thursday, friday };
      const attendanceDaysPerWeek = [monday, tuesday, wednesday, thursday, friday].filter(Boolean).length;
      const sourceDefaultDailyRate = Number(source.default_daily_rate);
      const defaultDailyRate =
        Number.isFinite(sourceDefaultDailyRate) && sourceDefaultDailyRate > 0
          ? sourceDefaultDailyRate
          : getStandardDailyRateForAttendanceDays(attendanceDaysPerWeek);
      const useCustomDailyRate = typeof source.use_custom_daily_rate === "boolean" ? source.use_custom_daily_rate : false;
      const sourceCustomDailyRate = source.custom_daily_rate == null ? null : Number(source.custom_daily_rate);
      const customDailyRate =
        sourceCustomDailyRate == null || (Number.isFinite(sourceCustomDailyRate) && sourceCustomDailyRate > 0)
          ? sourceCustomDailyRate
          : null;
      const sourceDailyRate = Number(source.daily_rate);
      const resolvedDailyRate =
        Number.isFinite(sourceDailyRate) && sourceDailyRate > 0
          ? sourceDailyRate
          : customDailyRate ?? defaultDailyRate;
      const transportationBillingStatus =
        source.transportation_billing_status === "Waived" || source.transportation_billing_status === "IncludedInProgramRate"
          ? source.transportation_billing_status
          : "BillNormally";
      const legacyMode = normalizeTransportMode(row.transportation_mode);
      const legacyBusNumber = normalizeTransportBusNumber(row.transport_bus_number);
      const legacyBusStop = row.transportation_bus_stop ?? null;
      const commandCenter = db.memberCommandCenters.find((entry) => entry.member_id === row.member_id);
      const defaultDoorToDoorAddress = [commandCenter?.street_address, commandCenter?.city, commandCenter?.state, commandCenter?.zip]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .join(", ") || null;
      const transportationRequired =
        typeof row.transportation_required === "boolean"
          ? row.transportation_required
          : hashFromKey(`transport-required-existing:${row.member_id}`) % 10 < 8;

      const slotsByDay = dayKeys.reduce((acc, dayKey) => {
        const period = normalizeTransportPeriod(source[`transport_${dayKey}_period`]);
        const enabled = dayEnabled[dayKey] && transportationRequired;
        const amMode =
          normalizeTransportMode(source[`transport_${dayKey}_am_mode`]) ??
          (enabled
            ? period === "AM"
              ? legacyMode
              : period == null
                ? legacyMode
                : null
            : null);
        const pmMode =
          normalizeTransportMode(source[`transport_${dayKey}_pm_mode`]) ??
          (enabled
            ? period === "PM"
              ? legacyMode
              : null
            : null);
        const amBusNumber =
          amMode === "Bus Stop"
            ? normalizeTransportBusNumber(source[`transport_${dayKey}_am_bus_number`]) ??
              (period === "AM" || period == null ? legacyBusNumber : null)
            : null;
        const pmBusNumber =
          pmMode === "Bus Stop"
            ? normalizeTransportBusNumber(source[`transport_${dayKey}_pm_bus_number`]) ??
              (period === "PM" ? legacyBusNumber : null)
            : null;
        const amBusStop =
          amMode === "Bus Stop"
            ? (source[`transport_${dayKey}_am_bus_stop`] as string | null | undefined) ??
              (period === "AM" || period == null ? legacyBusStop : null)
            : null;
        const pmBusStop =
          pmMode === "Bus Stop"
            ? (source[`transport_${dayKey}_pm_bus_stop`] as string | null | undefined) ??
              (period === "PM" ? legacyBusStop : null)
            : null;

        const amDoorToDoorAddress =
          amMode === "Door to Door"
            ? ((source[`transport_${dayKey}_am_door_to_door_address`] as string | null | undefined) ?? defaultDoorToDoorAddress)
            : null;
        const pmDoorToDoorAddress =
          pmMode === "Door to Door"
            ? ((source[`transport_${dayKey}_pm_door_to_door_address`] as string | null | undefined) ?? defaultDoorToDoorAddress)
            : null;

        acc[dayKey] = {
          amMode: enabled ? amMode : null,
          amDoorToDoorAddress: enabled ? amDoorToDoorAddress : null,
          amBusNumber: enabled ? amBusNumber : null,
          amBusStop: enabled ? amBusStop : null,
          pmMode: enabled ? pmMode : null,
          pmDoorToDoorAddress: enabled ? pmDoorToDoorAddress : null,
          pmBusNumber: enabled ? pmBusNumber : null,
          pmBusStop: enabled ? pmBusStop : null
        };
        return acc;
      }, {} as Record<WeekdayKey, {
        amMode: "Door to Door" | "Bus Stop" | null;
        amDoorToDoorAddress: string | null;
        amBusNumber: "1" | "2" | "3" | null;
        amBusStop: string | null;
        pmMode: "Door to Door" | "Bus Stop" | null;
        pmDoorToDoorAddress: string | null;
        pmBusNumber: "1" | "2" | "3" | null;
        pmBusStop: string | null;
      }>);

      const firstMode = dayKeys
        .map((dayKey) => slotsByDay[dayKey].amMode ?? slotsByDay[dayKey].pmMode)
        .find((mode): mode is "Door to Door" | "Bus Stop" => mode === "Door to Door" || mode === "Bus Stop") ?? null;
      const firstBusNumber = dayKeys
        .map((dayKey) => slotsByDay[dayKey].amBusNumber ?? slotsByDay[dayKey].pmBusNumber)
        .find((value): value is "1" | "2" | "3" => value === "1" || value === "2" || value === "3") ?? null;
      const firstBusStop = dayKeys
        .map((dayKey) => slotsByDay[dayKey].amBusStop ?? slotsByDay[dayKey].pmBusStop)
        .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;

      return {
        ...row,
        enrollment_date: row.enrollment_date ?? null,
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        full_day: typeof row.full_day === "boolean" ? row.full_day : true,
        transportation_required: transportationRequired,
        transportation_mode: firstMode,
        transport_bus_number: firstMode === "Bus Stop" ? firstBusNumber : null,
        transportation_bus_stop: firstMode === "Bus Stop" ? firstBusStop : null,
        transport_monday_period: slotsByDay.monday.amMode ? "AM" : slotsByDay.monday.pmMode ? "PM" : null,
        transport_tuesday_period: slotsByDay.tuesday.amMode ? "AM" : slotsByDay.tuesday.pmMode ? "PM" : null,
        transport_wednesday_period: slotsByDay.wednesday.amMode ? "AM" : slotsByDay.wednesday.pmMode ? "PM" : null,
        transport_thursday_period: slotsByDay.thursday.amMode ? "AM" : slotsByDay.thursday.pmMode ? "PM" : null,
        transport_friday_period: slotsByDay.friday.amMode ? "AM" : slotsByDay.friday.pmMode ? "PM" : null,
        transport_monday_am_mode: slotsByDay.monday.amMode,
        transport_monday_am_door_to_door_address: slotsByDay.monday.amDoorToDoorAddress,
        transport_monday_am_bus_number: slotsByDay.monday.amBusNumber,
        transport_monday_am_bus_stop: slotsByDay.monday.amBusStop,
        transport_monday_pm_mode: slotsByDay.monday.pmMode,
        transport_monday_pm_door_to_door_address: slotsByDay.monday.pmDoorToDoorAddress,
        transport_monday_pm_bus_number: slotsByDay.monday.pmBusNumber,
        transport_monday_pm_bus_stop: slotsByDay.monday.pmBusStop,
        transport_tuesday_am_mode: slotsByDay.tuesday.amMode,
        transport_tuesday_am_door_to_door_address: slotsByDay.tuesday.amDoorToDoorAddress,
        transport_tuesday_am_bus_number: slotsByDay.tuesday.amBusNumber,
        transport_tuesday_am_bus_stop: slotsByDay.tuesday.amBusStop,
        transport_tuesday_pm_mode: slotsByDay.tuesday.pmMode,
        transport_tuesday_pm_door_to_door_address: slotsByDay.tuesday.pmDoorToDoorAddress,
        transport_tuesday_pm_bus_number: slotsByDay.tuesday.pmBusNumber,
        transport_tuesday_pm_bus_stop: slotsByDay.tuesday.pmBusStop,
        transport_wednesday_am_mode: slotsByDay.wednesday.amMode,
        transport_wednesday_am_door_to_door_address: slotsByDay.wednesday.amDoorToDoorAddress,
        transport_wednesday_am_bus_number: slotsByDay.wednesday.amBusNumber,
        transport_wednesday_am_bus_stop: slotsByDay.wednesday.amBusStop,
        transport_wednesday_pm_mode: slotsByDay.wednesday.pmMode,
        transport_wednesday_pm_door_to_door_address: slotsByDay.wednesday.pmDoorToDoorAddress,
        transport_wednesday_pm_bus_number: slotsByDay.wednesday.pmBusNumber,
        transport_wednesday_pm_bus_stop: slotsByDay.wednesday.pmBusStop,
        transport_thursday_am_mode: slotsByDay.thursday.amMode,
        transport_thursday_am_door_to_door_address: slotsByDay.thursday.amDoorToDoorAddress,
        transport_thursday_am_bus_number: slotsByDay.thursday.amBusNumber,
        transport_thursday_am_bus_stop: slotsByDay.thursday.amBusStop,
        transport_thursday_pm_mode: slotsByDay.thursday.pmMode,
        transport_thursday_pm_door_to_door_address: slotsByDay.thursday.pmDoorToDoorAddress,
        transport_thursday_pm_bus_number: slotsByDay.thursday.pmBusNumber,
        transport_thursday_pm_bus_stop: slotsByDay.thursday.pmBusStop,
        transport_friday_am_mode: slotsByDay.friday.amMode,
        transport_friday_am_door_to_door_address: slotsByDay.friday.amDoorToDoorAddress,
        transport_friday_am_bus_number: slotsByDay.friday.amBusNumber,
        transport_friday_am_bus_stop: slotsByDay.friday.amBusStop,
        transport_friday_pm_mode: slotsByDay.friday.pmMode,
        transport_friday_pm_door_to_door_address: slotsByDay.friday.pmDoorToDoorAddress,
        transport_friday_pm_bus_number: slotsByDay.friday.pmBusNumber,
        transport_friday_pm_bus_stop: slotsByDay.friday.pmBusStop,
        daily_rate: resolvedDailyRate,
        transportation_billing_status: transportationBillingStatus,
        billing_rate_effective_date: (source.billing_rate_effective_date as string | null) ?? row.enrollment_date ?? null,
        billing_notes: (source.billing_notes as string | null) ?? null,
        attendance_days_per_week: attendanceDaysPerWeek,
        default_daily_rate: defaultDailyRate,
        use_custom_daily_rate: useCustomDailyRate,
        custom_daily_rate: customDailyRate,
        make_up_days_available: typeof row.make_up_days_available === "number" ? row.make_up_days_available : null,
        attendance_notes: row.attendance_notes ?? null,
        updated_by_user_id: row.updated_by_user_id ?? null,
        updated_by_name: row.updated_by_name ?? null,
        created_at: row.created_at ?? toEasternISO(),
        updated_at: row.updated_at ?? toEasternISO()
      };
    });
  }

  if (Array.isArray(db.memberHolds)) {
    const fallbackStaff = db.staff[0] ?? seededDb.staff[0] ?? null;
    db.memberHolds = db.memberHolds
      .map((row): MockDb["memberHolds"][number] => {
        const startDateRaw = String(row.start_date ?? "").trim();
        const endDateRaw = String(row.end_date ?? "").trim();
        const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateRaw)
          ? startDateRaw
          : toEasternDate(startDateRaw || toEasternDate());
        const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateRaw) ? endDateRaw : endDateRaw ? toEasternDate(endDateRaw) : null;
        const status = row.status === "ended" ? "ended" : "active";
        return {
          ...row,
          member_id: String(row.member_id ?? ""),
          start_date: startDate,
          end_date: endDate,
          status,
          reason: String(row.reason ?? "").trim() || "Other",
          reason_other: row.reason_other ?? null,
          notes: row.notes ?? null,
          created_by_user_id:
            typeof row.created_by_user_id === "string" && row.created_by_user_id.trim().length > 0
              ? row.created_by_user_id
              : (fallbackStaff?.id ?? "system"),
          created_by_name:
            typeof row.created_by_name === "string" && row.created_by_name.trim().length > 0
              ? row.created_by_name
              : (fallbackStaff?.full_name ?? "System"),
          created_at: String(row.created_at ?? toEasternISO()),
          updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
          ended_at: row.ended_at ?? null,
          ended_by_user_id: row.ended_by_user_id ?? null,
          ended_by_name: row.ended_by_name ?? null
        };
      })
      .filter((row) => row.member_id.trim().length > 0)
      .sort((left, right) => {
        if (left.member_id === right.member_id) return left.start_date < right.start_date ? 1 : -1;
        return left.member_id.localeCompare(right.member_id, undefined, { sensitivity: "base" });
      });
  }

  if (Array.isArray(db.transportationManifestAdjustments)) {
    const fallbackStaff = db.staff[0] ?? seededDb.staff[0] ?? null;
    db.transportationManifestAdjustments = db.transportationManifestAdjustments
      .map((row): MockDb["transportationManifestAdjustments"][number] => ({
        ...row,
        selected_date:
          typeof row.selected_date === "string" && row.selected_date.trim().length > 0
            ? row.selected_date.trim()
            : toEasternDate(row.created_at ?? toEasternISO()),
        shift: (row.shift === "PM" ? "PM" : "AM") as "AM" | "PM",
        member_id: String(row.member_id ?? ""),
        adjustment_type: (row.adjustment_type === "exclude" ? "exclude" : "add") as "add" | "exclude",
        bus_number: row.bus_number === "1" || row.bus_number === "2" || row.bus_number === "3" ? row.bus_number : null,
        transport_type: row.transport_type === "Bus Stop" || row.transport_type === "Door to Door" ? row.transport_type : null,
        bus_stop_name: normalizeBusStopName(row.bus_stop_name) ?? null,
        door_to_door_address: (row.door_to_door_address ?? null) as string | null,
        caregiver_contact_id: (row.caregiver_contact_id ?? null) as string | null,
        caregiver_contact_name_snapshot: (row.caregiver_contact_name_snapshot ?? null) as string | null,
        caregiver_contact_phone_snapshot: (row.caregiver_contact_phone_snapshot ?? null) as string | null,
        caregiver_contact_address_snapshot: (row.caregiver_contact_address_snapshot ?? null) as string | null,
        notes: (row.notes ?? null) as string | null,
        created_by_user_id:
          typeof row.created_by_user_id === "string" && row.created_by_user_id.trim().length > 0
            ? row.created_by_user_id
            : (fallbackStaff?.id ?? ""),
        created_by_name:
          typeof row.created_by_name === "string" && row.created_by_name.trim().length > 0
            ? row.created_by_name
            : (fallbackStaff?.full_name ?? "Unknown Staff"),
        created_at: String(row.created_at ?? toEasternISO())
      }))
      .filter((row) => row.member_id.trim().length > 0 && row.selected_date.trim().length > 0);
  }

  if (Array.isArray(db.memberContacts)) {
    db.memberContacts = db.memberContacts.map((row) => ({
      ...row,
      relationship_to_member: row.relationship_to_member ?? null,
      category_other: row.category_other ?? null,
      email: row.email ?? null,
      cellular_number: row.cellular_number ?? null,
      work_number: row.work_number ?? null,
      home_number: row.home_number ?? null,
      street_address: row.street_address ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      zip: row.zip ?? null,
      created_at: row.created_at ?? toEasternISO(),
      updated_at: row.updated_at ?? toEasternISO()
    }));
  }

  if (Array.isArray(db.attendanceRecords)) {
    const deduped = new Map<string, MockDb["attendanceRecords"][number]>();
    db.attendanceRecords.forEach((row) => {
      const attendanceDateRaw = String(row.attendance_date ?? "").trim();
      const attendanceDate = /^\d{4}-\d{2}-\d{2}$/.test(attendanceDateRaw)
        ? attendanceDateRaw
        : toEasternDate(attendanceDateRaw || toEasternDate());
      // Older persisted states can contain mixed-case status values; normalize to prevent absent rows from being coerced back to present.
      const normalizedStatus = String(row.status ?? "").trim().toLowerCase();
      const status = normalizedStatus === "absent" ? "absent" : "present";
      const normalized = {
        ...row,
        member_id: String(row.member_id ?? ""),
        attendance_date: attendanceDate,
        status,
        check_in_at: row.check_in_at ?? null,
        check_out_at: row.check_out_at ?? null,
        notes: row.notes ?? null,
        scheduled_day: typeof row.scheduled_day === "boolean" ? row.scheduled_day : null,
        unscheduled_day: typeof row.unscheduled_day === "boolean" ? row.unscheduled_day : null,
        billable_extra_day: typeof row.billable_extra_day === "boolean" ? row.billable_extra_day : null,
        billing_status:
          row.billing_status === "Billed" || row.billing_status === "Excluded" ? row.billing_status : "Unbilled",
        linked_adjustment_id: row.linked_adjustment_id ?? null,
        recorded_by_user_id: String(row.recorded_by_user_id ?? ""),
        recorded_by_name: String(row.recorded_by_name ?? "Unknown Staff"),
        created_at: String(row.created_at ?? toEasternISO()),
        updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO())
      } satisfies MockDb["attendanceRecords"][number];

      if (!normalized.member_id) return;

      const key = `${normalized.member_id}:${normalized.attendance_date}`;
      const existing = deduped.get(key);
      if (!existing || normalized.updated_at > existing.updated_at) {
        deduped.set(key, normalized);
      }
    });

    db.attendanceRecords = Array.from(deduped.values()).sort((left, right) => {
      if (left.attendance_date === right.attendance_date) {
        return left.member_id.localeCompare(right.member_id, undefined, { sensitivity: "base" });
      }
      return left.attendance_date > right.attendance_date ? -1 : 1;
    });
  }

  if (Array.isArray(db.transportationLogs)) {
    const activeCenterSettings =
      db.centerBillingSettings.find((row) => row.active && !row.effective_end_date) ??
      db.centerBillingSettings.find((row) => row.active) ??
      seededDb.centerBillingSettings[0] ??
      null;
    const oneWayRate = Number.isFinite(activeCenterSettings?.default_transport_one_way_rate)
      ? Number(activeCenterSettings?.default_transport_one_way_rate)
      : 10;
    const roundTripRate = Number.isFinite(activeCenterSettings?.default_transport_round_trip_rate)
      ? Number(activeCenterSettings?.default_transport_round_trip_rate)
      : 20;

    db.transportationLogs = db.transportationLogs.map((row) => {
      const normalizedTransportType = String(row.transport_type ?? "").trim().toLowerCase();
      const inferredTripType =
        row.trip_type === "OneWay" || row.trip_type === "RoundTrip" || row.trip_type === "Other"
          ? row.trip_type
          : normalizedTransportType.includes("round")
            ? "RoundTrip"
            : normalizedTransportType.length > 0
              ? "OneWay"
              : "Other";
      const quantity = Number.isFinite(row.quantity) && Number(row.quantity) > 0 ? Number(row.quantity) : 1;
      const unitRate =
        Number.isFinite(row.unit_rate) && Number(row.unit_rate) >= 0
          ? Number(row.unit_rate)
          : inferredTripType === "RoundTrip"
            ? roundTripRate
            : oneWayRate;
      const totalAmount =
        Number.isFinite(row.total_amount) && Number(row.total_amount) >= 0
          ? Number(row.total_amount)
          : unitRate * quantity;
      const billable = typeof row.billable === "boolean" ? row.billable : true;
      const billingStatus =
        row.billing_status === "Billed" || row.billing_status === "Excluded"
          ? row.billing_status
          : billable
            ? "Unbilled"
            : "Excluded";

      return {
        ...row,
        trip_type: inferredTripType,
        quantity,
        unit_rate: unitRate,
        total_amount: totalAmount,
        billable,
        billing_status: billingStatus,
        billing_exclusion_reason: row.billing_exclusion_reason ?? (billable ? null : "Non-billable member transport rule"),
        invoice_id: row.invoice_id ?? null
      };
    });
  }

  if (Array.isArray(db.memberFiles)) {
    db.memberFiles = db.memberFiles.map((row) => ({
      ...row,
      file_data_url: row.file_data_url ?? null,
      category_other: row.category_other ?? null,
      document_source: row.document_source ?? null,
      uploaded_at: row.uploaded_at ?? toEasternISO(),
      updated_at: row.updated_at ?? row.uploaded_at ?? toEasternISO()
    }));
  }

  if (Array.isArray(db.memberProviders)) {
    db.memberProviders = db.memberProviders.map((row) => ({
      ...row,
      specialty: row.specialty ?? null,
      specialty_other: row.specialty_other ?? null
    }));
  }

  if (Array.isArray(db.memberMedications)) {
    db.memberMedications = db.memberMedications.map((row) => ({
      ...row,
      date_started: row.date_started ?? (row.created_at ? row.created_at.slice(0, 10) : toEasternDate()),
      medication_status: row.medication_status === "inactive" ? "inactive" : "active",
      inactivated_at: row.inactivated_at ?? null,
      route_laterality: row.route_laterality ?? null
    }));
  }

  if (db.memberProviders.length === 0 && db.memberHealthProfiles.length > 0) {
    db.memberProviders = db.memberHealthProfiles
      .filter((profile) => Boolean(profile.provider_name))
      .map((profile, idx) => ({
        id: `mhp-provider-bootstrap-${idx + 1}`,
        member_id: profile.member_id,
        provider_name: profile.provider_name ?? "Provider",
        specialty: null,
        specialty_other: null,
        practice_name: null,
        provider_phone: profile.provider_phone ?? null,
        created_by_user_id: "system",
        created_by_name: "System Migration",
        created_at: toEasternISO(),
        updated_at: toEasternISO()
      }));
  }

  if (db.providerDirectory.length === 0 && db.memberProviders.length > 0) {
    const now = toEasternISO();
    db.providerDirectory = Array.from(
      new Map(
        db.memberProviders.map((provider) => [
          provider.provider_name.trim().toLowerCase(),
          {
            id: `provider-directory-bootstrap-${provider.provider_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            provider_name: provider.provider_name,
            specialty: provider.specialty ?? null,
            specialty_other: provider.specialty_other ?? null,
            practice_name: provider.practice_name ?? null,
            provider_phone: provider.provider_phone ?? null,
            created_by_user_id: provider.created_by_user_id,
            created_by_name: provider.created_by_name,
            created_at: provider.created_at ?? now,
            updated_at: provider.updated_at ?? now
          }
        ])
      ).values()
    );
  }

  if (db.hospitalPreferenceDirectory.length === 0 && db.memberHealthProfiles.length > 0) {
    const now = toEasternISO();
    db.hospitalPreferenceDirectory = Array.from(
      new Map(
        db.memberHealthProfiles
          .map((profile) => (profile.hospital_preference ?? "").trim())
          .filter((hospitalName) => hospitalName.length > 0)
          .map((hospitalName) => [
            hospitalName.toLowerCase(),
            {
              id: hospitalPreferenceDirectoryIdFromName(hospitalName),
              hospital_name: hospitalName,
              created_by_user_id: "system",
              created_by_name: "System Migration",
              created_at: now,
              updated_at: now
            }
          ])
      ).values()
    ).sort((a, b) => a.hospital_name.localeCompare(b.hospital_name, undefined, { sensitivity: "base" }));
  }

  {
    const now = toEasternISO();
    const busStopsFromSchedules = collectBusStopNamesFromSchedules(db.memberAttendanceSchedules);
    const existingDirectoryByName = new Map(
      db.busStopDirectory
        .map((entry) => {
          const normalizedName = normalizeBusStopName(entry.bus_stop_name);
          if (!normalizedName) return null;
          return [
            normalizedName.toLowerCase(),
            {
              ...entry,
              bus_stop_name: normalizedName,
              created_by_user_id: entry.created_by_user_id ?? "system",
              created_by_name: entry.created_by_name ?? "System",
              created_at: entry.created_at ?? now,
              updated_at: entry.updated_at ?? now
            }
          ] as const;
        })
        .filter((entry): entry is readonly [string, MockDb["busStopDirectory"][number]] => Boolean(entry))
    );

    busStopsFromSchedules.forEach((busStopName) => {
      const key = busStopName.toLowerCase();
      if (existingDirectoryByName.has(key)) return;
      existingDirectoryByName.set(key, {
        id: busStopDirectoryIdFromName(busStopName),
        bus_stop_name: busStopName,
        created_by_user_id: "system",
        created_by_name: "System Migration",
        created_at: now,
        updated_at: now
      });
    });

    db.busStopDirectory = Array.from(existingDirectoryByName.values()).sort((a, b) =>
      a.bus_stop_name.localeCompare(b.bus_stop_name, undefined, { sensitivity: "base" })
    );
  }

  if (!Array.isArray(db.auditLogs) || db.auditLogs.length === 0) {
    db.auditLogs = buildBaselineAuditLogs(db);
  }

  if (!Array.isArray(db.leadStageHistory) || db.leadStageHistory.length === 0) {
    db.leadStageHistory = db.leads.map((lead, idx) => ({
      id: `leadStageHistory-${idx + 1}`,
      lead_id: lead.id,
      from_stage: null,
      to_stage: lead.stage,
      from_status: null,
      to_status: lead.status,
      changed_at: lead.created_at,
      changed_by_user_id: lead.created_by_user_id,
      changed_by_name: lead.created_by_name,
      reason: "Seeded from existing lead state",
      source: "mock-repo-normalize"
    }));
  }

  const existingAncillaryCategories = Array.isArray(db.ancillaryCategories) ? db.ancillaryCategories : [];
  const oldTransportationCategoryIds = new Set(
    existingAncillaryCategories
      .filter((category) => (category.name ?? "").trim().toLowerCase() === "transportation")
      .map((category) => category.id)
  );
  const existingCategoriesByNormalizedName = new Map(
    existingAncillaryCategories.map((category) => [(category.name ?? "").trim().toLowerCase(), category] as const)
  );
  const seededCategoriesByName = new Map(
    seededDb.ancillaryCategories.map((category) => [category.name, category] as const)
  );
  const canonicalAncillaryCategories = ANCILLARY_CHARGE_CATALOG.map((entry) => {
    const existing = existingCategoriesByNormalizedName.get(entry.name.toLowerCase());
    const seeded = seededCategoriesByName.get(entry.name);
    return {
      id: existing?.id ?? seeded?.id ?? `ancillary-category-${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: entry.name,
      price_cents:
        normalizePriceCents(existing?.price_cents) ??
        normalizePriceCents(seeded?.price_cents) ??
        entry.price_cents
    };
  });
  const canonicalCategoryNames = new Set(
    canonicalAncillaryCategories.map((category) => category.name.trim().toLowerCase())
  );
  const extraCategories = existingAncillaryCategories
    .map((category) => {
      const normalizedName = normalizeAncillaryCategoryName(category.name);
      return {
        ...category,
        name: normalizedName ?? category.name
      };
    })
    .filter(
      (category) =>
        (category.name ?? "").trim().length > 0 &&
        (category.name ?? "").trim().toLowerCase() !== "transportation" &&
        !canonicalCategoryNames.has((category.name ?? "").trim().toLowerCase())
    )
    .map((category) => ({
      id: category.id,
      name: category.name,
      price_cents: normalizePriceCents(category.price_cents) ?? 0
    }));
  db.ancillaryCategories = [...canonicalAncillaryCategories, ...extraCategories];

  if (Array.isArray(db.ancillaryLogs)) {
    const categoriesById = new Map(db.ancillaryCategories.map((category) => [category.id, category] as const));
    const categoriesByName = new Map(
      db.ancillaryCategories.map((category) => [category.name.trim().toLowerCase(), category] as const)
    );
    const transportBusStopCategory = categoriesByName.get("transport - bus stop") ?? null;

    db.ancillaryLogs = db.ancillaryLogs.map((row) => {
      const quantity = Number.isFinite(row.quantity) && Number(row.quantity) > 0 ? Number(row.quantity) : 1;
      const normalizedCategoryName = normalizeAncillaryCategoryName(row.category_name);
      let category =
        (normalizedCategoryName ? categoriesByName.get(normalizedCategoryName.toLowerCase()) : null) ??
        (row.category_id ? categoriesById.get(row.category_id) ?? null : null) ??
        null;

      if (!category && row.category_id && oldTransportationCategoryIds.has(row.category_id)) {
        category = transportBusStopCategory;
      }

      category = category ?? db.ancillaryCategories[0] ?? null;
      const isTransportCategory =
        category?.name === "Transport - Door to Door" ||
        category?.name === "Transport - Bus Stop" ||
        category?.name === "Transport - Refused/No Show";
      const parsedAmount = Number(row.amount_cents);
      const amountCents = isTransportCategory
        ? (category?.price_cents ?? 0) * quantity
        : Number.isFinite(parsedAmount)
          ? parsedAmount
          : (category?.price_cents ?? 0) * quantity;
      const unitRate =
        Number.isFinite(row.unit_rate) && Number(row.unit_rate) >= 0
          ? Number(row.unit_rate)
          : quantity > 0
            ? Number((amountCents / quantity).toFixed(2))
            : amountCents;
      const totalAmount =
        Number.isFinite(row.total_amount) && Number(row.total_amount) >= 0 ? Number(row.total_amount) : amountCents;
      const billable = typeof row.billable === "boolean" ? row.billable : true;
      const billingStatus =
        row.billing_status === "Billed" || row.billing_status === "Excluded"
          ? row.billing_status
          : billable
            ? "Unbilled"
            : "Excluded";

      return {
        ...row,
        category_id: category?.id ?? row.category_id,
        category_name: category?.name ?? normalizedCategoryName ?? row.category_name,
        charge_type: row.charge_type ?? category?.name ?? normalizedCategoryName ?? row.category_name,
        quantity,
        amount_cents: amountCents,
        charge_date: String(row.charge_date ?? row.service_date ?? toEasternDate()),
        unit_rate: unitRate,
        total_amount: totalAmount,
        billable,
        billing_status: billingStatus,
        billing_exclusion_reason: row.billing_exclusion_reason ?? (billable ? null : "Marked non-billable"),
        invoice_id: row.invoice_id ?? null,
        reconciliation_status:
          row.reconciliation_status === "reconciled" || row.reconciliation_status === "void"
            ? row.reconciliation_status
            : "open",
        reconciled_by: row.reconciled_by ?? null,
        reconciled_at: row.reconciled_at ?? null,
        reconciliation_note: row.reconciliation_note ?? null
      };
    });
  }

  if (Array.isArray(db.centerBillingSettings)) {
    db.centerBillingSettings = db.centerBillingSettings
      .map((row): MockDb["centerBillingSettings"][number] => ({
        ...row,
        default_daily_rate: Number.isFinite(row.default_daily_rate) ? Math.max(0, Number(row.default_daily_rate)) : 82,
        default_extra_day_rate:
          row.default_extra_day_rate == null || Number.isFinite(row.default_extra_day_rate)
            ? (row.default_extra_day_rate == null ? null : Math.max(0, Number(row.default_extra_day_rate)))
            : null,
        default_transport_one_way_rate: Number.isFinite(row.default_transport_one_way_rate)
          ? Math.max(0, Number(row.default_transport_one_way_rate))
          : 10,
        default_transport_round_trip_rate: Number.isFinite(row.default_transport_round_trip_rate)
          ? Math.max(0, Number(row.default_transport_round_trip_rate))
          : 20,
        billing_cutoff_day: Number.isFinite(row.billing_cutoff_day) ? Math.min(31, Math.max(1, Math.round(Number(row.billing_cutoff_day)))) : 25,
        default_billing_mode: row.default_billing_mode === "Monthly" ? "Monthly" : "Membership",
        effective_start_date: String(row.effective_start_date ?? toEasternDate()),
        effective_end_date: row.effective_end_date ?? null,
        active: typeof row.active === "boolean" ? row.active : true,
        created_at: String(row.created_at ?? toEasternISO()),
        updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
        updated_by_user_id: row.updated_by_user_id ?? null,
        updated_by_name: row.updated_by_name ?? null
      }))
      .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1));
  }

  if (Array.isArray(db.closureRules)) {
    db.closureRules = db.closureRules
      .map((row): MockDb["closureRules"][number] => {
        const ruleType: MockDb["closureRules"][number]["rule_type"] =
          row.rule_type === "nth_weekday" ? "nth_weekday" : "fixed";
        const weekday: MockDb["closureRules"][number]["weekday"] =
          row.weekday === "sunday" ||
          row.weekday === "monday" ||
          row.weekday === "tuesday" ||
          row.weekday === "wednesday" ||
          row.weekday === "thursday" ||
          row.weekday === "friday" ||
          row.weekday === "saturday"
            ? row.weekday
            : null;
        const occurrence: MockDb["closureRules"][number]["occurrence"] =
          row.occurrence === "first" ||
          row.occurrence === "second" ||
          row.occurrence === "third" ||
          row.occurrence === "fourth" ||
          row.occurrence === "last"
            ? row.occurrence
            : null;
        return {
          ...row,
          name: String(row.name ?? "Closure Rule"),
          rule_type: ruleType,
          month: Number.isFinite(row.month) ? Math.min(12, Math.max(1, Math.round(Number(row.month)))) : 1,
          day: row.day == null || Number.isFinite(row.day) ? (row.day == null ? null : Math.min(31, Math.max(1, Math.round(Number(row.day))))) : null,
          weekday,
          occurrence,
          observed_when_weekend:
            row.observed_when_weekend === "friday" ||
            row.observed_when_weekend === "monday" ||
            row.observed_when_weekend === "nearest_weekday"
              ? row.observed_when_weekend
              : "none",
          active: typeof row.active === "boolean" ? row.active : true,
          created_at: String(row.created_at ?? toEasternISO()),
          updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
          updated_by_user_id: row.updated_by_user_id ?? null,
          updated_by_name: row.updated_by_name ?? null
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }

  if (Array.isArray(db.centerClosures)) {
    db.centerClosures = db.centerClosures
      .map((row) => {
        const closureType: MockDb["centerClosures"][number]["closure_type"] =
          row.closure_type === "Weather" ||
          row.closure_type === "Planned" ||
          row.closure_type === "Emergency" ||
          row.closure_type === "Other"
            ? row.closure_type
            : "Holiday";
        return {
          ...row,
          closure_date: String(row.closure_date ?? toEasternDate()),
          closure_name: String(row.closure_name ?? "Center Closure"),
          closure_type: closureType,
          auto_generated: typeof row.auto_generated === "boolean" ? row.auto_generated : false,
          closure_rule_id: row.closure_rule_id ?? null,
          billable_override: typeof row.billable_override === "boolean" ? row.billable_override : false,
          notes: row.notes ?? null,
          active: typeof row.active === "boolean" ? row.active : true,
          created_at: String(row.created_at ?? toEasternISO()),
          updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
          updated_by_user_id: row.updated_by_user_id ?? null,
          updated_by_name: row.updated_by_name ?? null
        };
      })
      .sort((left, right) => (left.closure_date < right.closure_date ? 1 : -1));
  }

  if (Array.isArray(db.payors)) {
    db.payors = db.payors.map((row) => ({
      ...row,
      payor_name: String(row.payor_name ?? "").trim(),
      payor_type: String(row.payor_type ?? "Private"),
      billing_contact_name: row.billing_contact_name ?? null,
      billing_email: row.billing_email ?? null,
      billing_phone: row.billing_phone ?? null,
      billing_method:
        row.billing_method === "ACHDraft" ||
        row.billing_method === "CardOnFile" ||
        row.billing_method === "Manual" ||
        row.billing_method === "External"
          ? row.billing_method
          : "InvoiceEmail",
      auto_draft_enabled: typeof row.auto_draft_enabled === "boolean" ? row.auto_draft_enabled : false,
      quickbooks_customer_name: row.quickbooks_customer_name ?? null,
      quickbooks_customer_ref: row.quickbooks_customer_ref ?? null,
      status: row.status === "inactive" ? "inactive" : "active",
      notes: row.notes ?? null,
      created_at: String(row.created_at ?? toEasternISO()),
      updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
      updated_by_user_id: row.updated_by_user_id ?? null,
      updated_by_name: row.updated_by_name ?? null
    }));
  }

  if (Array.isArray(db.memberBillingSettings)) {
    db.memberBillingSettings = db.memberBillingSettings.map((row) => ({
      ...row,
      member_id: String(row.member_id ?? ""),
      payor_id: row.payor_id ?? null,
      use_center_default_billing_mode:
        typeof row.use_center_default_billing_mode === "boolean" ? row.use_center_default_billing_mode : true,
      billing_mode:
        row.billing_mode === "Membership" || row.billing_mode === "Monthly" || row.billing_mode === "Custom"
          ? row.billing_mode
          : null,
      monthly_billing_basis:
        row.monthly_billing_basis === "ActualAttendanceMonthBehind"
          ? "ActualAttendanceMonthBehind"
          : "ScheduledMonthBehind",
      use_center_default_rate: typeof row.use_center_default_rate === "boolean" ? row.use_center_default_rate : true,
      custom_daily_rate:
        row.custom_daily_rate == null || Number.isFinite(row.custom_daily_rate)
          ? (row.custom_daily_rate == null ? null : Math.max(0, Number(row.custom_daily_rate)))
          : null,
      flat_monthly_rate:
        row.flat_monthly_rate == null || Number.isFinite(row.flat_monthly_rate)
          ? (row.flat_monthly_rate == null ? null : Number(row.flat_monthly_rate))
          : null,
      bill_extra_days: typeof row.bill_extra_days === "boolean" ? row.bill_extra_days : true,
      transportation_billing_status:
        row.transportation_billing_status === "Waived" || row.transportation_billing_status === "IncludedInProgramRate"
          ? row.transportation_billing_status
          : "BillNormally",
      bill_ancillary_arrears: typeof row.bill_ancillary_arrears === "boolean" ? row.bill_ancillary_arrears : true,
      active: typeof row.active === "boolean" ? row.active : true,
      effective_start_date: String(row.effective_start_date ?? toEasternDate()),
      effective_end_date: row.effective_end_date ?? null,
      billing_notes: row.billing_notes ?? null,
      created_at: String(row.created_at ?? toEasternISO()),
      updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
      updated_by_user_id: row.updated_by_user_id ?? null,
      updated_by_name: row.updated_by_name ?? null
    }));
  }

  if (Array.isArray(db.billingScheduleTemplates)) {
    db.billingScheduleTemplates = db.billingScheduleTemplates.map((row) => ({
      ...row,
      member_id: String(row.member_id ?? ""),
      effective_start_date: String(row.effective_start_date ?? toEasternDate()),
      effective_end_date: row.effective_end_date ?? null,
      monday: Boolean(row.monday),
      tuesday: Boolean(row.tuesday),
      wednesday: Boolean(row.wednesday),
      thursday: Boolean(row.thursday),
      friday: Boolean(row.friday),
      saturday: Boolean(row.saturday),
      sunday: Boolean(row.sunday),
      active: typeof row.active === "boolean" ? row.active : true,
      notes: row.notes ?? null,
      created_at: String(row.created_at ?? toEasternISO()),
      updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
      updated_by_user_id: row.updated_by_user_id ?? null,
      updated_by_name: row.updated_by_name ?? null
    }));
  }

  if (Array.isArray(db.billingAdjustments)) {
    db.billingAdjustments = db.billingAdjustments.map((row) => {
      const qty = Number.isFinite(row.quantity) && Number(row.quantity) > 0 ? Number(row.quantity) : 1;
      const unitRate = Number.isFinite(row.unit_rate) ? Number(row.unit_rate) : 0;
      const amountFromRate = Number((qty * unitRate).toFixed(2));
      const rawAmount = Number.isFinite(row.amount) ? Number(row.amount) : amountFromRate;
      const isCreditType =
        row.adjustment_type === "Credit" ||
        row.adjustment_type === "Discount" ||
        row.adjustment_type === "Refund" ||
        row.adjustment_type === "ManualCredit";
      const amount = isCreditType ? -Math.abs(rawAmount) : rawAmount;
      return {
        ...row,
        member_id: String(row.member_id ?? ""),
        payor_id: row.payor_id ?? null,
        adjustment_date: String(row.adjustment_date ?? toEasternDate()),
        adjustment_type: row.adjustment_type ?? "Other",
        description: String(row.description ?? "Billing adjustment"),
        quantity: qty,
        unit_rate: unitRate,
        amount,
        billing_status: row.billing_status === "Billed" || row.billing_status === "Excluded" ? row.billing_status : "Unbilled",
        invoice_id: row.invoice_id ?? null,
        created_by_system: typeof row.created_by_system === "boolean" ? row.created_by_system : false,
        source_table: row.source_table ?? null,
        source_record_id: row.source_record_id ?? null,
        created_at: String(row.created_at ?? toEasternISO()),
        updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO()),
        created_by_user_id: row.created_by_user_id ?? null,
        created_by_name: row.created_by_name ?? null
      };
    });
  }

  if (Array.isArray(db.billingBatches)) {
    db.billingBatches = db.billingBatches.map((row) => ({
      ...row,
      batch_type:
        row.batch_type === "Membership" || row.batch_type === "Monthly" || row.batch_type === "Custom"
          ? row.batch_type
          : "Mixed",
      billing_month: String(row.billing_month ?? `${toEasternDate().slice(0, 7)}-01`),
      run_date: String(row.run_date ?? toEasternDate()),
      run_by_user: String(row.run_by_user ?? "system"),
      batch_status:
        row.batch_status === "Reviewed" || row.batch_status === "Finalized" || row.batch_status === "Exported" || row.batch_status === "Closed"
          ? row.batch_status
          : "Draft",
      invoice_count: Number.isFinite(row.invoice_count) ? Math.max(0, Math.round(Number(row.invoice_count))) : 0,
      total_amount: Number.isFinite(row.total_amount) ? Number(row.total_amount) : 0,
      exported_at: row.exported_at ?? null,
      completion_date: row.completion_date ?? null,
      next_due_date: row.next_due_date ?? null,
      notes: row.notes ?? null,
      created_at: String(row.created_at ?? toEasternISO()),
      updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO())
    }));
  }

  if (Array.isArray(db.billingInvoices)) {
    db.billingInvoices = db.billingInvoices.map((row) => ({
      ...row,
      billing_batch_id: String(row.billing_batch_id ?? ""),
      member_id: String(row.member_id ?? ""),
      payor_id: row.payor_id ?? null,
      invoice_number: String(row.invoice_number ?? ""),
      invoice_date: String(row.invoice_date ?? toEasternDate()),
      due_date: String(row.due_date ?? toEasternDate()),
      invoice_month: String(row.invoice_month ?? `${toEasternDate().slice(0, 7)}-01`),
      invoice_source: row.invoice_source === "Custom" ? "Custom" : "BatchGenerated",
      billing_mode_snapshot:
        row.billing_mode_snapshot === "Monthly" || row.billing_mode_snapshot === "Custom"
          ? row.billing_mode_snapshot
          : "Membership",
      monthly_billing_basis_snapshot:
        row.monthly_billing_basis_snapshot === "ActualAttendanceMonthBehind"
          ? "ActualAttendanceMonthBehind"
          : row.monthly_billing_basis_snapshot === "ScheduledMonthBehind"
            ? "ScheduledMonthBehind"
            : null,
      base_period_start: String(row.base_period_start ?? row.invoice_month ?? `${toEasternDate().slice(0, 7)}-01`),
      base_period_end: String(row.base_period_end ?? row.invoice_month ?? `${toEasternDate().slice(0, 7)}-01`),
      variable_charge_period_start: String(
        row.variable_charge_period_start ?? row.base_period_start ?? row.invoice_month ?? `${toEasternDate().slice(0, 7)}-01`
      ),
      variable_charge_period_end: String(
        row.variable_charge_period_end ?? row.base_period_end ?? row.invoice_month ?? `${toEasternDate().slice(0, 7)}-01`
      ),
      base_program_billed_days: Number.isFinite(row.base_program_billed_days) ? Math.max(0, Number(row.base_program_billed_days)) : 0,
      base_program_day_rate:
        row.base_program_day_rate == null || Number.isFinite(row.base_program_day_rate)
          ? (row.base_program_day_rate == null ? null : Math.max(0, Number(row.base_program_day_rate)))
          : null,
      base_program_closure_excluded_days: Number.isFinite(row.base_program_closure_excluded_days)
        ? Math.max(0, Number(row.base_program_closure_excluded_days))
        : 0,
      base_program_amount: Number.isFinite(row.base_program_amount) ? Number(row.base_program_amount) : 0,
      transportation_amount: Number.isFinite(row.transportation_amount) ? Number(row.transportation_amount) : 0,
      ancillary_amount: Number.isFinite(row.ancillary_amount) ? Number(row.ancillary_amount) : 0,
      adjustment_amount: Number.isFinite(row.adjustment_amount) ? Number(row.adjustment_amount) : 0,
      prior_balance_amount: Number.isFinite(row.prior_balance_amount) ? Number(row.prior_balance_amount) : 0,
      discount_amount: Number.isFinite(row.discount_amount) ? Number(row.discount_amount) : 0,
      total_amount: Number.isFinite(row.total_amount) ? Number(row.total_amount) : 0,
      invoice_status:
        row.invoice_status === "Finalized" ||
        row.invoice_status === "Sent" ||
        row.invoice_status === "Paid" ||
        row.invoice_status === "PartiallyPaid" ||
        row.invoice_status === "Void"
          ? row.invoice_status
          : "Draft",
      export_status: row.export_status === "Exported" ? "Exported" : "NotExported",
      exported_at: row.exported_at ?? null,
      billing_summary_text: row.billing_summary_text ?? null,
      snapshot_member_billing_id: row.snapshot_member_billing_id ?? null,
      snapshot_schedule_template_id: row.snapshot_schedule_template_id ?? null,
      snapshot_center_billing_setting_id: row.snapshot_center_billing_setting_id ?? null,
      frozen_at: row.frozen_at ?? null,
      created_at: String(row.created_at ?? toEasternISO()),
      updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO())
    }));
  }

  if (Array.isArray(db.billingInvoiceLines)) {
    db.billingInvoiceLines = db.billingInvoiceLines
      .map((row): MockDb["billingInvoiceLines"][number] => ({
        ...row,
        invoice_id: String(row.invoice_id ?? ""),
        line_order: Number.isFinite(row.line_order) ? Math.max(1, Math.round(Number(row.line_order))) : 1,
        line_type:
          row.line_type === "Transportation" ||
          row.line_type === "Ancillary" ||
          row.line_type === "Adjustment" ||
          row.line_type === "Credit" ||
          row.line_type === "PriorBalance"
            ? row.line_type
            : "BaseProgram",
        service_period_start: row.service_period_start ?? null,
        service_period_end: row.service_period_end ?? null,
        service_date: row.service_date ?? null,
        description: String(row.description ?? ""),
        quantity: Number.isFinite(row.quantity) ? Number(row.quantity) : 1,
        unit_rate: Number.isFinite(row.unit_rate) ? Number(row.unit_rate) : 0,
        amount: Number.isFinite(row.amount) ? Number(row.amount) : 0,
        source_table: row.source_table ?? null,
        source_record_id: row.source_record_id ?? null,
        created_at: String(row.created_at ?? toEasternISO())
      }))
      .filter((row) => row.invoice_id.length > 0);
  }

  if (Array.isArray(db.billingExportJobs)) {
    db.billingExportJobs = db.billingExportJobs.map((row) => ({
      ...row,
      billing_batch_id: String(row.billing_batch_id ?? ""),
      export_type:
        row.export_type === "InternalReviewCSV" || row.export_type === "InvoiceSummaryCSV"
          ? row.export_type
          : "QuickBooksCSV",
      generated_at: String(row.generated_at ?? toEasternISO()),
      generated_by: String(row.generated_by ?? "system"),
      file_name: String(row.file_name ?? "billing-export.csv"),
      status: row.status === "Failed" ? "Failed" : "Success",
      notes: row.notes ?? null,
      file_data_url: row.file_data_url ?? null
    }));
  }

  if (Array.isArray(db.billingCoverages)) {
    db.billingCoverages = db.billingCoverages
      .map((row): MockDb["billingCoverages"][number] => ({
        ...row,
        member_id: String(row.member_id ?? ""),
        coverage_start_date: String(row.coverage_start_date ?? toEasternDate()),
        coverage_end_date: String(row.coverage_end_date ?? row.coverage_start_date ?? toEasternDate()),
        coverage_type:
          row.coverage_type === "Transportation" ||
          row.coverage_type === "Ancillary" ||
          row.coverage_type === "Adjustment"
            ? row.coverage_type
            : "BaseProgram",
        source_invoice_id: String(row.source_invoice_id ?? ""),
        notes: row.notes ?? null,
        created_at: String(row.created_at ?? toEasternISO()),
        updated_at: String(row.updated_at ?? row.created_at ?? toEasternISO())
      }))
      .filter((row) => row.member_id.length > 0 && row.source_invoice_id.length > 0)
      .sort((left, right) => (left.coverage_start_date < right.coverage_start_date ? 1 : -1));
  }

  const assessmentIds = new Set(db.assessments.map((assessment) => assessment.id));
  const hasInvalidResponses =
    !Array.isArray(db.assessmentResponses) ||
    db.assessmentResponses.length === 0 ||
    db.assessmentResponses.some((response) => !assessmentIds.has(response.assessment_id)) ||
    db.assessments.some((assessment) => !db.assessmentResponses.some((response) => response.assessment_id === assessment.id));

  if (hasInvalidResponses) {
    db.assessmentResponses = buildAssessmentResponsesFromAssessments(db);
  }

  return {
    version: 1,
    counter: Number.isFinite(candidate.counter) ? candidate.counter : buildInitialCounter(db),
    db,
    timeReviews: Array.isArray(candidate.timeReviews) ? candidate.timeReviews : [],
    documentationReviews: Array.isArray(candidate.documentationReviews) ? candidate.documentationReviews : [],
    leadMemberLinks: Array.isArray(candidate.leadMemberLinks)
      ? candidate.leadMemberLinks.filter(
          (entry): entry is { leadId: string; memberId: string } =>
            Boolean(entry && typeof entry.leadId === "string" && typeof entry.memberId === "string")
        )
      : [],
    lockerHistory: Array.isArray(candidate.lockerHistory)
      ? candidate.lockerHistory
          .filter((entry) => Boolean(entry && typeof entry.lockerNumber === "string" && typeof entry.previousMemberName === "string"))
          .map((entry) => ({
            lockerNumber: normalizeLockerNumber(entry.lockerNumber) ?? "",
            previousMemberId: entry.previousMemberId && typeof entry.previousMemberId === "string" ? entry.previousMemberId : null,
            previousMemberName: String(entry.previousMemberName ?? "").trim(),
            recordedAt: String(entry.recordedAt ?? toEasternISO())
          }))
          .filter((entry) => entry.lockerNumber.length > 0 && entry.previousMemberName.length > 0)
      : [],
    operationalConfig: {
      busNumbers: normalizeBusNumberList(candidate.operationalConfig?.busNumbers),
      makeupPolicy:
        candidate.operationalConfig?.makeupPolicy === "running_total"
          ? "running_total"
          : "rolling_30_day_expiration",
      latePickupRules: {
        graceStartTime:
          typeof candidate.operationalConfig?.latePickupRules?.graceStartTime === "string" &&
          /^\d{2}:\d{2}$/.test(candidate.operationalConfig?.latePickupRules?.graceStartTime)
            ? candidate.operationalConfig?.latePickupRules?.graceStartTime
            : "17:00",
        firstWindowMinutes:
          Number.isFinite(candidate.operationalConfig?.latePickupRules?.firstWindowMinutes)
            ? Math.max(1, Math.round(Number(candidate.operationalConfig?.latePickupRules?.firstWindowMinutes)))
            : 15,
        firstWindowFeeCents:
          Number.isFinite(candidate.operationalConfig?.latePickupRules?.firstWindowFeeCents)
            ? Math.max(0, Math.round(Number(candidate.operationalConfig?.latePickupRules?.firstWindowFeeCents)))
            : 2500,
        additionalPerMinuteCents:
          Number.isFinite(candidate.operationalConfig?.latePickupRules?.additionalPerMinuteCents)
            ? Math.max(0, Math.round(Number(candidate.operationalConfig?.latePickupRules?.additionalPerMinuteCents)))
            : 200,
        additionalMinutesCap:
          Number.isFinite(candidate.operationalConfig?.latePickupRules?.additionalMinutesCap)
            ? Math.max(0, Math.round(Number(candidate.operationalConfig?.latePickupRules?.additionalMinutesCap)))
            : 15
      }
    },
    makeupLedger: Array.isArray(candidate.makeupLedger)
      ? candidate.makeupLedger
          .map((entry) => ({
            id: String(entry.id ?? ""),
            memberId: String(entry.memberId ?? ""),
            deltaDays: Number.isFinite(entry.deltaDays) ? Number(entry.deltaDays) : 0,
            reason: String(entry.reason ?? "").trim() || "Adjustment",
            source: String(entry.source ?? "").trim() || "system",
            effectiveDate: String(entry.effectiveDate ?? toEasternDate()),
            expiresAt: entry.expiresAt ? String(entry.expiresAt) : null,
            createdAt: String(entry.createdAt ?? toEasternISO()),
            createdByUserId: String(entry.createdByUserId ?? ""),
            createdByName: String(entry.createdByName ?? "Unknown Staff")
          }))
          .filter((entry) => entry.id.length > 0 && entry.memberId.length > 0 && entry.deltaDays !== 0)
      : []
  };
}

const persistedState = normalizePersistedState(readMockStateJson<PersistedMockRepoState | null>(MOCK_REPO_STATE_FILE, null));
const db: MockDb = persistedState.db;
let counter = persistedState.counter;
const timeReviewState = new Map<string, StoredReview>(persistedState.timeReviews.map((item) => [item.key, item.review]));
const documentationReviewState = new Map<string, StoredReview>(persistedState.documentationReviews.map((item) => [item.key, item.review]));
const leadMemberMap = new Map<string, string>(persistedState.leadMemberLinks.map((entry) => [entry.leadId, entry.memberId]));
const operationalConfigState: {
  busNumbers: string[];
  makeupPolicy: "rolling_30_day_expiration" | "running_total";
  latePickupRules: {
    graceStartTime: string;
    firstWindowMinutes: number;
    firstWindowFeeCents: number;
    additionalPerMinuteCents: number;
    additionalMinutesCap: number;
  };
} = {
  busNumbers: [...persistedState.operationalConfig.busNumbers],
  makeupPolicy: persistedState.operationalConfig.makeupPolicy,
  latePickupRules: { ...persistedState.operationalConfig.latePickupRules }
};
const lockerHistoryState = new Map<
  string,
  { lockerNumber: string; previousMemberId: string | null; previousMemberName: string; recordedAt: string }
>(
  persistedState.lockerHistory.map((entry) => [
    entry.lockerNumber,
    {
      lockerNumber: entry.lockerNumber,
      previousMemberId: entry.previousMemberId,
      previousMemberName: entry.previousMemberName,
      recordedAt: entry.recordedAt
    }
  ])
);
const makeupLedgerState = new Map<
  string,
  {
    id: string;
    memberId: string;
    deltaDays: number;
    reason: string;
    source: string;
    effectiveDate: string;
    expiresAt: string | null;
    createdAt: string;
    createdByUserId: string;
    createdByName: string;
  }
>(persistedState.makeupLedger.map((entry) => [entry.id, { ...entry }]));

function persistMockRepoState() {
  writeMockStateJson<PersistedMockRepoState>(MOCK_REPO_STATE_FILE, {
    version: 1,
    counter,
    db,
    timeReviews: Array.from(timeReviewState.entries()).map(([key, review]) => ({ key, review })),
    documentationReviews: Array.from(documentationReviewState.entries()).map(([key, review]) => ({ key, review })),
    leadMemberLinks: Array.from(leadMemberMap.entries()).map(([leadId, memberId]) => ({ leadId, memberId })),
    lockerHistory: Array.from(lockerHistoryState.values()),
    operationalConfig: {
      busNumbers: [...operationalConfigState.busNumbers],
      makeupPolicy: operationalConfigState.makeupPolicy,
      latePickupRules: { ...operationalConfigState.latePickupRules }
    },
    makeupLedger: Array.from(makeupLedgerState.values())
  });
}

function recordLockerHistory(input: {
  lockerNumber: string;
  previousMemberId: string | null;
  previousMemberName: string;
  recordedAt?: string;
}) {
  const normalizedLocker = normalizeLockerNumber(input.lockerNumber);
  if (!normalizedLocker) return;
  const previousMemberName = input.previousMemberName.trim();
  if (!previousMemberName) return;

  lockerHistoryState.set(normalizedLocker, {
    lockerNumber: normalizedLocker,
    previousMemberId: input.previousMemberId,
    previousMemberName,
    recordedAt: input.recordedAt ?? toEasternISO()
  });
}

export function setPreviousLockerAssignment(input: {
  lockerNumber: string | null | undefined;
  previousMemberId: string | null;
  previousMemberName: string | null | undefined;
  recordedAt?: string;
}) {
  recordLockerHistory({
    lockerNumber: String(input.lockerNumber ?? ""),
    previousMemberId: input.previousMemberId,
    previousMemberName: String(input.previousMemberName ?? ""),
    recordedAt: input.recordedAt
  });
  persistMockRepoState();
}

export function getLockerHistoryEntries() {
  return Array.from(lockerHistoryState.values());
}

export function getOperationalConfig() {
  return {
    busNumbers: [...operationalConfigState.busNumbers],
    makeupPolicy: operationalConfigState.makeupPolicy,
    latePickupRules: { ...operationalConfigState.latePickupRules }
  };
}

export function updateOperationalConfig(input: {
  busNumbers?: string[];
  makeupPolicy?: "rolling_30_day_expiration" | "running_total";
  latePickupRules?: Partial<{
    graceStartTime: string;
    firstWindowMinutes: number;
    firstWindowFeeCents: number;
    additionalPerMinuteCents: number;
    additionalMinutesCap: number;
  }>;
}) {
  if (input.busNumbers) {
    operationalConfigState.busNumbers = normalizeBusNumberList(input.busNumbers);
  }
  if (input.makeupPolicy === "rolling_30_day_expiration" || input.makeupPolicy === "running_total") {
    operationalConfigState.makeupPolicy = input.makeupPolicy;
  }
  if (input.latePickupRules) {
    const current = operationalConfigState.latePickupRules;
    operationalConfigState.latePickupRules = {
      graceStartTime:
        typeof input.latePickupRules.graceStartTime === "string" &&
        /^\d{2}:\d{2}$/.test(input.latePickupRules.graceStartTime)
          ? input.latePickupRules.graceStartTime
          : current.graceStartTime,
      firstWindowMinutes:
        Number.isFinite(input.latePickupRules.firstWindowMinutes)
          ? Math.max(1, Math.round(Number(input.latePickupRules.firstWindowMinutes)))
          : current.firstWindowMinutes,
      firstWindowFeeCents:
        Number.isFinite(input.latePickupRules.firstWindowFeeCents)
          ? Math.max(0, Math.round(Number(input.latePickupRules.firstWindowFeeCents)))
          : current.firstWindowFeeCents,
      additionalPerMinuteCents:
        Number.isFinite(input.latePickupRules.additionalPerMinuteCents)
          ? Math.max(0, Math.round(Number(input.latePickupRules.additionalPerMinuteCents)))
          : current.additionalPerMinuteCents,
      additionalMinutesCap:
        Number.isFinite(input.latePickupRules.additionalMinutesCap)
          ? Math.max(0, Math.round(Number(input.latePickupRules.additionalMinutesCap)))
          : current.additionalMinutesCap
    };
  }
  persistMockRepoState();
  return getOperationalConfig();
}

export function listMemberMakeupLedger(memberId: string) {
  return Array.from(makeupLedgerState.values())
    .filter((entry) => entry.memberId === memberId)
    .sort((left, right) => (left.createdAt > right.createdAt ? -1 : 1));
}

export function getMemberMakeupDayBalance(memberId: string, asOfDate?: string) {
  const asOf = asOfDate ? normalizeOperationalDateOnly(asOfDate) : toEasternDate();
  const config = getOperationalConfig();
  const entries = listMemberMakeupLedger(memberId);
  return entries.reduce((sum, entry) => {
    if (entry.effectiveDate > asOf) return sum;
    if (config.makeupPolicy === "rolling_30_day_expiration" && entry.deltaDays > 0 && entry.expiresAt && entry.expiresAt < asOf) {
      return sum;
    }
    return sum + entry.deltaDays;
  }, 0);
}

export function addMemberMakeupLedgerEntry(input: {
  memberId: string;
  deltaDays: number;
  reason: string;
  source: string;
  effectiveDate?: string;
  actorUserId: string;
  actorName: string;
}) {
  const normalizedDelta = Number(input.deltaDays);
  if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) return null;
  const now = toEasternISO();
  const effectiveDate = normalizeOperationalDateOnly(input.effectiveDate ?? now);
  const config = getOperationalConfig();
  const expiresAt =
    normalizedDelta > 0 && config.makeupPolicy === "rolling_30_day_expiration"
      ? (() => {
          const base = new Date(`${effectiveDate}T00:00:00.000Z`);
          base.setUTCDate(base.getUTCDate() + 30);
          return base.toISOString().slice(0, 10);
        })()
      : null;
  const id = nextId("makeup-ledger");
  makeupLedgerState.set(id, {
    id,
    memberId: input.memberId,
    deltaDays: Math.trunc(normalizedDelta),
    reason: String(input.reason ?? "").trim() || "Adjustment",
    source: String(input.source ?? "").trim() || "system",
    effectiveDate,
    expiresAt,
    createdAt: now,
    createdByUserId: input.actorUserId,
    createdByName: input.actorName
  });
  persistMockRepoState();
  return makeupLedgerState.get(id) ?? null;
}

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}`;
}

function pickFallbackStaff() {
  return db.staff[0] ?? {
    id: "",
    staff_id: "",
    full_name: "Unknown Staff",
    email: "",
    email_normalized: "",
    role: "program-assistant",
    active: true
  };
}

function pickStaffById(staffUserId?: string | null, staffName?: string | null) {
  if (staffUserId) {
    const byId = db.staff.find((staff) => staff.id === staffUserId);
    if (byId) return byId;
  }

  if (staffName) {
    const byName = db.staff.find((staff) => staff.full_name === staffName);
    if (byName) return byName;
  }

  return pickFallbackStaff();
}

function pickMemberById(memberId?: string | null, memberName?: string | null) {
  if (memberId) {
    const byId = db.members.find((member) => member.id === memberId);
    if (byId) return byId;
  }

  if (memberName) {
    const byName = db.members.find((member) => member.display_name === memberName);
    if (byName) return byName;
  }

  return db.members[0] ?? {
    id: "",
    display_name: "Unknown Member",
    locker_number: null,
    status: "active",
    discharge_date: null,
    discharge_reason: null,
    discharge_disposition: null,
    discharged_by: null,
    qr_code: "",
    enrollment_date: null,
    dob: null,
    city: null,
    allergies: null,
    code_status: null,
    orientation_dob_verified: null,
    orientation_city_verified: null,
    orientation_year_verified: null,
    orientation_occupation_verified: null,
    medication_management_status: null,
    dressing_support_status: null,
    assistive_devices: null,
    incontinence_products: null,
    on_site_medication_use: null,
    on_site_medication_list: null,
    diet_type: null,
    diet_restrictions_notes: null,
    mobility_status: null,
    mobility_aids: null,
    social_triggers: null,
    joy_sparks: null,
    personal_notes: null,
    transport_can_enter_exit_vehicle: null,
    transport_assistance_level: null,
    transport_mobility_aid: null,
    transport_can_remain_seated_buckled: null,
    transport_behavior_concern: null,
    transport_appropriate: null,
    latest_assessment_id: null,
    latest_assessment_date: null,
    latest_assessment_score: null,
    latest_assessment_track: null,
    latest_assessment_admission_review_required: null
  };
}

function pickCategory(categoryId?: string | null, categoryName?: string | null) {
  if (categoryId) {
    const byId = db.ancillaryCategories.find((category) => category.id === categoryId);
    if (byId) return byId;
  }

  if (categoryName) {
    const byName = db.ancillaryCategories.find((category) => category.name === categoryName);
    if (byName) return byName;
  }

  return db.ancillaryCategories[0] ?? { id: "", name: "Unknown", price_cents: 0 };
}

function withDefaults(key: keyof MockDb, record: Record<string, unknown>) {
  const nowIso = toEasternISO();
  const today = toEasternDate();

  if (key === "timePunches") {
    const staff = pickStaffById(String(record.staff_user_id ?? ""), String(record.staff_name ?? ""));
    return {
      punch_id: String(record.punch_id ?? `PUNCH-${Date.now()}`),
      staff_user_id: String(record.staff_user_id ?? staff.id),
      staff_id: String(record.staff_id ?? staff.staff_id),
      staff_name: String(record.staff_name ?? staff.full_name),
      punch_type: record.punch_type === "out" ? "out" : "in",
      punch_at: String(record.punch_at ?? nowIso),
      punch_lat_long: (record.punch_lat_long as string | null) ?? null,
      site_id: String(record.site_id ?? "SITE-ML-01"),
      within_fence: typeof record.within_fence === "boolean" ? record.within_fence : true,
      distance_meters: typeof record.distance_meters === "number" ? record.distance_meters : null,
      note: (record.note as string | null) ?? null
    };
  }

  if (key === "dailyActivities") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const staff = pickStaffById(String(record.staff_user_id ?? ""), String(record.staff_name ?? ""));
    return {
      timestamp: String(record.timestamp ?? nowIso),
      activity_date: String(record.activity_date ?? today),
      staff_user_id: String(record.staff_user_id ?? staff.id),
      staff_name: String(record.staff_name ?? staff.full_name),
      staff_recording_activity: String(record.staff_recording_activity ?? staff.full_name),
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      participation: Number(record.participation ?? 0),
      participation_reason: (record.participation_reason as string | null) ?? null,
      activity_1_level: Number(record.activity_1_level ?? 0),
      reason_missing_activity_1: (record.reason_missing_activity_1 as string | null) ?? null,
      activity_2_level: Number(record.activity_2_level ?? 0),
      reason_missing_activity_2: (record.reason_missing_activity_2 as string | null) ?? null,
      activity_3_level: Number(record.activity_3_level ?? 0),
      reason_missing_activity_3: (record.reason_missing_activity_3 as string | null) ?? null,
      activity_4_level: Number(record.activity_4_level ?? 0),
      reason_missing_activity_4: (record.reason_missing_activity_4 as string | null) ?? null,
      activity_5_level: Number(record.activity_5_level ?? 0),
      reason_missing_activity_5: (record.reason_missing_activity_5 as string | null) ?? null,
      notes: (record.notes as string | null) ?? null,
      email_address: (record.email_address as string | null) ?? null,
      created_at: String(record.created_at ?? record.timestamp ?? nowIso)
    };
  }

  if (key === "toiletLogs") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const staff = pickStaffById(String(record.staff_user_id ?? ""), String(record.staff_name ?? ""));
    const eventAt = String(record.event_at ?? nowIso);
    return {
      ratee: String(record.ratee ?? "5"),
      event_at: eventAt,
      event_date: String(record.event_date ?? eventAt.slice(0, 10)),
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      briefs: Boolean(record.briefs),
      member_supplied: Boolean(record.member_supplied),
      use_type: String(record.use_type ?? "Bladder"),
      staff_user_id: String(record.staff_user_id ?? staff.id),
      staff_name: String(record.staff_name ?? staff.full_name),
      staff_assisting: String(record.staff_assisting ?? staff.full_name),
      linked_ancillary_charge_id: (record.linked_ancillary_charge_id as string | null) ?? null,
      notes: (record.notes as string | null) ?? null
    };
  }

  if (key === "showerLogs") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const staff = pickStaffById(String(record.staff_user_id ?? ""), String(record.staff_name ?? ""));
    const eventAt = String(record.event_at ?? nowIso);
    return {
      timestamp: String(record.timestamp ?? eventAt),
      event_at: eventAt,
      event_date: String(record.event_date ?? eventAt.slice(0, 10)),
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      laundry: Boolean(record.laundry),
      briefs: Boolean(record.briefs),
      staff_user_id: String(record.staff_user_id ?? staff.id),
      staff_name: String(record.staff_name ?? staff.full_name),
      staff_assisting: String(record.staff_assisting ?? staff.full_name),
      linked_ancillary_charge_id: (record.linked_ancillary_charge_id as string | null) ?? null,
      notes: (record.notes as string | null) ?? null
    };
  }

  if (key === "transportationLogs") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const staff = pickStaffById(String(record.staff_user_id ?? ""), String(record.staff_name ?? ""));
    const activeCenterSettings =
      db.centerBillingSettings.find((row) => row.active && !row.effective_end_date) ??
      db.centerBillingSettings.find((row) => row.active) ??
      null;
    const normalizedTransportType = String(record.transport_type ?? "").trim().toLowerCase();
    const tripType =
      record.trip_type === "OneWay" || record.trip_type === "RoundTrip" || record.trip_type === "Other"
        ? record.trip_type
        : normalizedTransportType.includes("round")
          ? "RoundTrip"
          : normalizedTransportType.length > 0
            ? "OneWay"
            : "Other";
    const quantity = Number.isFinite(record.quantity) && Number(record.quantity) > 0 ? Number(record.quantity) : 1;
    const defaultUnitRate =
      tripType === "RoundTrip"
        ? Number(activeCenterSettings?.default_transport_round_trip_rate ?? 20)
        : Number(activeCenterSettings?.default_transport_one_way_rate ?? 10);
    const unitRate =
      Number.isFinite(record.unit_rate) && Number(record.unit_rate) >= 0
        ? Number(record.unit_rate)
        : defaultUnitRate;
    const totalAmount =
      Number.isFinite(record.total_amount) && Number(record.total_amount) >= 0
        ? Number(record.total_amount)
        : Number((unitRate * quantity).toFixed(2));
    const billable = typeof record.billable === "boolean" ? record.billable : true;
    const billingStatus =
      record.billing_status === "Billed" || record.billing_status === "Excluded"
        ? record.billing_status
        : billable
          ? "Unbilled"
          : "Excluded";
    return {
      timestamp: String(record.timestamp ?? nowIso),
      first_name: String(record.first_name ?? member.display_name.split(" ")[0] ?? "Member"),
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      pick_up_drop_off: record.pick_up_drop_off === "PM" ? "PM" : "AM",
      period: record.period === "PM" ? "PM" : "AM",
      transport_type: String(record.transport_type ?? "Door to door"),
      service_date: String(record.service_date ?? today),
      staff_user_id: String(record.staff_user_id ?? staff.id),
      staff_name: String(record.staff_name ?? staff.full_name),
      staff_responsible: String(record.staff_responsible ?? staff.full_name),
      notes: (record.notes as string | null) ?? null,
      trip_type: tripType,
      quantity,
      unit_rate: unitRate,
      total_amount: totalAmount,
      billable,
      billing_status: billingStatus,
      billing_exclusion_reason: (record.billing_exclusion_reason as string | null) ?? (billable ? null : "Non-billable member transport rule"),
      invoice_id: (record.invoice_id as string | null) ?? null
    };
  }

  if (key === "photoUploads") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const staff = pickStaffById(String(record.uploaded_by ?? ""), String(record.uploaded_by_name ?? ""));
    const uploadedAt = String(record.uploaded_at ?? nowIso);
    return {
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      photo_url: String(record.photo_url ?? "https://placehold.co/600x400?text=Uploaded+Photo"),
      file_name: String(record.file_name ?? `uploaded-${Date.now()}.jpg`),
      file_type: String(record.file_type ?? "image/*"),
      uploaded_by: String(record.uploaded_by ?? staff.id),
      uploaded_by_name: String(record.uploaded_by_name ?? staff.full_name),
      uploaded_at: uploadedAt,
      upload_date: String(record.upload_date ?? uploadedAt.slice(0, 10)),
      staff_clean: String(record.staff_clean ?? staff.full_name),
      notes: (record.notes as string | null) ?? null
    };
  }

  if (key === "bloodSugarLogs") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const nurse = pickStaffById(String(record.nurse_user_id ?? ""), String(record.nurse_name ?? ""));
    return {
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      checked_at: String(record.checked_at ?? nowIso),
      reading_mg_dl: Number(record.reading_mg_dl ?? 100),
      nurse_user_id: String(record.nurse_user_id ?? nurse.id),
      nurse_name: String(record.nurse_name ?? nurse.full_name),
      notes: (record.notes as string | null) ?? null
    };
  }

  if (key === "ancillaryLogs") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const staff = pickStaffById(String(record.staff_user_id ?? ""), String(record.staff_name ?? ""));
    const category = pickCategory(String(record.category_id ?? ""), String(record.category_name ?? ""));
    const qty = Number(record.quantity ?? 1);
    const amount = Number(record.amount_cents ?? category.price_cents * qty);
    const unitRate =
      Number.isFinite(record.unit_rate) && Number(record.unit_rate) >= 0
        ? Number(record.unit_rate)
        : qty > 0
          ? Number((amount / qty).toFixed(2))
          : amount;
    const totalAmount =
      Number.isFinite(record.total_amount) && Number(record.total_amount) >= 0
        ? Number(record.total_amount)
        : amount;
    const billable = typeof record.billable === "boolean" ? record.billable : true;
    const billingStatus =
      record.billing_status === "Billed" || record.billing_status === "Excluded"
        ? record.billing_status
        : billable
          ? "Unbilled"
          : "Excluded";

    return {
      timestamp: String(record.timestamp ?? nowIso),
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      category_id: String(record.category_id ?? category.id),
      category_name: String(record.category_name ?? category.name),
      charge_type: String(record.charge_type ?? record.category_name ?? category.name),
      amount_cents: amount,
      service_date: String(record.service_date ?? today),
      charge_date: String(record.charge_date ?? record.service_date ?? today),
      late_pickup_time: (record.late_pickup_time as string | null) ?? null,
      staff_user_id: String(record.staff_user_id ?? staff.id),
      staff_name: String(record.staff_name ?? staff.full_name),
      staff_recording_entry: String(record.staff_recording_entry ?? staff.full_name),
      notes: (record.notes as string | null) ?? null,
      source_entity: (record.source_entity as string | null) ?? null,
      source_entity_id: (record.source_entity_id as string | null) ?? null,
      quantity: qty,
      unit_rate: unitRate,
      total_amount: totalAmount,
      billable,
      billing_status: billingStatus,
      billing_exclusion_reason: (record.billing_exclusion_reason as string | null) ?? (billable ? null : "Marked non-billable"),
      invoice_id: (record.invoice_id as string | null) ?? null,
      created_at: String(record.created_at ?? record.timestamp ?? nowIso),
      reconciliation_status:
        record.reconciliation_status === "reconciled" || record.reconciliation_status === "void"
          ? record.reconciliation_status
          : "open",
      reconciled_by: (record.reconciled_by as string | null) ?? null,
      reconciled_at: (record.reconciled_at as string | null) ?? null,
      reconciliation_note: (record.reconciliation_note as string | null) ?? null
    };
  }

  if (key === "centerBillingSettings") {
    return {
      default_daily_rate: Number.isFinite(record.default_daily_rate) ? Number(record.default_daily_rate) : 82,
      default_extra_day_rate:
        record.default_extra_day_rate == null || Number.isFinite(record.default_extra_day_rate)
          ? (record.default_extra_day_rate == null ? null : Number(record.default_extra_day_rate))
          : null,
      default_transport_one_way_rate: Number.isFinite(record.default_transport_one_way_rate)
        ? Number(record.default_transport_one_way_rate)
        : 10,
      default_transport_round_trip_rate: Number.isFinite(record.default_transport_round_trip_rate)
        ? Number(record.default_transport_round_trip_rate)
        : 20,
      billing_cutoff_day: Number.isFinite(record.billing_cutoff_day) ? Math.min(31, Math.max(1, Number(record.billing_cutoff_day))) : 25,
      default_billing_mode: record.default_billing_mode === "Monthly" ? "Monthly" : "Membership",
      effective_start_date: String(record.effective_start_date ?? today),
      effective_end_date: (record.effective_end_date as string | null) ?? null,
      active: typeof record.active === "boolean" ? record.active : true,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso),
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null
    };
  }

  if (key === "closureRules") {
    return {
      name: String(record.name ?? "Closure Rule"),
      rule_type: record.rule_type === "nth_weekday" ? "nth_weekday" : "fixed",
      month: Number.isFinite(record.month) ? Math.min(12, Math.max(1, Number(record.month))) : 1,
      day:
        record.day == null || Number.isFinite(record.day)
          ? (record.day == null ? null : Math.min(31, Math.max(1, Number(record.day))))
          : null,
      weekday:
        record.weekday === "sunday" ||
        record.weekday === "monday" ||
        record.weekday === "tuesday" ||
        record.weekday === "wednesday" ||
        record.weekday === "thursday" ||
        record.weekday === "friday" ||
        record.weekday === "saturday"
          ? record.weekday
          : null,
      occurrence:
        record.occurrence === "first" ||
        record.occurrence === "second" ||
        record.occurrence === "third" ||
        record.occurrence === "fourth" ||
        record.occurrence === "last"
          ? record.occurrence
          : null,
      observed_when_weekend:
        record.observed_when_weekend === "friday" ||
        record.observed_when_weekend === "monday" ||
        record.observed_when_weekend === "nearest_weekday"
          ? record.observed_when_weekend
          : "none",
      active: typeof record.active === "boolean" ? record.active : true,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso),
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null
    };
  }

  if (key === "centerClosures") {
    return {
      closure_date: String(record.closure_date ?? today),
      closure_name: String(record.closure_name ?? "Center Closure"),
      closure_type:
        record.closure_type === "Weather" ||
        record.closure_type === "Planned" ||
        record.closure_type === "Emergency" ||
        record.closure_type === "Other"
          ? record.closure_type
          : "Holiday",
      auto_generated: typeof record.auto_generated === "boolean" ? record.auto_generated : false,
      closure_rule_id: (record.closure_rule_id as string | null) ?? null,
      billable_override: typeof record.billable_override === "boolean" ? record.billable_override : false,
      notes: (record.notes as string | null) ?? null,
      active: typeof record.active === "boolean" ? record.active : true,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso),
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null
    };
  }

  if (key === "payors") {
    return {
      payor_name: String(record.payor_name ?? "Private Pay"),
      payor_type: String(record.payor_type ?? "Private"),
      billing_contact_name: (record.billing_contact_name as string | null) ?? null,
      billing_email: (record.billing_email as string | null) ?? null,
      billing_phone: (record.billing_phone as string | null) ?? null,
      billing_method:
        record.billing_method === "ACHDraft" ||
        record.billing_method === "CardOnFile" ||
        record.billing_method === "Manual" ||
        record.billing_method === "External"
          ? record.billing_method
          : "InvoiceEmail",
      auto_draft_enabled: typeof record.auto_draft_enabled === "boolean" ? record.auto_draft_enabled : false,
      quickbooks_customer_name: (record.quickbooks_customer_name as string | null) ?? null,
      quickbooks_customer_ref: (record.quickbooks_customer_ref as string | null) ?? null,
      status: record.status === "inactive" ? "inactive" : "active",
      notes: (record.notes as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso),
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null
    };
  }

  if (key === "memberBillingSettings") {
    return {
      member_id: String(record.member_id ?? ""),
      payor_id: (record.payor_id as string | null) ?? null,
      use_center_default_billing_mode:
        typeof record.use_center_default_billing_mode === "boolean" ? record.use_center_default_billing_mode : true,
      billing_mode:
        record.billing_mode === "Membership" || record.billing_mode === "Monthly" || record.billing_mode === "Custom"
          ? record.billing_mode
          : null,
      monthly_billing_basis:
        record.monthly_billing_basis === "ActualAttendanceMonthBehind"
          ? "ActualAttendanceMonthBehind"
          : "ScheduledMonthBehind",
      use_center_default_rate: typeof record.use_center_default_rate === "boolean" ? record.use_center_default_rate : true,
      custom_daily_rate:
        record.custom_daily_rate == null || Number.isFinite(record.custom_daily_rate)
          ? (record.custom_daily_rate == null ? null : Number(record.custom_daily_rate))
          : null,
      flat_monthly_rate:
        record.flat_monthly_rate == null || Number.isFinite(record.flat_monthly_rate)
          ? (record.flat_monthly_rate == null ? null : Number(record.flat_monthly_rate))
          : null,
      bill_extra_days: typeof record.bill_extra_days === "boolean" ? record.bill_extra_days : true,
      transportation_billing_status:
        record.transportation_billing_status === "Waived" || record.transportation_billing_status === "IncludedInProgramRate"
          ? record.transportation_billing_status
          : "BillNormally",
      bill_ancillary_arrears: typeof record.bill_ancillary_arrears === "boolean" ? record.bill_ancillary_arrears : true,
      active: typeof record.active === "boolean" ? record.active : true,
      effective_start_date: String(record.effective_start_date ?? today),
      effective_end_date: (record.effective_end_date as string | null) ?? null,
      billing_notes: (record.billing_notes as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso),
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null
    };
  }

  if (key === "billingScheduleTemplates") {
    return {
      member_id: String(record.member_id ?? ""),
      effective_start_date: String(record.effective_start_date ?? today),
      effective_end_date: (record.effective_end_date as string | null) ?? null,
      monday: Boolean(record.monday),
      tuesday: Boolean(record.tuesday),
      wednesday: Boolean(record.wednesday),
      thursday: Boolean(record.thursday),
      friday: Boolean(record.friday),
      saturday: Boolean(record.saturday),
      sunday: Boolean(record.sunday),
      active: typeof record.active === "boolean" ? record.active : true,
      notes: (record.notes as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso),
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null
    };
  }

  if (key === "billingAdjustments") {
    const qty = Number.isFinite(record.quantity) && Number(record.quantity) > 0 ? Number(record.quantity) : 1;
    const unitRate = Number.isFinite(record.unit_rate) ? Number(record.unit_rate) : 0;
    const rawAmount = Number.isFinite(record.amount) ? Number(record.amount) : Number((qty * unitRate).toFixed(2));
    const adjustmentType = String(record.adjustment_type ?? "Other");
    const creditTypes = new Set(["Credit", "Discount", "Refund", "ManualCredit"]);
    const amount = creditTypes.has(adjustmentType) ? -Math.abs(rawAmount) : rawAmount;

    return {
      member_id: String(record.member_id ?? ""),
      payor_id: (record.payor_id as string | null) ?? null,
      adjustment_date: String(record.adjustment_date ?? today),
      adjustment_type: adjustmentType,
      description: String(record.description ?? "Billing adjustment"),
      quantity: qty,
      unit_rate: unitRate,
      amount,
      billing_status:
        record.billing_status === "Billed" || record.billing_status === "Excluded"
          ? record.billing_status
          : "Unbilled",
      invoice_id: (record.invoice_id as string | null) ?? null,
      created_by_system: typeof record.created_by_system === "boolean" ? record.created_by_system : false,
      source_table: (record.source_table as string | null) ?? null,
      source_record_id: (record.source_record_id as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso),
      created_by_user_id: (record.created_by_user_id as string | null) ?? null,
      created_by_name: (record.created_by_name as string | null) ?? null
    };
  }

  if (key === "billingBatches") {
    return {
      batch_type:
        record.batch_type === "Membership" || record.batch_type === "Monthly" || record.batch_type === "Custom"
          ? record.batch_type
          : "Mixed",
      billing_month: String(record.billing_month ?? `${today.slice(0, 7)}-01`),
      run_date: String(record.run_date ?? today),
      run_by_user: String(record.run_by_user ?? "system"),
      batch_status:
        record.batch_status === "Reviewed" ||
        record.batch_status === "Finalized" ||
        record.batch_status === "Exported" ||
        record.batch_status === "Closed"
          ? record.batch_status
          : "Draft",
      invoice_count: Number.isFinite(record.invoice_count) ? Number(record.invoice_count) : 0,
      total_amount: Number.isFinite(record.total_amount) ? Number(record.total_amount) : 0,
      exported_at: (record.exported_at as string | null) ?? null,
      completion_date: (record.completion_date as string | null) ?? null,
      next_due_date: (record.next_due_date as string | null) ?? null,
      notes: (record.notes as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "billingInvoices") {
    return {
      billing_batch_id: String(record.billing_batch_id ?? ""),
      member_id: String(record.member_id ?? ""),
      payor_id: (record.payor_id as string | null) ?? null,
      invoice_number: String(record.invoice_number ?? `INV-${Date.now()}`),
      invoice_date: String(record.invoice_date ?? today),
      due_date: String(record.due_date ?? today),
      invoice_month: String(record.invoice_month ?? `${today.slice(0, 7)}-01`),
      invoice_source: record.invoice_source === "Custom" ? "Custom" : "BatchGenerated",
      billing_mode_snapshot:
        record.billing_mode_snapshot === "Monthly" || record.billing_mode_snapshot === "Custom"
          ? record.billing_mode_snapshot
          : "Membership",
      monthly_billing_basis_snapshot:
        record.monthly_billing_basis_snapshot === "ActualAttendanceMonthBehind"
          ? "ActualAttendanceMonthBehind"
          : record.monthly_billing_basis_snapshot === "ScheduledMonthBehind"
            ? "ScheduledMonthBehind"
            : null,
      base_period_start: String(record.base_period_start ?? record.invoice_month ?? `${today.slice(0, 7)}-01`),
      base_period_end: String(record.base_period_end ?? record.invoice_month ?? `${today.slice(0, 7)}-01`),
      variable_charge_period_start: String(
        record.variable_charge_period_start ?? record.base_period_start ?? record.invoice_month ?? `${today.slice(0, 7)}-01`
      ),
      variable_charge_period_end: String(
        record.variable_charge_period_end ?? record.base_period_end ?? record.invoice_month ?? `${today.slice(0, 7)}-01`
      ),
      base_program_billed_days: Number.isFinite(record.base_program_billed_days) ? Math.max(0, Number(record.base_program_billed_days)) : 0,
      base_program_day_rate:
        record.base_program_day_rate == null || Number.isFinite(record.base_program_day_rate)
          ? (record.base_program_day_rate == null ? null : Math.max(0, Number(record.base_program_day_rate)))
          : null,
      member_daily_rate_snapshot:
        record.member_daily_rate_snapshot == null || Number.isFinite(record.member_daily_rate_snapshot)
          ? (record.member_daily_rate_snapshot == null ? null : Math.max(0, Number(record.member_daily_rate_snapshot)))
          : null,
      transportation_billing_status_snapshot:
        record.transportation_billing_status_snapshot === "Waived" || record.transportation_billing_status_snapshot === "IncludedInProgramRate"
          ? record.transportation_billing_status_snapshot
          : "BillNormally",
      base_program_closure_excluded_days: Number.isFinite(record.base_program_closure_excluded_days)
        ? Math.max(0, Number(record.base_program_closure_excluded_days))
        : 0,
      base_program_amount: Number.isFinite(record.base_program_amount) ? Number(record.base_program_amount) : 0,
      transportation_amount: Number.isFinite(record.transportation_amount) ? Number(record.transportation_amount) : 0,
      ancillary_amount: Number.isFinite(record.ancillary_amount) ? Number(record.ancillary_amount) : 0,
      adjustment_amount: Number.isFinite(record.adjustment_amount) ? Number(record.adjustment_amount) : 0,
      prior_balance_amount: Number.isFinite(record.prior_balance_amount) ? Number(record.prior_balance_amount) : 0,
      discount_amount: Number.isFinite(record.discount_amount) ? Number(record.discount_amount) : 0,
      total_amount: Number.isFinite(record.total_amount) ? Number(record.total_amount) : 0,
      invoice_status:
        record.invoice_status === "Finalized" ||
        record.invoice_status === "Sent" ||
        record.invoice_status === "Paid" ||
        record.invoice_status === "PartiallyPaid" ||
        record.invoice_status === "Void"
          ? record.invoice_status
          : "Draft",
      export_status: record.export_status === "Exported" ? "Exported" : "NotExported",
      exported_at: (record.exported_at as string | null) ?? null,
      billing_summary_text: (record.billing_summary_text as string | null) ?? null,
      snapshot_member_billing_id: (record.snapshot_member_billing_id as string | null) ?? null,
      snapshot_schedule_template_id: (record.snapshot_schedule_template_id as string | null) ?? null,
      snapshot_center_billing_setting_id: (record.snapshot_center_billing_setting_id as string | null) ?? null,
      frozen_at: (record.frozen_at as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "billingInvoiceLines") {
    return {
      invoice_id: String(record.invoice_id ?? ""),
      line_order: Number.isFinite(record.line_order) ? Number(record.line_order) : 1,
      line_type:
        record.line_type === "Transportation" ||
        record.line_type === "Ancillary" ||
        record.line_type === "Adjustment" ||
        record.line_type === "Credit" ||
        record.line_type === "PriorBalance"
          ? record.line_type
          : "BaseProgram",
      service_period_start: (record.service_period_start as string | null) ?? null,
      service_period_end: (record.service_period_end as string | null) ?? null,
      service_date: (record.service_date as string | null) ?? null,
      description: String(record.description ?? ""),
      quantity: Number.isFinite(record.quantity) ? Number(record.quantity) : 1,
      unit_rate: Number.isFinite(record.unit_rate) ? Number(record.unit_rate) : 0,
      amount: Number.isFinite(record.amount) ? Number(record.amount) : 0,
      source_table: (record.source_table as string | null) ?? null,
      source_record_id: (record.source_record_id as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso)
    };
  }

  if (key === "billingExportJobs") {
    return {
      billing_batch_id: String(record.billing_batch_id ?? ""),
      export_type:
        record.export_type === "InternalReviewCSV" || record.export_type === "InvoiceSummaryCSV"
          ? record.export_type
          : "QuickBooksCSV",
      generated_at: String(record.generated_at ?? nowIso),
      generated_by: String(record.generated_by ?? "system"),
      file_name: String(record.file_name ?? `billing-export-${today}.csv`),
      status: record.status === "Failed" ? "Failed" : "Success",
      notes: (record.notes as string | null) ?? null,
      file_data_url: (record.file_data_url as string | null) ?? null
    };
  }

  if (key === "billingCoverages") {
    return {
      member_id: String(record.member_id ?? ""),
      coverage_start_date: String(record.coverage_start_date ?? today),
      coverage_end_date: String(record.coverage_end_date ?? record.coverage_start_date ?? today),
      coverage_type:
        record.coverage_type === "Transportation" ||
        record.coverage_type === "Ancillary" ||
        record.coverage_type === "Adjustment"
          ? record.coverage_type
          : "BaseProgram",
      source_invoice_id: String(record.source_invoice_id ?? ""),
      notes: (record.notes as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "leads") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    const stage = String(record.stage ?? "Inquiry");
    const status = String(record.status ?? canonicalLeadStatus("Open", stage));
    return {
      lead_id: String(record.lead_id ?? `L-${Date.now()}`),
      created_at: String(record.created_at ?? nowIso),
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      status,
      stage,
      stage_updated_at: String(record.stage_updated_at ?? nowIso),
      inquiry_date: String(record.inquiry_date ?? today),
      tour_date: (record.tour_date as string | null) ?? null,
      tour_completed: Boolean(record.tour_completed),
      discovery_date: (record.discovery_date as string | null) ?? null,
      member_start_date: (record.member_start_date as string | null) ?? null,
      caregiver_name: String(record.caregiver_name ?? ""),
      caregiver_relationship: (record.caregiver_relationship as string | null) ?? null,
      caregiver_email: (record.caregiver_email as string | null) ?? null,
      caregiver_phone: String(record.caregiver_phone ?? ""),
      member_name: String(record.member_name ?? ""),
      member_dob: (record.member_dob as string | null) ?? null,
      lead_source: String(record.lead_source ?? "Referral"),
      lead_source_other: (record.lead_source_other as string | null) ?? null,
      referral_name: (record.referral_name as string | null) ?? null,
      likelihood: (record.likelihood as string | null) ?? null,
      next_follow_up_date: (record.next_follow_up_date as string | null) ?? null,
      next_follow_up_type: (record.next_follow_up_type as string | null) ?? null,
      notes_summary: (record.notes_summary as string | null) ?? null,
      lost_reason: (record.lost_reason as string | null) ?? null,
      closed_date: (record.closed_date as string | null) ?? null,
      partner_id: (record.partner_id as string | null) ?? null,
      referral_source_id: (record.referral_source_id as string | null) ?? null
    };
  }

  if (key === "leadActivities") {
    const staff = pickStaffById(String(record.completed_by_user_id ?? ""), String(record.completed_by_name ?? ""));
    return {
      activity_id: String(record.activity_id ?? `LA-${Date.now()}`),
      lead_id: String(record.lead_id ?? ""),
      member_name: String(record.member_name ?? ""),
      activity_at: String(record.activity_at ?? nowIso),
      activity_type: String(record.activity_type ?? "Call"),
      outcome: String(record.outcome ?? "Other"),
      lost_reason: (record.lost_reason as string | null) ?? null,
      notes: (record.notes as string | null) ?? null,
      next_follow_up_date: (record.next_follow_up_date as string | null) ?? null,
      next_follow_up_type: (record.next_follow_up_type as string | null) ?? null,
      completed_by_user_id: String(record.completed_by_user_id ?? staff.id),
      completed_by_name: String(record.completed_by_name ?? staff.full_name),
      partner_id: (record.partner_id as string | null) ?? null,
      referral_source_id: (record.referral_source_id as string | null) ?? null
    };
  }

  if (key === "partners") {
    return {
      partner_id: String(record.partner_id ?? `P-${Date.now()}`),
      organization_name: String(record.organization_name ?? ""),
      referral_source_category: String(record.referral_source_category ?? "Referral"),
      location: String(record.location ?? ""),
      primary_phone: String(record.primary_phone ?? ""),
      secondary_phone: (record.secondary_phone as string | null) ?? null,
      primary_email: String(record.primary_email ?? ""),
      active: typeof record.active === "boolean" ? record.active : true,
      notes: (record.notes as string | null) ?? null,
      last_touched: (record.last_touched as string | null) ?? null,
      contact_name: String(record.contact_name ?? record.organization_name ?? "")
    };
  }

  if (key === "referralSources") {
    return {
      referral_source_id: String(record.referral_source_id ?? `RS-${Date.now()}`),
      partner_id: String(record.partner_id ?? ""),
      contact_name: String(record.contact_name ?? ""),
      organization_name: String(record.organization_name ?? ""),
      job_title: (record.job_title as string | null) ?? null,
      primary_phone: String(record.primary_phone ?? ""),
      secondary_phone: (record.secondary_phone as string | null) ?? null,
      primary_email: String(record.primary_email ?? ""),
      preferred_contact_method: String(record.preferred_contact_method ?? ""),
      active: typeof record.active === "boolean" ? record.active : true,
      notes: (record.notes as string | null) ?? null,
      last_touched: (record.last_touched as string | null) ?? null
    };
  }

  if (key === "partnerActivities") {
    const staff = pickStaffById(String(record.completed_by_user_id ?? ""), String(record.completed_by ?? ""));
    return {
      partner_activity_id: String(record.partner_activity_id ?? `PA-${Date.now()}`),
      referral_source_id: (record.referral_source_id as string | null) ?? null,
      partner_id: String(record.partner_id ?? ""),
      organization_name: String(record.organization_name ?? ""),
      contact_name: String(record.contact_name ?? ""),
      activity_at: String(record.activity_at ?? nowIso),
      activity_type: String(record.activity_type ?? "Call"),
      notes: (record.notes as string | null) ?? null,
      completed_by: String(record.completed_by ?? staff.full_name),
      next_follow_up_date: (record.next_follow_up_date as string | null) ?? null,
      next_follow_up_type: (record.next_follow_up_type as string | null) ?? null,
      last_touched: (record.last_touched as string | null) ?? null,
      lead_id: (record.lead_id as string | null) ?? null,
      completed_by_user_id: String(record.completed_by_user_id ?? staff.id)
    };
  }

  if (key === "leadStageHistory") {
    return {
      lead_id: String(record.lead_id ?? ""),
      from_stage: (record.from_stage as string | null) ?? null,
      to_stage: String(record.to_stage ?? ""),
      from_status: (record.from_status as string | null) ?? null,
      to_status: String(record.to_status ?? ""),
      changed_at: String(record.changed_at ?? nowIso),
      changed_by_user_id: String(record.changed_by_user_id ?? ""),
      changed_by_name: String(record.changed_by_name ?? ""),
      reason: (record.reason as string | null) ?? null,
      source: String(record.source ?? "system")
    };
  }

  if (key === "auditLogs") {
    return {
      actor_user_id: String(record.actor_user_id ?? ""),
      actor_name: String(record.actor_name ?? "Unknown User"),
      actor_role: String(record.actor_role ?? "program-assistant"),
      action: String(record.action ?? "create_log"),
      entity_type: String(record.entity_type ?? ""),
      entity_id: (record.entity_id as string | null) ?? null,
      details_json: String(record.details_json ?? "{}"),
      occurred_at: String(record.occurred_at ?? nowIso)
    };
  }

  if (key === "assessments") {
    const member = pickMemberById(String(record.member_id ?? ""), String(record.member_name ?? ""));
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));

    const scoreOrientation = Number(record.score_orientation_general_health ?? 10);
    const scoreDaily = Number(record.score_daily_routines_independence ?? 10);
    const scoreNutrition = Number(record.score_nutrition_dietary_needs ?? 10);
    const scoreMobility = Number(record.score_mobility_safety ?? 10);
    const scoreSocial = Number(record.score_social_emotional_wellness ?? 10);

    return {
      lead_id: (record.lead_id as string | null) ?? null,
      lead_stage_at_assessment: (record.lead_stage_at_assessment as string | null) ?? null,
      lead_status_at_assessment: (record.lead_status_at_assessment as string | null) ?? null,
      member_id: String(record.member_id ?? member.id),
      member_name: String(record.member_name ?? member.display_name),
      assessment_date: String(record.assessment_date ?? today),
      completed_by: String(record.completed_by ?? record.reviewer_name ?? staff.full_name),
      signed_by: String(record.signed_by ?? staff.full_name),
      complete: Boolean(record.complete),

      feeling_today: String(record.feeling_today ?? ""),
      health_lately: String(record.health_lately ?? ""),
      allergies: String(record.allergies ?? ""),
      code_status: String(record.code_status ?? ""),
      orientation_dob_verified: Boolean(record.orientation_dob_verified),
      orientation_city_verified: Boolean(record.orientation_city_verified),
      orientation_year_verified: Boolean(record.orientation_year_verified),
      orientation_occupation_verified: Boolean(record.orientation_occupation_verified),
      orientation_notes: String(record.orientation_notes ?? ""),

      medication_management_status: String(record.medication_management_status ?? ""),
      dressing_support_status: String(record.dressing_support_status ?? ""),
      assistive_devices: String(record.assistive_devices ?? ""),
      incontinence_products: String(record.incontinence_products ?? ""),
      on_site_medication_use: String(record.on_site_medication_use ?? ""),
      on_site_medication_list: String(record.on_site_medication_list ?? ""),
      independence_notes: String(record.independence_notes ?? ""),

      diet_type: String(record.diet_type ?? ""),
      diet_other: String(record.diet_other ?? ""),
      diet_restrictions_notes: String(record.diet_restrictions_notes ?? ""),

      mobility_steadiness: String(record.mobility_steadiness ?? ""),
      falls_history: String(record.falls_history ?? ""),
      mobility_aids: String(record.mobility_aids ?? ""),
      mobility_safety_notes: String(record.mobility_safety_notes ?? ""),

      overwhelmed_by_noise: Boolean(record.overwhelmed_by_noise),
      social_triggers: String(record.social_triggers ?? ""),
      emotional_wellness_notes: String(record.emotional_wellness_notes ?? ""),

      joy_sparks: String(record.joy_sparks ?? ""),
      personal_notes: String(record.personal_notes ?? ""),

      score_orientation_general_health: scoreOrientation,
      score_daily_routines_independence: scoreDaily,
      score_nutrition_dietary_needs: scoreNutrition,
      score_mobility_safety: scoreMobility,
      score_social_emotional_wellness: scoreSocial,
      total_score: Number(record.total_score ?? scoreOrientation + scoreDaily + scoreNutrition + scoreMobility + scoreSocial),
      recommended_track: String(record.recommended_track ?? "Track 2"),
      admission_review_required: typeof record.admission_review_required === "boolean" ? record.admission_review_required : false,

      transport_can_enter_exit_vehicle: String(record.transport_can_enter_exit_vehicle ?? ""),
      transport_assistance_level: String(record.transport_assistance_level ?? ""),
      transport_mobility_aid: String(record.transport_mobility_aid ?? ""),
      transport_can_remain_seated_buckled: Boolean(record.transport_can_remain_seated_buckled),
      transport_behavior_concern: String(record.transport_behavior_concern ?? ""),
      transport_appropriate: typeof record.transport_appropriate === "boolean" ? record.transport_appropriate : true,
      transport_notes: String(record.transport_notes ?? ""),
      vitals_hr: Number(record.vitals_hr ?? 72),
      vitals_bp: String(record.vitals_bp ?? "120/80"),
      vitals_o2_percent: Number(record.vitals_o2_percent ?? 98),
      vitals_rr: Number(record.vitals_rr ?? 16),

      reviewer_name: String(record.reviewer_name ?? staff.full_name),
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      notes: String(record.notes ?? ""),

      vitals_notes: String(record.vitals_notes ?? ""),
      mobility_notes: String(record.mobility_notes ?? ""),
      cognitive_notes: String(record.cognitive_notes ?? ""),
      behavior_mood_notes: String(record.behavior_mood_notes ?? ""),
      adl_notes: String(record.adl_notes ?? ""),
      continence_notes: String(record.continence_notes ?? ""),
      nutrition_notes: String(record.nutrition_notes ?? ""),
      skin_notes: String(record.skin_notes ?? ""),
      meds_notes: String(record.meds_notes ?? ""),
      mar_prn_medication: String(record.mar_prn_medication ?? ""),
      mar_prn_dose: String(record.mar_prn_dose ?? ""),
      mar_prn_route: String(record.mar_prn_route ?? ""),
      mar_prn_frequency: String(record.mar_prn_frequency ?? ""),
      mar_prn_given_time: String(record.mar_prn_given_time ?? ""),
      mar_prn_indication: String(record.mar_prn_indication ?? ""),
      mar_prn_effectiveness: String(record.mar_prn_effectiveness ?? ""),
      mar_prn_notes: String(record.mar_prn_notes ?? ""),
      mar_not_given_medication: String(record.mar_not_given_medication ?? ""),
      mar_not_given_dose: String(record.mar_not_given_dose ?? ""),
      mar_not_given_route: String(record.mar_not_given_route ?? ""),
      mar_not_given_frequency: String(record.mar_not_given_frequency ?? ""),
      mar_not_given_administration_time: String(record.mar_not_given_administration_time ?? ""),
      mar_not_given_reason: String(record.mar_not_given_reason ?? ""),
      mar_not_given_comments: String(record.mar_not_given_comments ?? ""),
      blood_sugar_result: String(record.blood_sugar_result ?? ""),
      blood_sugar_before_after: String(record.blood_sugar_before_after ?? ""),
      blood_sugar_plan: String(record.blood_sugar_plan ?? ""),
      staff_initials: String(record.staff_initials ?? ""),
      risk_notes: String(record.risk_notes ?? ""),
      action_plan_notes: String(record.action_plan_notes ?? ""),
      care_plan_notes: String(record.care_plan_notes ?? "")
    };
  }

  if (key === "assessmentResponses") {
    return {
      assessment_id: String(record.assessment_id ?? ""),
      member_id: String(record.member_id ?? ""),
      field_key: String(record.field_key ?? ""),
      field_label: String(record.field_label ?? ""),
      section_type: String(record.section_type ?? ""),
      field_value: String(record.field_value ?? ""),
      field_value_type:
        record.field_value_type === "boolean" || record.field_value_type === "number" || record.field_value_type === "date"
          ? record.field_value_type
          : "string",
      created_at: String(record.created_at ?? nowIso)
    };
  }

  if (key === "memberCommandCenters") {
    return {
      member_id: String(record.member_id ?? ""),
      gender: record.gender === "M" || record.gender === "F" ? record.gender : null,
      payor: (record.payor as string | null) ?? null,
      original_referral_source: (record.original_referral_source as string | null) ?? null,
      photo_consent: typeof record.photo_consent === "boolean" ? record.photo_consent : null,
      profile_image_url: (record.profile_image_url as string | null) ?? null,
      location: (record.location as string | null) ?? null,
      street_address: (record.street_address as string | null) ?? null,
      city: (record.city as string | null) ?? null,
      state: (record.state as string | null) ?? null,
      zip: (record.zip as string | null) ?? null,
      marital_status: (record.marital_status as string | null) ?? null,
      primary_language: (record.primary_language as string | null) ?? null,
      secondary_language: (record.secondary_language as string | null) ?? null,
      religion: (record.religion as string | null) ?? null,
      ethnicity: (record.ethnicity as string | null) ?? null,
      is_veteran: typeof record.is_veteran === "boolean" ? record.is_veteran : null,
      veteran_branch: (record.veteran_branch as string | null) ?? null,
      code_status: (record.code_status as string | null) ?? null,
      dnr: typeof record.dnr === "boolean" ? record.dnr : null,
      dni: typeof record.dni === "boolean" ? record.dni : null,
      polst_molst_colst: (record.polst_molst_colst as string | null) ?? null,
      hospice: typeof record.hospice === "boolean" ? record.hospice : null,
      advanced_directives_obtained:
        typeof record.advanced_directives_obtained === "boolean" ? record.advanced_directives_obtained : null,
      power_of_attorney: (record.power_of_attorney as string | null) ?? null,
      funeral_home: (record.funeral_home as string | null) ?? null,
      legal_comments: (record.legal_comments as string | null) ?? null,
      diet_type: (record.diet_type as string | null) ?? null,
      dietary_preferences_restrictions: (record.dietary_preferences_restrictions as string | null) ?? null,
      swallowing_difficulty: (record.swallowing_difficulty as string | null) ?? null,
      supplements: (record.supplements as string | null) ?? null,
      food_dislikes: (record.food_dislikes as string | null) ?? null,
      foods_to_omit: (record.foods_to_omit as string | null) ?? null,
      diet_texture: (record.diet_texture as string | null) ?? null,
      no_known_allergies: typeof record.no_known_allergies === "boolean" ? record.no_known_allergies : null,
      medication_allergies: (record.medication_allergies as string | null) ?? null,
      food_allergies: (record.food_allergies as string | null) ?? null,
      environmental_allergies: (record.environmental_allergies as string | null) ?? null,
      command_center_notes: (record.command_center_notes as string | null) ?? null,
      source_assessment_id: (record.source_assessment_id as string | null) ?? null,
      source_assessment_at: (record.source_assessment_at as string | null) ?? null,
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberAttendanceSchedules") {
    const normalizeTransportMode = (value: unknown): "Door to Door" | "Bus Stop" | null =>
      value === "Door to Door" || value === "Bus Stop" ? value : null;
    const normalizeBusNumber = (value: unknown): "1" | "2" | "3" | null =>
      value === "1" || value === "2" || value === "3" ? value : null;
    const normalizePeriod = (value: unknown): "AM" | "PM" | null => (value === "AM" || value === "PM" ? value : null);

    const monday = typeof record.monday === "boolean" ? record.monday : false;
    const tuesday = typeof record.tuesday === "boolean" ? record.tuesday : false;
    const wednesday = typeof record.wednesday === "boolean" ? record.wednesday : false;
    const thursday = typeof record.thursday === "boolean" ? record.thursday : false;
    const friday = typeof record.friday === "boolean" ? record.friday : false;
    const legacyMode = normalizeTransportMode(record.transportation_mode);
    const legacyBusNumber = normalizeBusNumber(record.transport_bus_number);
    const legacyBusStop = (record.transportation_bus_stop as string | null) ?? null;
    const buildSlot = (
      dayEnabled: boolean,
      periodValue: unknown,
      modeValue: unknown,
      doorToDoorAddressValue: unknown,
      busNumberValue: unknown,
      busStopValue: unknown,
      slotPeriod: "AM" | "PM"
    ) => {
      const period = normalizePeriod(periodValue);
      if (!dayEnabled) {
        return { mode: null, doorToDoorAddress: null, busNumber: null, busStop: null } as const;
      }
      const mode = normalizeTransportMode(modeValue) ?? (period === slotPeriod || (period == null && slotPeriod === "AM") ? legacyMode : null);
      return {
        mode,
        doorToDoorAddress: mode === "Door to Door" ? ((doorToDoorAddressValue as string | null) ?? null) : null,
        busNumber:
          mode === "Bus Stop"
            ? normalizeBusNumber(busNumberValue) ?? (period === slotPeriod || (period == null && slotPeriod === "AM") ? legacyBusNumber : null)
            : null,
        busStop:
          mode === "Bus Stop"
            ? ((busStopValue as string | null) ?? (period === slotPeriod || (period == null && slotPeriod === "AM") ? legacyBusStop : null))
            : null
      } as const;
    };

    const mondayAm = buildSlot(monday, record.transport_monday_period, record.transport_monday_am_mode, record.transport_monday_am_door_to_door_address, record.transport_monday_am_bus_number, record.transport_monday_am_bus_stop, "AM");
    const mondayPm = buildSlot(monday, record.transport_monday_period, record.transport_monday_pm_mode, record.transport_monday_pm_door_to_door_address, record.transport_monday_pm_bus_number, record.transport_monday_pm_bus_stop, "PM");
    const tuesdayAm = buildSlot(tuesday, record.transport_tuesday_period, record.transport_tuesday_am_mode, record.transport_tuesday_am_door_to_door_address, record.transport_tuesday_am_bus_number, record.transport_tuesday_am_bus_stop, "AM");
    const tuesdayPm = buildSlot(tuesday, record.transport_tuesday_period, record.transport_tuesday_pm_mode, record.transport_tuesday_pm_door_to_door_address, record.transport_tuesday_pm_bus_number, record.transport_tuesday_pm_bus_stop, "PM");
    const wednesdayAm = buildSlot(wednesday, record.transport_wednesday_period, record.transport_wednesday_am_mode, record.transport_wednesday_am_door_to_door_address, record.transport_wednesday_am_bus_number, record.transport_wednesday_am_bus_stop, "AM");
    const wednesdayPm = buildSlot(wednesday, record.transport_wednesday_period, record.transport_wednesday_pm_mode, record.transport_wednesday_pm_door_to_door_address, record.transport_wednesday_pm_bus_number, record.transport_wednesday_pm_bus_stop, "PM");
    const thursdayAm = buildSlot(thursday, record.transport_thursday_period, record.transport_thursday_am_mode, record.transport_thursday_am_door_to_door_address, record.transport_thursday_am_bus_number, record.transport_thursday_am_bus_stop, "AM");
    const thursdayPm = buildSlot(thursday, record.transport_thursday_period, record.transport_thursday_pm_mode, record.transport_thursday_pm_door_to_door_address, record.transport_thursday_pm_bus_number, record.transport_thursday_pm_bus_stop, "PM");
    const fridayAm = buildSlot(friday, record.transport_friday_period, record.transport_friday_am_mode, record.transport_friday_am_door_to_door_address, record.transport_friday_am_bus_number, record.transport_friday_am_bus_stop, "AM");
    const fridayPm = buildSlot(friday, record.transport_friday_period, record.transport_friday_pm_mode, record.transport_friday_pm_door_to_door_address, record.transport_friday_pm_bus_number, record.transport_friday_pm_bus_stop, "PM");
    const firstMode =
      mondayAm.mode ??
      mondayPm.mode ??
      tuesdayAm.mode ??
      tuesdayPm.mode ??
      wednesdayAm.mode ??
      wednesdayPm.mode ??
      thursdayAm.mode ??
      thursdayPm.mode ??
      fridayAm.mode ??
      fridayPm.mode;
    const firstBusNumber =
      mondayAm.busNumber ??
      mondayPm.busNumber ??
      tuesdayAm.busNumber ??
      tuesdayPm.busNumber ??
      wednesdayAm.busNumber ??
      wednesdayPm.busNumber ??
      thursdayAm.busNumber ??
      thursdayPm.busNumber ??
      fridayAm.busNumber ??
      fridayPm.busNumber;
    const firstBusStop =
      mondayAm.busStop ??
      mondayPm.busStop ??
      tuesdayAm.busStop ??
      tuesdayPm.busStop ??
      wednesdayAm.busStop ??
      wednesdayPm.busStop ??
      thursdayAm.busStop ??
      thursdayPm.busStop ??
      fridayAm.busStop ??
      fridayPm.busStop;
    const attendanceDaysPerWeek = [monday, tuesday, wednesday, thursday, friday].filter(Boolean).length;
    const defaultDailyRate =
      Number.isFinite(record.default_daily_rate) && Number(record.default_daily_rate) > 0
        ? Number(record.default_daily_rate)
        : getStandardDailyRateForAttendanceDays(attendanceDaysPerWeek);
    const useCustomDailyRate = typeof record.use_custom_daily_rate === "boolean" ? record.use_custom_daily_rate : false;
    const customDailyRate =
      record.custom_daily_rate == null || (Number.isFinite(record.custom_daily_rate) && Number(record.custom_daily_rate) > 0)
        ? (record.custom_daily_rate == null ? null : Number(record.custom_daily_rate))
        : null;
    const dailyRate =
      Number.isFinite(record.daily_rate) && Number(record.daily_rate) > 0
        ? Number(record.daily_rate)
        : customDailyRate ?? defaultDailyRate;
    const transportationBillingStatus =
      record.transportation_billing_status === "Waived" || record.transportation_billing_status === "IncludedInProgramRate"
        ? record.transportation_billing_status
        : "BillNormally";

    return {
      member_id: String(record.member_id ?? ""),
      enrollment_date: (record.enrollment_date as string | null) ?? null,
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      full_day: typeof record.full_day === "boolean" ? record.full_day : true,
      transportation_required: typeof record.transportation_required === "boolean" ? record.transportation_required : null,
      transportation_mode: firstMode,
      transport_bus_number: firstMode === "Bus Stop" ? firstBusNumber : null,
      transportation_bus_stop: firstMode === "Bus Stop" ? firstBusStop : null,
      transport_monday_period: mondayAm.mode ? "AM" : mondayPm.mode ? "PM" : null,
      transport_tuesday_period: tuesdayAm.mode ? "AM" : tuesdayPm.mode ? "PM" : null,
      transport_wednesday_period: wednesdayAm.mode ? "AM" : wednesdayPm.mode ? "PM" : null,
      transport_thursday_period: thursdayAm.mode ? "AM" : thursdayPm.mode ? "PM" : null,
      transport_friday_period: fridayAm.mode ? "AM" : fridayPm.mode ? "PM" : null,
      transport_monday_am_mode: mondayAm.mode,
      transport_monday_am_door_to_door_address: mondayAm.doorToDoorAddress,
      transport_monday_am_bus_number: mondayAm.busNumber,
      transport_monday_am_bus_stop: mondayAm.busStop,
      transport_monday_pm_mode: mondayPm.mode,
      transport_monday_pm_door_to_door_address: mondayPm.doorToDoorAddress,
      transport_monday_pm_bus_number: mondayPm.busNumber,
      transport_monday_pm_bus_stop: mondayPm.busStop,
      transport_tuesday_am_mode: tuesdayAm.mode,
      transport_tuesday_am_door_to_door_address: tuesdayAm.doorToDoorAddress,
      transport_tuesday_am_bus_number: tuesdayAm.busNumber,
      transport_tuesday_am_bus_stop: tuesdayAm.busStop,
      transport_tuesday_pm_mode: tuesdayPm.mode,
      transport_tuesday_pm_door_to_door_address: tuesdayPm.doorToDoorAddress,
      transport_tuesday_pm_bus_number: tuesdayPm.busNumber,
      transport_tuesday_pm_bus_stop: tuesdayPm.busStop,
      transport_wednesday_am_mode: wednesdayAm.mode,
      transport_wednesday_am_door_to_door_address: wednesdayAm.doorToDoorAddress,
      transport_wednesday_am_bus_number: wednesdayAm.busNumber,
      transport_wednesday_am_bus_stop: wednesdayAm.busStop,
      transport_wednesday_pm_mode: wednesdayPm.mode,
      transport_wednesday_pm_door_to_door_address: wednesdayPm.doorToDoorAddress,
      transport_wednesday_pm_bus_number: wednesdayPm.busNumber,
      transport_wednesday_pm_bus_stop: wednesdayPm.busStop,
      transport_thursday_am_mode: thursdayAm.mode,
      transport_thursday_am_door_to_door_address: thursdayAm.doorToDoorAddress,
      transport_thursday_am_bus_number: thursdayAm.busNumber,
      transport_thursday_am_bus_stop: thursdayAm.busStop,
      transport_thursday_pm_mode: thursdayPm.mode,
      transport_thursday_pm_door_to_door_address: thursdayPm.doorToDoorAddress,
      transport_thursday_pm_bus_number: thursdayPm.busNumber,
      transport_thursday_pm_bus_stop: thursdayPm.busStop,
      transport_friday_am_mode: fridayAm.mode,
      transport_friday_am_door_to_door_address: fridayAm.doorToDoorAddress,
      transport_friday_am_bus_number: fridayAm.busNumber,
      transport_friday_am_bus_stop: fridayAm.busStop,
      transport_friday_pm_mode: fridayPm.mode,
      transport_friday_pm_door_to_door_address: fridayPm.doorToDoorAddress,
      transport_friday_pm_bus_number: fridayPm.busNumber,
      transport_friday_pm_bus_stop: fridayPm.busStop,
      daily_rate: dailyRate,
      transportation_billing_status: transportationBillingStatus,
      billing_rate_effective_date: (record.billing_rate_effective_date as string | null) ?? (record.enrollment_date as string | null) ?? today,
      billing_notes: (record.billing_notes as string | null) ?? null,
      attendance_days_per_week: attendanceDaysPerWeek,
      default_daily_rate: defaultDailyRate,
      use_custom_daily_rate: useCustomDailyRate,
      custom_daily_rate: customDailyRate,
      make_up_days_available: typeof record.make_up_days_available === "number" ? record.make_up_days_available : null,
      attendance_notes: (record.attendance_notes as string | null) ?? null,
      updated_by_user_id: (record.updated_by_user_id as string | null) ?? null,
      updated_by_name: (record.updated_by_name as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "attendanceRecords") {
    const member = pickMemberById(String(record.member_id ?? ""), "");
    const staff = pickStaffById(String(record.recorded_by_user_id ?? ""), String(record.recorded_by_name ?? ""));
    const attendanceDateRaw = String(record.attendance_date ?? today).trim();
    const attendanceDate = /^\d{4}-\d{2}-\d{2}$/.test(attendanceDateRaw)
      ? attendanceDateRaw
      : toEasternDate(attendanceDateRaw || today);
    // Normalize status casing during writes so "Absent"/"ABSENT" persists as absent across reloads.
    const normalizedStatus = String(record.status ?? "").trim().toLowerCase();
    const status = normalizedStatus === "absent" ? "absent" : "present";
    const checkInAt = status === "present" ? (record.check_in_at ? String(record.check_in_at) : null) : null;
    const checkOutAt = status === "present" ? (record.check_out_at ? String(record.check_out_at) : null) : null;
    const absentReason = status === "absent" ? (record.absent_reason ? String(record.absent_reason) : null) : null;
    const absentReasonOther =
      status === "absent" ? (record.absent_reason_other ? String(record.absent_reason_other) : null) : null;
    const createdAt = String(record.created_at ?? nowIso);
    const updatedAt = String(record.updated_at ?? createdAt);
    const billingStatus =
      record.billing_status === "Billed" || record.billing_status === "Excluded"
        ? record.billing_status
        : "Unbilled";

    return {
      member_id: String(record.member_id ?? member.id),
      attendance_date: attendanceDate,
      status,
      absent_reason: absentReason,
      absent_reason_other: absentReasonOther,
      check_in_at: checkInAt,
      check_out_at: checkOutAt,
      notes: (record.notes as string | null) ?? null,
      scheduled_day: typeof record.scheduled_day === "boolean" ? record.scheduled_day : null,
      unscheduled_day: typeof record.unscheduled_day === "boolean" ? record.unscheduled_day : null,
      billable_extra_day: typeof record.billable_extra_day === "boolean" ? record.billable_extra_day : null,
      billing_status: billingStatus,
      linked_adjustment_id: (record.linked_adjustment_id as string | null) ?? null,
      recorded_by_user_id: String(record.recorded_by_user_id ?? staff.id),
      recorded_by_name: String(record.recorded_by_name ?? staff.full_name),
      created_at: createdAt,
      updated_at: updatedAt
    };
  }

  if (key === "memberHolds") {
    const member = pickMemberById(String(record.member_id ?? ""), "");
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    const startDateRaw = String(record.start_date ?? today).trim();
    const endDateRaw = String(record.end_date ?? "").trim();
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(startDateRaw)
      ? startDateRaw
      : toEasternDate(startDateRaw || today);
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(endDateRaw) ? endDateRaw : endDateRaw ? toEasternDate(endDateRaw) : null;
    const status = record.status === "ended" ? "ended" : "active";
    return {
      member_id: String(record.member_id ?? member.id),
      start_date: startDate,
      end_date: endDate,
      status,
      reason: String(record.reason ?? "Other"),
      reason_other: (record.reason_other as string | null) ?? null,
      notes: (record.notes as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? record.created_at ?? nowIso),
      ended_at: (record.ended_at as string | null) ?? null,
      ended_by_user_id: (record.ended_by_user_id as string | null) ?? null,
      ended_by_name: (record.ended_by_name as string | null) ?? null
    };
  }

  if (key === "transportationManifestAdjustments") {
    const member = pickMemberById(String(record.member_id ?? ""), "");
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    const selectedDateRaw = String(record.selected_date ?? today).trim();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDateRaw)
      ? selectedDateRaw
      : toEasternDate(selectedDateRaw || today);
    const shift = record.shift === "PM" ? "PM" : "AM";
    const adjustmentType = record.adjustment_type === "exclude" ? "exclude" : "add";
    const busNumber = record.bus_number === "1" || record.bus_number === "2" || record.bus_number === "3"
      ? record.bus_number
      : null;
    const transportType = record.transport_type === "Bus Stop" || record.transport_type === "Door to Door"
      ? record.transport_type
      : null;

    return {
      selected_date: selectedDate,
      shift,
      member_id: String(record.member_id ?? member.id),
      adjustment_type: adjustmentType,
      bus_number: busNumber,
      transport_type: transportType,
      bus_stop_name: normalizeBusStopName(record.bus_stop_name) ?? null,
      door_to_door_address: (record.door_to_door_address as string | null) ?? null,
      caregiver_contact_id: (record.caregiver_contact_id as string | null) ?? null,
      caregiver_contact_name_snapshot: (record.caregiver_contact_name_snapshot as string | null) ?? null,
      caregiver_contact_phone_snapshot: (record.caregiver_contact_phone_snapshot as string | null) ?? null,
      caregiver_contact_address_snapshot: (record.caregiver_contact_address_snapshot as string | null) ?? null,
      notes: (record.notes as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso)
    };
  }

  if (key === "memberContacts") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      contact_name: String(record.contact_name ?? ""),
      relationship_to_member: (record.relationship_to_member as string | null) ?? null,
      category: String(record.category ?? "Other"),
      category_other: (record.category_other as string | null) ?? null,
      email: (record.email as string | null) ?? null,
      cellular_number: (record.cellular_number as string | null) ?? null,
      work_number: (record.work_number as string | null) ?? null,
      home_number: (record.home_number as string | null) ?? null,
      street_address: (record.street_address as string | null) ?? null,
      city: (record.city as string | null) ?? null,
      state: (record.state as string | null) ?? null,
      zip: (record.zip as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberFiles") {
    const staff = pickStaffById(String(record.uploaded_by_user_id ?? ""), String(record.uploaded_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      file_name: String(record.file_name ?? "file"),
      file_type: String(record.file_type ?? "application/octet-stream"),
      file_data_url: (record.file_data_url as string | null) ?? null,
      category: String(record.category ?? "Other"),
      category_other: (record.category_other as string | null) ?? null,
      document_source: (record.document_source as string | null) ?? null,
      uploaded_by_user_id: String(record.uploaded_by_user_id ?? staff.id),
      uploaded_by_name: String(record.uploaded_by_name ?? staff.full_name),
      uploaded_at: String(record.uploaded_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberHealthProfiles") {
    return {
      member_id: String(record.member_id ?? ""),
      gender: (record.gender as string | null) ?? null,
      payor: (record.payor as string | null) ?? null,
      original_referral_source: (record.original_referral_source as string | null) ?? null,
      photo_consent: typeof record.photo_consent === "boolean" ? record.photo_consent : null,
      profile_image_url: (record.profile_image_url as string | null) ?? null,
      primary_caregiver_name: (record.primary_caregiver_name as string | null) ?? null,
      primary_caregiver_phone: (record.primary_caregiver_phone as string | null) ?? null,
      responsible_party_name: (record.responsible_party_name as string | null) ?? null,
      responsible_party_phone: (record.responsible_party_phone as string | null) ?? null,
      provider_name: (record.provider_name as string | null) ?? null,
      provider_phone: (record.provider_phone as string | null) ?? null,
      important_alerts: (record.important_alerts as string | null) ?? null,
      diet_type: (record.diet_type as string | null) ?? null,
      dietary_restrictions: (record.dietary_restrictions as string | null) ?? null,
      swallowing_difficulty: (record.swallowing_difficulty as string | null) ?? null,
      diet_texture: (record.diet_texture as string | null) ?? null,
      supplements: (record.supplements as string | null) ?? null,
      foods_to_omit: (record.foods_to_omit as string | null) ?? null,
      ambulation: (record.ambulation as string | null) ?? null,
      transferring: (record.transferring as string | null) ?? null,
      bathing: (record.bathing as string | null) ?? null,
      dressing: (record.dressing as string | null) ?? null,
      eating: (record.eating as string | null) ?? null,
      bladder_continence: (record.bladder_continence as string | null) ?? null,
      bowel_continence: (record.bowel_continence as string | null) ?? null,
      toileting: (record.toileting as string | null) ?? null,
      toileting_needs: (record.toileting_needs as string | null) ?? null,
      toileting_comments: (record.toileting_comments as string | null) ?? null,
      hearing: (record.hearing as string | null) ?? null,
      vision: (record.vision as string | null) ?? null,
      dental: (record.dental as string | null) ?? null,
      speech_verbal_status: (record.speech_verbal_status as string | null) ?? null,
      speech_comments: (record.speech_comments as string | null) ?? null,
      personal_appearance_hygiene_grooming: (record.personal_appearance_hygiene_grooming as string | null) ?? null,
      may_self_medicate: typeof record.may_self_medicate === "boolean" ? record.may_self_medicate : null,
      medication_manager_name: (record.medication_manager_name as string | null) ?? null,
      orientation_dob: (record.orientation_dob as string | null) ?? null,
      orientation_city: (record.orientation_city as string | null) ?? null,
      orientation_current_year: (record.orientation_current_year as string | null) ?? null,
      orientation_former_occupation: (record.orientation_former_occupation as string | null) ?? null,
      memory_impairment: (record.memory_impairment as string | null) ?? null,
      memory_severity: (record.memory_severity as string | null) ?? null,
      wandering: typeof record.wandering === "boolean" ? record.wandering : null,
      combative_disruptive: typeof record.combative_disruptive === "boolean" ? record.combative_disruptive : null,
      sleep_issues: typeof record.sleep_issues === "boolean" ? record.sleep_issues : null,
      self_harm_unsafe: typeof record.self_harm_unsafe === "boolean" ? record.self_harm_unsafe : null,
      impaired_judgement: typeof record.impaired_judgement === "boolean" ? record.impaired_judgement : null,
      delirium: typeof record.delirium === "boolean" ? record.delirium : null,
      disorientation: typeof record.disorientation === "boolean" ? record.disorientation : null,
      agitation_resistive: typeof record.agitation_resistive === "boolean" ? record.agitation_resistive : null,
      screaming_loud_noises: typeof record.screaming_loud_noises === "boolean" ? record.screaming_loud_noises : null,
      exhibitionism_disrobing: typeof record.exhibitionism_disrobing === "boolean" ? record.exhibitionism_disrobing : null,
      exit_seeking: typeof record.exit_seeking === "boolean" ? record.exit_seeking : null,
      cognitive_behavior_comments: (record.cognitive_behavior_comments as string | null) ?? null,
      code_status: (record.code_status as string | null) ?? null,
      dnr: typeof record.dnr === "boolean" ? record.dnr : null,
      dni: typeof record.dni === "boolean" ? record.dni : null,
      polst_molst_colst: (record.polst_molst_colst as string | null) ?? null,
      hospice: typeof record.hospice === "boolean" ? record.hospice : null,
      advanced_directives_obtained: typeof record.advanced_directives_obtained === "boolean" ? record.advanced_directives_obtained : null,
      power_of_attorney: (record.power_of_attorney as string | null) ?? null,
      hospital_preference: (record.hospital_preference as string | null) ?? null,
      legal_comments: (record.legal_comments as string | null) ?? null,
      source_assessment_id: (record.source_assessment_id as string | null) ?? null,
      source_assessment_at: (record.source_assessment_at as string | null) ?? null,
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberDiagnoses") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      diagnosis_type: record.diagnosis_type === "secondary" ? "secondary" : "primary",
      diagnosis_name: String(record.diagnosis_name ?? ""),
      diagnosis_code: (record.diagnosis_code as string | null) ?? null,
      date_added: String(record.date_added ?? today),
      comments: (record.comments as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberMedications") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      medication_name: String(record.medication_name ?? ""),
      date_started: String(record.date_started ?? String(record.created_at ?? nowIso).slice(0, 10)),
      medication_status: record.medication_status === "inactive" ? "inactive" : "active",
      inactivated_at: (record.inactivated_at as string | null) ?? null,
      dose: (record.dose as string | null) ?? null,
      quantity: (record.quantity as string | null) ?? null,
      form: (record.form as string | null) ?? null,
      frequency: (record.frequency as string | null) ?? null,
      route: (record.route as string | null) ?? null,
      route_laterality: (record.route_laterality as string | null) ?? null,
      comments: (record.comments as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberAllergies") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      allergy_group:
        record.allergy_group === "food" || record.allergy_group === "medication" || record.allergy_group === "environmental"
          ? record.allergy_group
          : "medication",
      allergy_name: String(record.allergy_name ?? ""),
      severity: (record.severity as string | null) ?? null,
      comments: (record.comments as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberProviders") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      provider_name: String(record.provider_name ?? ""),
      specialty: (record.specialty as string | null) ?? null,
      specialty_other: (record.specialty_other as string | null) ?? null,
      practice_name: (record.practice_name as string | null) ?? null,
      provider_phone: (record.provider_phone as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "providerDirectory") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      provider_name: String(record.provider_name ?? ""),
      specialty: (record.specialty as string | null) ?? null,
      specialty_other: (record.specialty_other as string | null) ?? null,
      practice_name: (record.practice_name as string | null) ?? null,
      provider_phone: (record.provider_phone as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "hospitalPreferenceDirectory") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      hospital_name: String(record.hospital_name ?? "").trim(),
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "busStopDirectory") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      bus_stop_name: String(normalizeBusStopName(record.bus_stop_name) ?? ""),
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberEquipment") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      equipment_type: String(record.equipment_type ?? ""),
      provider_source: (record.provider_source as string | null) ?? null,
      status: (record.status as string | null) ?? null,
      comments: (record.comments as string | null) ?? null,
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }

  if (key === "memberNotes") {
    const staff = pickStaffById(String(record.created_by_user_id ?? ""), String(record.created_by_name ?? ""));
    return {
      member_id: String(record.member_id ?? ""),
      note_type: String(record.note_type ?? "General"),
      note_text: String(record.note_text ?? ""),
      created_by_user_id: String(record.created_by_user_id ?? staff.id),
      created_by_name: String(record.created_by_name ?? staff.full_name),
      created_at: String(record.created_at ?? nowIso),
      updated_at: String(record.updated_at ?? nowIso)
    };
  }
  return record;
}

function canonicalAncillaryCategoryId(name: string) {
  return `ancillary-category-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function defaultClosureRuleSeeds(nowIso: string) {
  const base = {
    created_at: nowIso,
    updated_at: nowIso,
    updated_by_user_id: null,
    updated_by_name: "System"
  };
  return [
    {
      id: `closure-rule-${hashFromKey("Memorial Day").toString(16)}`,
      name: "Memorial Day",
      rule_type: "nth_weekday" as const,
      month: 5,
      day: null,
      weekday: "monday" as const,
      occurrence: "last" as const,
      observed_when_weekend: "none" as const,
      active: true,
      ...base
    },
    {
      id: `closure-rule-${hashFromKey("Labor Day").toString(16)}`,
      name: "Labor Day",
      rule_type: "nth_weekday" as const,
      month: 9,
      day: null,
      weekday: "monday" as const,
      occurrence: "first" as const,
      observed_when_weekend: "none" as const,
      active: true,
      ...base
    },
    {
      id: `closure-rule-${hashFromKey("Thanksgiving").toString(16)}`,
      name: "Thanksgiving",
      rule_type: "nth_weekday" as const,
      month: 11,
      day: null,
      weekday: "thursday" as const,
      occurrence: "fourth" as const,
      observed_when_weekend: "none" as const,
      active: true,
      ...base
    },
    {
      id: `closure-rule-${hashFromKey("July 4").toString(16)}`,
      name: "July 4",
      rule_type: "fixed" as const,
      month: 7,
      day: 4,
      weekday: null,
      occurrence: null,
      observed_when_weekend: "nearest_weekday" as const,
      active: true,
      ...base
    },
    {
      id: `closure-rule-${hashFromKey("Christmas").toString(16)}`,
      name: "Christmas",
      rule_type: "fixed" as const,
      month: 12,
      day: 25,
      weekday: null,
      occurrence: null,
      observed_when_weekend: "nearest_weekday" as const,
      active: true,
      ...base
    }
  ] satisfies MockDb["closureRules"];
}

function ensureClosureRulesSeeded() {
  if (!Array.isArray(db.closureRules)) {
    db.closureRules = [];
  }
  const defaults = defaultClosureRuleSeeds(toEasternISO());
  const existingByName = new Map(
    db.closureRules.map((row) => [String(row.name ?? "").trim().toLowerCase(), row] as const)
  );
  let changed = false;
  defaults.forEach((rule) => {
    const key = rule.name.trim().toLowerCase();
    if (existingByName.has(key)) return;
    db.closureRules.push(rule);
    changed = true;
  });
  if (changed) {
    db.closureRules.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }
  return changed;
}

function ensureAutoGeneratedCenterClosuresForYears(years: number[]) {
  if (!Array.isArray(db.centerClosures)) {
    db.centerClosures = [];
  }
  if (!Array.isArray(db.closureRules) || db.closureRules.length === 0) {
    return false;
  }
  const rules = db.closureRules.filter((rule) => rule.active) as ClosureRuleLike[];
  const existingDates = new Set(db.centerClosures.map((row) => String(row.closure_date ?? "").slice(0, 10)));
  let changed = false;
  years.forEach((year) => {
    generateClosureDatesFromRules({ year, rules }).forEach((generated) => {
      if (existingDates.has(generated.date)) return;
      existingDates.add(generated.date);
      db.centerClosures.push({
        id: `center-closure-auto-${generated.date}-${generated.ruleId}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
        closure_date: generated.date,
        closure_name: generated.reason,
        closure_type: "Holiday",
        auto_generated: true,
        closure_rule_id: generated.ruleId,
        billable_override: false,
        notes: generated.observed ? "Observed closure generated from holiday rule." : null,
        active: true,
        created_at: toEasternISO(),
        updated_at: toEasternISO(),
        updated_by_user_id: null,
        updated_by_name: "System"
      });
      changed = true;
    });
  });
  if (changed) {
    db.centerClosures.sort((left, right) => (left.closure_date < right.closure_date ? 1 : -1));
  }
  return changed;
}

function ensureCenterClosureAutomationState() {
  const currentYear = Number(toEasternDate().slice(0, 4));
  const years = [currentYear, currentYear + 1];
  const seededRules = ensureClosureRulesSeeded();
  const seededClosures = ensureAutoGeneratedCenterClosuresForYears(years);
  if (seededRules || seededClosures) {
    persistMockRepoState();
  }
}

function ensureCanonicalAncillaryCategories() {
  if (!Array.isArray(db.ancillaryCategories)) {
    db.ancillaryCategories = [];
  }

  const existingByName = new Map(
    db.ancillaryCategories.map((category) => [String(category.name ?? "").trim().toLowerCase(), category] as const)
  );
  let changed = false;

  ANCILLARY_CHARGE_CATALOG.forEach((entry) => {
    const key = entry.name.trim().toLowerCase();
    const existing = existingByName.get(key);

    if (!existing) {
      db.ancillaryCategories.push({
        id: canonicalAncillaryCategoryId(entry.name),
        name: entry.name,
        price_cents: entry.price_cents
      });
      changed = true;
      return;
    }

    if (!Number.isFinite(existing.price_cents)) {
      existing.price_cents = entry.price_cents;
      changed = true;
    }
  });

  if (changed) {
    persistMockRepoState();
  }
}

export function getMockDb() {
  ensureCenterClosureAutomationState();
  ensureCanonicalAncillaryCategories();
  return db;
}

export function getMemberName(memberId: string) {
  return db.members.find((member) => member.id === memberId)?.display_name ?? "Unknown Member";
}

export function getStaffName(staffId: string) {
  return db.staff.find((staff) => staff.id === staffId)?.full_name ?? "Unknown Staff";
}

export function replaceMockStaff(staffRows: MockDb["staff"]) {
  db.staff = [...staffRows];
  persistMockRepoState();
}

function createMockUuid() {
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function normalizeMemberName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function getMappedMemberForLead(leadId?: string | null) {
  const normalizedLeadId = leadId?.trim() ?? "";
  if (!normalizedLeadId) return null;
  const mappedMemberId = leadMemberMap.get(normalizedLeadId);
  if (!mappedMemberId) return null;
  return db.members.find((member) => member.id === mappedMemberId) ?? null;
}

function mapLeadToMember(leadId: string | null | undefined, memberId: string) {
  const normalizedLeadId = leadId?.trim() ?? "";
  if (!normalizedLeadId) return;
  leadMemberMap.set(normalizedLeadId, memberId);
}

function isEnrolledLeadStage(stage: string | null | undefined) {
  const normalized = (stage ?? "").trim().toLowerCase();
  return normalized === "closed - won" || normalized.includes("enroll");
}

export function upsertMemberFromLead(
  memberName: string,
  options?: { enrollmentDate?: string | null; stage?: string | null; status?: string | null; leadId?: string | null }
) {
  const normalizedName = normalizeMemberName(memberName);
  if (!normalizedName) return null;

  const statusNormalized = (options?.status ?? "").trim().toLowerCase();
  const shouldActivate = statusNormalized === "won" || statusNormalized.includes("enroll") || isEnrolledLeadStage(options?.stage);
  if (!shouldActivate) return null;

  const existingMapped = getMappedMemberForLead(options?.leadId);
  if (existingMapped) {
    existingMapped.status = "active";
    existingMapped.enrollment_date = existingMapped.enrollment_date || options?.enrollmentDate?.trim() || toEasternDate();
    mapLeadToMember(options?.leadId, existingMapped.id);
    persistMockRepoState();
    return existingMapped;
  }

  const assessedForLead =
    options?.leadId?.trim() &&
    db.assessments.find((assessment) => assessment.lead_id === options.leadId && assessment.member_id)?.member_id;
  if (assessedForLead) {
    const matchedAssessmentMember = db.members.find((member) => member.id === assessedForLead);
    if (matchedAssessmentMember) {
      matchedAssessmentMember.status = "active";
      matchedAssessmentMember.enrollment_date =
        matchedAssessmentMember.enrollment_date || options?.enrollmentDate?.trim() || toEasternDate();
      mapLeadToMember(options?.leadId, matchedAssessmentMember.id);
      persistMockRepoState();
      return matchedAssessmentMember;
    }
  }

  const existing = db.members.find((member) => member.display_name.trim().toLowerCase() === normalizedName.toLowerCase());
  const enrollmentDate = options?.enrollmentDate?.trim() || toEasternDate();

  if (existing) {
    existing.status = "active";
    existing.enrollment_date = existing.enrollment_date || enrollmentDate;
    mapLeadToMember(options?.leadId, existing.id);
    persistMockRepoState();
    return existing;
  }

  const created: MockDb["members"][number] = {
    id: createMockUuid(),
    display_name: normalizedName,
    locker_number: null,
    status: "active",
    discharge_date: null,
    discharge_reason: null,
    discharge_disposition: null,
    discharged_by: null,
    qr_code: `QR-${String(counter + 1).padStart(4, "0")}`,
    enrollment_date: enrollmentDate,
    dob: null,
    city: null,
    allergies: null,
    code_status: null,
    orientation_dob_verified: null,
    orientation_city_verified: null,
    orientation_year_verified: null,
    orientation_occupation_verified: null,
    medication_management_status: null,
    dressing_support_status: null,
    assistive_devices: null,
    incontinence_products: null,
    on_site_medication_use: null,
    on_site_medication_list: null,
    diet_type: null,
    diet_restrictions_notes: null,
    mobility_status: null,
    mobility_aids: null,
    social_triggers: null,
    joy_sparks: null,
    personal_notes: null,
    transport_can_enter_exit_vehicle: null,
    transport_assistance_level: null,
    transport_mobility_aid: null,
    transport_can_remain_seated_buckled: null,
    transport_behavior_concern: null,
    transport_appropriate: null,
    latest_assessment_id: null,
    latest_assessment_date: null,
    latest_assessment_score: null,
    latest_assessment_track: null,
    latest_assessment_admission_review_required: null
  };

  db.members.unshift(created);
  mapLeadToMember(options?.leadId, created.id);
  persistMockRepoState();
  return created;
}

export function ensureIntakeMemberFromLead(input: {
  memberName: string;
  leadId?: string | null;
  enrollmentDate?: string | null;
}) {
  const normalizedName = normalizeMemberName(input.memberName);
  if (!normalizedName) return null;

  const existingMapped = getMappedMemberForLead(input.leadId);
  if (existingMapped) {
    return existingMapped;
  }

  const assessedForLead =
    input.leadId?.trim() &&
    db.assessments.find((assessment) => assessment.lead_id === input.leadId && assessment.member_id)?.member_id;
  if (assessedForLead) {
    const matchedAssessmentMember = db.members.find((member) => member.id === assessedForLead);
    if (matchedAssessmentMember) {
      mapLeadToMember(input.leadId, matchedAssessmentMember.id);
      persistMockRepoState();
      return matchedAssessmentMember;
    }
  }

  if (!input.leadId?.trim()) {
    const existing = db.members.find((member) => member.display_name.trim().toLowerCase() === normalizedName.toLowerCase());
    if (existing) {
      mapLeadToMember(input.leadId, existing.id);
      persistMockRepoState();
      return existing;
    }
  }

  const created: MockDb["members"][number] = {
    id: createMockUuid(),
    display_name: normalizedName,
    locker_number: null,
    status: "inactive",
    discharge_date: null,
    discharge_reason: null,
    discharge_disposition: null,
    discharged_by: null,
    qr_code: `QR-${String(counter + 1).padStart(4, "0")}`,
    enrollment_date: input.enrollmentDate?.trim() || null,
    dob: null,
    city: null,
    allergies: null,
    code_status: null,
    orientation_dob_verified: null,
    orientation_city_verified: null,
    orientation_year_verified: null,
    orientation_occupation_verified: null,
    medication_management_status: null,
    dressing_support_status: null,
    assistive_devices: null,
    incontinence_products: null,
    on_site_medication_use: null,
    on_site_medication_list: null,
    diet_type: null,
    diet_restrictions_notes: null,
    mobility_status: null,
    mobility_aids: null,
    social_triggers: null,
    joy_sparks: null,
    personal_notes: null,
    transport_can_enter_exit_vehicle: null,
    transport_assistance_level: null,
    transport_mobility_aid: null,
    transport_can_remain_seated_buckled: null,
    transport_behavior_concern: null,
    transport_appropriate: null,
    latest_assessment_id: null,
    latest_assessment_date: null,
    latest_assessment_score: null,
    latest_assessment_track: null,
    latest_assessment_admission_review_required: null
  };

  db.members.unshift(created);
  mapLeadToMember(input.leadId, created.id);
  persistMockRepoState();
  return created;
}

export function getMappedMemberIdForLead(leadId: string) {
  return getMappedMemberForLead(leadId)?.id ?? null;
}

export function setMockMemberStatus(
  memberId: string,
  status: MockDb["members"][number]["status"],
  options?: {
    dischargeReason?: string | null;
    dischargeDisposition?: string | null;
    actorName?: string | null;
  }
) {
  const member = db.members.find((row) => row.id === memberId);
  if (!member) return null;
  const now = toEasternISO();

  member.status = status;
  if (status === "inactive") {
    const lockerBeforeDischarge = normalizeLockerNumber(member.locker_number);
    if (lockerBeforeDischarge) {
      recordLockerHistory({
        lockerNumber: lockerBeforeDischarge,
        previousMemberId: member.id,
        previousMemberName: member.display_name,
        recordedAt: now
      });
    }
    member.discharge_date = toEasternDate();
    member.discharge_reason = options?.dischargeReason?.trim() || null;
    member.discharge_disposition = options?.dischargeDisposition?.trim() || null;
    member.discharged_by = options?.actorName?.trim() || null;
    member.locker_number = null;
    db.memberHolds.forEach((hold) => {
      if (hold.member_id !== memberId || hold.status !== "active") return;
      hold.status = "ended";
      hold.ended_at = now;
      hold.ended_by_user_id = null;
      hold.ended_by_name = options?.actorName?.trim() || null;
      hold.updated_at = now;
    });
  } else {
    member.discharge_date = null;
    member.discharge_reason = null;
    member.discharge_disposition = null;
    member.discharged_by = null;
  }
  persistMockRepoState();
  return member;
}
export function addMockRecord<K extends keyof MockDb>(key: K, record: Partial<Omit<MockDb[K][number], "id">>): MockDb[K][number] {
  const base = withDefaults(key, record as Record<string, unknown>);
  const created = {
    id: nextId(String(key)),
    ...(base as Omit<MockDb[K][number], "id">)
  } as MockDb[K][number];

  (db[key] as MockDb[K][number][]).unshift(created);
  persistMockRepoState();
  return created;
}

function reviewKey(primary: string, secondary: string) {
  return `${primary}::${secondary}`;
}

export function getTimeReview(staffName: string, payPeriod: string): StoredReview | null {
  return timeReviewState.get(reviewKey(staffName, payPeriod)) ?? null;
}

export function setTimeReview(staffName: string, payPeriod: string, review: StoredReview) {
  timeReviewState.set(reviewKey(staffName, payPeriod), review);
  persistMockRepoState();
}

export function getDocumentationReview(staffName: string, periodLabel: string): StoredReview | null {
  return documentationReviewState.get(reviewKey(staffName, periodLabel)) ?? null;
}

export function setDocumentationReview(staffName: string, periodLabel: string, review: StoredReview) {
  documentationReviewState.set(reviewKey(staffName, periodLabel), review);
  persistMockRepoState();
}

export function updateMockRecord<K extends keyof MockDb>(key: K, id: string, patch: Partial<MockDb[K][number]>) {
  const rows = db[key] as MockDb[K][number][];
  const index = rows.findIndex((row) => String((row as { id?: string }).id) === id);
  if (index < 0) return null;

  rows[index] = { ...rows[index], ...patch } as MockDb[K][number];
  persistMockRepoState();
  return rows[index];
}

export function removeMockRecord<K extends keyof MockDb>(key: K, id: string) {
  const rows = db[key] as MockDb[K][number][];
  const index = rows.findIndex((row) => String((row as { id?: string }).id) === id);
  if (index < 0) return false;

  rows.splice(index, 1);
  persistMockRepoState();
  return true;
}

export function addAuditLogEvent(entry: {
  actorUserId: string;
  actorName: string;
  actorRole: AppRole;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  occurredAt?: string;
}) {
  return addMockRecord("auditLogs", {
    actor_user_id: entry.actorUserId,
    actor_name: entry.actorName,
    actor_role: entry.actorRole,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    details_json: safeStringify(entry.details ?? {}),
    occurred_at: entry.occurredAt ?? toEasternISO()
  });
}

export function addLeadStageHistoryEntry(entry: {
  leadId: string;
  fromStage?: string | null;
  toStage: string;
  fromStatus?: string | null;
  toStatus: string;
  changedByUserId: string;
  changedByName: string;
  reason?: string | null;
  source?: string;
  changedAt?: string;
}) {
  return addMockRecord("leadStageHistory", {
    lead_id: entry.leadId,
    from_stage: entry.fromStage ?? null,
    to_stage: entry.toStage,
    from_status: entry.fromStatus ?? null,
    to_status: entry.toStatus,
    changed_at: entry.changedAt ?? toEasternISO(),
    changed_by_user_id: entry.changedByUserId,
    changed_by_name: entry.changedByName,
    reason: entry.reason ?? null,
    source: entry.source ?? "system"
  });
}















