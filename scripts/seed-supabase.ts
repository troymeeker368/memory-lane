import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getCanonicalTrackSections } from "../lib/services/care-plan-track-definitions";
import { buildSeededMockDb } from "../lib/mock/seed";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

type SeedModule = "sales" | "intake" | "attendance";

const VALID_MODULES: SeedModule[] = ["sales", "intake", "attendance"];
const SITE_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_SIZE = 250;
const TARGET_MEMBER_COUNT = 16;
const WEEKDAY_OPTIONS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const LEGACY_DEPENDENCY_TABLES = new Set(["pay_periods", "time_punches"]);

type SeededDb = ReturnType<typeof buildSeededMockDb>;

function loadEnvFiles() {
  const parseEnvValue = (raw: string) => {
    const trimmed = raw.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  for (const fileName of [".env.local", ".env"]) {
    const fullPath = join(process.cwd(), fileName);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = parseEnvValue(trimmed.slice(eqIndex + 1));
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]) {
  let reset = false;
  let legacyOnly = false;
  const modules = new Set<SeedModule>();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--reset") reset = true;
    if (argv[i] === "--legacy-only") legacyOnly = true;
    if (argv[i] === "--module" && argv[i + 1]) {
      const mod = argv[i + 1] as SeedModule;
      if (!VALID_MODULES.includes(mod)) throw new Error(`Invalid module: ${argv[i + 1]}`);
      modules.add(mod);
      i += 1;
    }
    if (argv[i].startsWith("--module=")) {
      const mod = argv[i].split("=")[1] as SeedModule;
      if (!VALID_MODULES.includes(mod)) throw new Error(`Invalid module: ${mod}`);
      modules.add(mod);
    }
  }
  return { reset, legacyOnly, modules: modules.size > 0 ? [...modules] : [...VALID_MODULES] };
}

function assertSafeEnvironment(resetRequested = false) {
  const env = process.env.NODE_ENV ?? "development";
  const appEnv = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "").toLowerCase();
  const isDevLike = env === "development" || env === "test" || appEnv === "development" || appEnv === "preview" || appEnv === "local";

  if (env === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error("Refusing production seed. Set ALLOW_PRODUCTION_SEED=true to override.");
  }
  if (resetRequested && !isDevLike && process.env.ALLOW_NON_DEV_RESEED !== "true") {
    throw new Error("Reset/reseed is restricted to development-style environments. Set ALLOW_NON_DEV_RESEED=true to override.");
  }
}

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function parseLatLng(value: string | null | undefined) {
  if (!value) return { lat: null, lng: null };
  const [a, b] = value.split(",").map((v) => Number(v.trim()));
  if (Number.isNaN(a) || Number.isNaN(b)) return { lat: null, lng: null };
  return { lat: a, lng: b };
}

function asDateOnly(value: string | null | undefined, fallback: string | null = null) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIsoAt(date: string, hours = 12, minutes = 0) {
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00.000Z`;
}

function toTimeOnly(value: string | null | undefined) {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) return null;
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const mm = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ensureUuid(value: string | null | undefined, fallbackKey: string) {
  if (isUuid(value)) return value as string;
  return stableUuid(fallbackKey);
}

function isMissingTableError(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined, table: string) {
  if (!error) return false;
  if (error.code === "PGRST205") return true;
  const blob = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return blob.includes(table.toLowerCase()) && (blob.includes("does not exist") || blob.includes("not found") || blob.includes("schema cache"));
}

async function discoverExistingTables(supabase: ReturnType<typeof createSupabaseAdminClient>, tables: string[]) {
  const entries = await Promise.all(
    [...new Set(tables)].map(async (table) => {
      const { error } = await supabase.from(table).select("id", { count: "exact", head: true }).limit(1);
      if (!error) return [table, true] as const;
      if (isMissingTableError(error, table)) return [table, false] as const;
      throw new Error(`Unable to inspect table ${table}: ${error.message}`);
    })
  );
  return new Map(entries);
}

async function upsertRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
  existingTables?: Map<string, boolean>
) {
  if (existingTables?.get(table) === false) {
    console.log(`Skipping ${table}: table not found in current schema.`);
    return 0;
  }
  if (rows.length === 0) return 0;
  const dedupedById = new Map<string, Record<string, unknown>>();
  const withoutId: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = row.id;
    if (typeof id === "string" && id.trim().length > 0) {
      dedupedById.set(id, row);
    } else {
      withoutId.push(row);
    }
  }
  const normalizedRows = [...dedupedById.values(), ...withoutId];
  let inserted = 0;
  for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
    const batch = normalizedRows.slice(i, i + BATCH_SIZE);
    let { error } = await supabase.from(table).upsert(batch, { onConflict: "id" });
    if (error?.message?.toLowerCase().includes("no unique or exclusion constraint matching the on conflict specification")) {
      const retry = await supabase.from(table).upsert(batch);
      error = retry.error;
      if (error?.message?.toLowerCase().includes("no unique or exclusion constraint matching the on conflict specification")) {
        const fallbackInsert = await supabase.from(table).insert(batch);
        error = fallbackInsert.error;
      }
    }
    if (error) {
      if (isMissingTableError(error as { code?: string | null; message?: string | null; details?: string | null }, table)) {
        console.log(`Skipping ${table}: table not found in current schema.`);
        return 0;
      }
      throw new Error(`Upsert ${table} failed: ${error.message}`);
    }
    inserted += Math.min(BATCH_SIZE, normalizedRows.length - i);
  }
  return inserted;
}

async function deleteRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  existingTables?: Map<string, boolean>
) {
  if (existingTables?.get(table) === false) return;
  const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) {
    if (isMissingTableError(error, table)) return;
    throw new Error(`Reset ${table} failed: ${error.message}`);
  }
}

async function ensureAuthProfiles(supabase: ReturnType<typeof createSupabaseAdminClient>, db: SeededDb) {
  const map = new Map<string, string>();
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(listError.message);
  const byEmail = new Map((usersData.users ?? []).filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u.id] as const));

  for (const staff of db.staff) {
    const email = staff.email.toLowerCase();
    let userId = byEmail.get(email) ?? null;
    if (!userId) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: "SeedDataOnly!123",
        email_confirm: true,
        user_metadata: { full_name: staff.full_name, role: staff.role }
      });
      if (error) throw new Error(`Create auth user failed (${email}): ${error.message}`);
      userId = data.user?.id ?? null;
      if (!userId) throw new Error(`Auth id missing for ${email}`);
      byEmail.set(email, userId);
    }
    map.set(staff.id, userId);
  }

  const profileRows: Record<string, unknown>[] = [];
  db.staff.forEach((staff) => {
    const userId = map.get(staff.id);
    if (!userId) return;
    profileRows.push({
      id: userId,
      email: staff.email,
      full_name: staff.full_name,
      staff_id: staff.staff_id,
      role: staff.role,
      active: staff.active
    });
  });
  await upsertRows(supabase, "profiles", profileRows);
  return map;
}

function buildIntakeCascade(db: SeededDb, staffMap: Map<string, string>) {
  const byMemberDiagnoses = new Map<string, unknown[]>();
  const byMemberAllergies = new Map<string, unknown[]>();
  const byMemberMeds = new Map<string, unknown[]>();
  db.memberDiagnoses.forEach((row) => byMemberDiagnoses.set(row.member_id, [...(byMemberDiagnoses.get(row.member_id) ?? []), row]));
  db.memberAllergies.forEach((row) => byMemberAllergies.set(row.member_id, [...(byMemberAllergies.get(row.member_id) ?? []), row]));
  db.memberMedications.forEach((row) => byMemberMeds.set(row.member_id, [...(byMemberMeds.get(row.member_id) ?? []), row]));

  const pofRows: Record<string, unknown>[] = [];
  const mhpRows: Record<string, unknown>[] = [];
  db.members.forEach((member, idx) => {
    const signedId = stableUuid(`pof-signed-${member.id}`);
    const oldSignedId = stableUuid(`pof-old-${member.id}`);
    const draftId = stableUuid(`pof-draft-${member.id}`);
    const sentId = stableUuid(`pof-sent-${member.id}`);
    const diagnoses = byMemberDiagnoses.get(member.id) ?? [];
    const allergies = byMemberAllergies.get(member.id) ?? [];
    const medications = byMemberMeds.get(member.id) ?? [];
    const sourceAssessment = db.assessments.find((row) => row.member_id === member.id) ?? null;
    const actor = sourceAssessment?.created_by_user_id ? staffMap.get(sourceAssessment.created_by_user_id) ?? null : null;

    if (idx < 4) {
      pofRows.push({
        id: oldSignedId,
        member_id: member.id,
        intake_assessment_id: sourceAssessment?.id ?? null,
        version_number: 1,
        status: "superseded",
        is_active_signed: false,
        superseded_by: signedId,
        diagnoses,
        allergies,
        medications,
        created_by_user_id: actor,
        updated_by_user_id: actor
      });
    }

    pofRows.push({
      id: signedId,
      member_id: member.id,
      intake_assessment_id: sourceAssessment?.id ?? null,
      version_number: idx < 4 ? 2 : 1,
      status: "signed",
      is_active_signed: true,
      diagnoses,
      allergies,
      medications,
      created_by_user_id: actor,
      updated_by_user_id: actor
    });

    if (idx >= 4 && idx < 8) {
      pofRows.push({
        id: sentId,
        member_id: member.id,
        intake_assessment_id: sourceAssessment?.id ?? null,
        version_number: 3,
        status: "sent",
        is_active_signed: false,
        diagnoses,
        allergies,
        medications,
        created_by_user_id: actor,
        updated_by_user_id: actor
      });
    }
    if (idx >= 8 && idx < 12) {
      pofRows.push({
        id: draftId,
        member_id: member.id,
        intake_assessment_id: sourceAssessment?.id ?? null,
        version_number: 3,
        status: "draft",
        is_active_signed: false,
        diagnoses,
        allergies,
        medications,
        created_by_user_id: actor,
        updated_by_user_id: actor
      });
    }

    mhpRows.push({
      id: stableUuid(`mhp-${member.id}`),
      member_id: member.id,
      active_physician_order_id: signedId,
      diagnoses,
      allergies,
      medications,
      profile_notes: member.personal_notes ?? null,
      joy_sparks: member.joy_sparks ?? null,
      last_synced_at: new Date().toISOString()
    });
  });

  return { pofRows, mhpRows };
}

function withMemberCohort(db: SeededDb) {
  const activeMembers = db.members.filter((row) => row.status === "active");
  const inactiveMembers = db.members.filter((row) => row.status !== "active");
  const activeTarget = Math.min(Math.max(10, TARGET_MEMBER_COUNT - 2), activeMembers.length);
  const selectedMembers = [...activeMembers.slice(0, activeTarget), ...inactiveMembers.slice(0, TARGET_MEMBER_COUNT - activeTarget)];
  const memberIdSet = new Set(selectedMembers.map((row) => row.id));
  const hasMember = (id: string | null | undefined) => Boolean(id && memberIdSet.has(id));

  const filteredAssessments = db.assessments.filter((row) => hasMember(row.member_id));
  const assessmentIdSet = new Set(filteredAssessments.map((row) => row.id));

  const filteredMemberBillingSettings = db.memberBillingSettings.filter((row) => hasMember(row.member_id));
  const payorIdSet = new Set(filteredMemberBillingSettings.map((row) => row.payor_id).filter((value): value is string => Boolean(value)));

  return {
    ...db,
    members: selectedMembers,
    memberCommandCenters: db.memberCommandCenters.filter((row) => hasMember(row.member_id)),
    memberAttendanceSchedules: db.memberAttendanceSchedules.filter((row) => hasMember(row.member_id)),
    memberHolds: db.memberHolds.filter((row) => hasMember(row.member_id)),
    transportationManifestAdjustments: db.transportationManifestAdjustments.filter((row) => hasMember(row.member_id)),
    memberContacts: db.memberContacts.filter((row) => hasMember(row.member_id)),
    memberFiles: db.memberFiles.filter((row) => hasMember(row.member_id)),
    attendanceRecords: db.attendanceRecords.filter((row) => hasMember(row.member_id)),
    dailyActivities: db.dailyActivities.filter((row) => hasMember(row.member_id)),
    toiletLogs: db.toiletLogs.filter((row) => hasMember(row.member_id)),
    showerLogs: db.showerLogs.filter((row) => hasMember(row.member_id)),
    transportationLogs: db.transportationLogs.filter((row) => hasMember(row.member_id)),
    photoUploads: db.photoUploads.filter((row) => hasMember(row.member_id)),
    bloodSugarLogs: db.bloodSugarLogs.filter((row) => hasMember(row.member_id)),
    ancillaryLogs: db.ancillaryLogs.filter((row) => hasMember(row.member_id)),
    payors: db.payors.filter((row) => payorIdSet.has(row.id)),
    memberBillingSettings: filteredMemberBillingSettings,
    billingScheduleTemplates: db.billingScheduleTemplates.filter((row) => hasMember(row.member_id)),
    billingAdjustments: db.billingAdjustments.filter((row) => hasMember(row.member_id)),
    billingInvoices: db.billingInvoices.filter((row) => hasMember(row.member_id)),
    billingInvoiceLines: db.billingInvoiceLines.filter((row) => hasMember((row as { member_id?: string }).member_id)),
    billingCoverages: db.billingCoverages.filter((row) => hasMember(row.member_id)),
    assessments: filteredAssessments,
    assessmentResponses: db.assessmentResponses.filter((row) => assessmentIdSet.has(row.assessment_id) && hasMember(row.member_id)),
    memberHealthProfiles: db.memberHealthProfiles.filter((row) => hasMember(row.member_id)),
    memberDiagnoses: db.memberDiagnoses.filter((row) => hasMember(row.member_id)),
    memberMedications: db.memberMedications.filter((row) => hasMember(row.member_id)),
    memberAllergies: db.memberAllergies.filter((row) => hasMember(row.member_id)),
    memberProviders: db.memberProviders.filter((row) => hasMember(row.member_id)),
    memberEquipment: db.memberEquipment.filter((row) => hasMember(row.member_id)),
    memberNotes: db.memberNotes.filter((row) => hasMember(row.member_id))
  };
}

function addMonths(date: string, months: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function monthEnd(date: string) {
  return addDays(addMonths(date, 1), -1);
}

function computeCarePlanStatus(nextDueDate: string, today: string) {
  const todayDate = new Date(`${today}T00:00:00.000Z`).getTime();
  const dueDate = new Date(`${nextDueDate}T00:00:00.000Z`).getTime();
  const delta = Math.floor((dueDate - todayDate) / 86400000);
  if (delta < 0) return "Overdue";
  if (delta === 0) return "Due Now";
  if (delta <= 14) return "Due Soon";
  return "Completed";
}

function normalizeTrack(value: string | null | undefined): "Track 1" | "Track 2" | "Track 3" {
  if (value === "Track 1" || value === "Track 2" || value === "Track 3") return value;
  const text = String(value ?? "").toLowerCase();
  if (text.includes("1")) return "Track 1";
  if (text.includes("2")) return "Track 2";
  if (text.includes("3")) return "Track 3";
  return "Track 2";
}

function normalizeLeadStatus(value: string | null | undefined): "open" | "won" | "lost" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "won" || normalized === "lost") return normalized;
  return "open";
}

function buildScheduleChanges(db: SeededDb, staffMap: Map<string, string>) {
  const coordinator =
    db.staff.find((row) => row.role === "coordinator" && row.active) ??
    db.staff.find((row) => row.role === "manager" && row.active) ??
    db.staff.find((row) => row.role === "admin" && row.active) ??
    db.staff[0];
  const enteredByUserId = coordinator ? staffMap.get(coordinator.id) ?? null : null;
  const enteredBy = coordinator?.full_name ?? "Coordinator";
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const scheduleByMember = new Map(db.memberAttendanceSchedules.map((row) => [row.member_id, row] as const));
  const activeMembers = db.members.filter((row) => row.status === "active").slice(0, 10);

  return activeMembers.map((member, idx) => {
    const schedule = scheduleByMember.get(member.id);
    const enabledDays = WEEKDAY_OPTIONS.filter((day) => Boolean(schedule?.[day]));
    const fallbackDay = WEEKDAY_OPTIONS[idx % WEEKDAY_OPTIONS.length];
    const originalDays = enabledDays.length > 0 ? enabledDays : [fallbackDay];
    const changeType =
      idx % 5 === 0
        ? "Scheduled Absence"
        : idx % 5 === 1
          ? "Makeup Day"
          : idx % 5 === 2
            ? "Day Swap"
            : idx % 5 === 3
              ? "Temporary Schedule Change"
              : "Permanent Schedule Change";
    const effectiveStartDate = addDays(today, -(idx * 3 + 10));
    const effectiveEndDate =
      changeType === "Permanent Schedule Change" ? null : addDays(effectiveStartDate, changeType === "Scheduled Absence" ? 2 : 21);
    const newDay =
      WEEKDAY_OPTIONS[(WEEKDAY_OPTIONS.indexOf(originalDays[0] as (typeof WEEKDAY_OPTIONS)[number]) + 2) % WEEKDAY_OPTIONS.length];
    const newDays =
      changeType === "Scheduled Absence"
        ? []
        : changeType === "Makeup Day"
          ? [newDay]
          : changeType === "Day Swap"
            ? [newDay]
            : [...new Set([newDay, ...originalDays.slice(0, 2)])];
    const status: "active" | "cancelled" | "completed" = idx % 6 === 0 ? "cancelled" : idx % 4 === 0 ? "completed" : "active";
    return {
      id: `schedule-change-${idx + 1}-${member.id.slice(0, 8)}`,
      member_id: member.id,
      change_type: changeType,
      effective_start_date: effectiveStartDate,
      effective_end_date: effectiveEndDate,
      original_days: originalDays,
      new_days: newDays,
      suspend_base_schedule: changeType !== "Scheduled Absence" && changeType !== "Makeup Day",
      reason:
        changeType === "Scheduled Absence"
          ? "Planned family trip."
          : changeType === "Makeup Day"
            ? "Makeup day for prior scheduled absence."
            : changeType === "Day Swap"
              ? "Recurring appointment conflict."
              : changeType === "Temporary Schedule Change"
                ? "Temporary caregiver availability change."
                : "Member requested long-term schedule adjustment.",
      notes: idx % 2 === 0 ? "Seeded schedule-change record for operations testing." : null,
      entered_by: enteredBy,
      entered_by_user_id: enteredByUserId,
      status,
      created_at: toIsoAt(addDays(effectiveStartDate, -1), 9, 0),
      updated_at: toIsoAt(effectiveStartDate, 11, 0),
      closed_at: status === "active" ? null : toIsoAt(addDays(effectiveStartDate, 5), 15, 0),
      closed_by: status === "active" ? null : enteredBy,
      closed_by_user_id: status === "active" ? null : enteredByUserId
    };
  });
}

function buildCarePlanRows(db: SeededDb, staffMap: Map<string, string>) {
  const actor =
    db.staff.find((row) => row.role === "nurse" && row.active) ??
    db.staff.find((row) => row.role === "admin" && row.active) ??
    db.staff[0];
  const actorUserId = actor ? staffMap.get(actor.id) ?? null : null;
  const actorName = actor?.full_name ?? "Clinical Lead";
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const members = db.members.filter((row) => row.status === "active").slice(0, 8);

  const carePlans: Record<string, unknown>[] = [];
  const carePlanSections: Record<string, unknown>[] = [];
  const carePlanVersions: Record<string, unknown>[] = [];
  const carePlanReviewHistory: Record<string, unknown>[] = [];

  members.forEach((member, idx) => {
    const planId = stableUuid(`care-plan:${member.id}`);
    const track = normalizeTrack(member.latest_assessment_track);
    const enrollmentDate = asDateOnly(member.enrollment_date, addDays(today, -(120 + idx * 11))) as string;
    const reviewDate = addDays(enrollmentDate, 30 + idx * 2);
    const dateOfCompletion = idx % 4 === 3 ? null : addDays(today, -(40 + idx * 3));
    const nextDueDate =
      idx % 4 === 0 ? addDays(today, -5 - idx) : idx % 4 === 1 ? today : idx % 4 === 2 ? addDays(today, 7 + idx) : addDays(today, 33 + idx);
    const status = computeCarePlanStatus(nextDueDate, today);
    const modificationsRequired = idx % 3 !== 0;
    const modificationsDescription = modificationsRequired
      ? "Adjusted socialization interventions and transfer support prompts."
      : "";

    const caregiverName = `Caregiver ${idx + 1}`;
    const caregiverEmail = `caregiver${idx + 1}@example.com`;

    carePlans.push({
      id: planId,
      member_id: member.id,
      track,
      enrollment_date: enrollmentDate,
      review_date: reviewDate,
      last_completed_date: dateOfCompletion,
      next_due_date: nextDueDate,
      status,
      completed_by: dateOfCompletion ? actorName : null,
      date_of_completion: dateOfCompletion,
      responsible_party_signature: dateOfCompletion ? "Family Signature" : null,
      responsible_party_signature_date: dateOfCompletion,
      administrator_signature: dateOfCompletion ? actorName : null,
      administrator_signature_date: dateOfCompletion,
      care_team_notes: "Seeded interdisciplinary notes for quarterly care-plan review.",
      no_changes_needed: !modificationsRequired,
      modifications_required: modificationsRequired,
      modifications_description: modificationsDescription,
      nurse_designee_user_id: actorUserId,
      nurse_designee_name: actorName,
      nurse_signed_at: dateOfCompletion ? toIsoAt(dateOfCompletion, 12, 0) : null,
      caregiver_name: caregiverName,
      caregiver_email: caregiverEmail,
      caregiver_signature_status: dateOfCompletion ? "ready_to_send" : "not_requested",
      caregiver_sent_at: null,
      caregiver_sent_by_user_id: null,
      caregiver_viewed_at: null,
      caregiver_signed_at: null,
      caregiver_signature_request_token: null,
      caregiver_signature_expires_at: null,
      caregiver_signature_request_url: null,
      caregiver_signed_name: null,
      caregiver_signature_image_url: null,
      caregiver_signature_ip: null,
      caregiver_signature_user_agent: null,
      caregiver_signature_error: null,
      final_member_file_id: null,
      legacy_cleanup_flag: false,
      created_by_user_id: actorUserId,
      created_by_name: actorName,
      updated_by_user_id: actorUserId,
      updated_by_name: actorName,
      created_at: toIsoAt(addDays(enrollmentDate, 1), 10, 15),
      updated_at: toIsoAt(today, 9, 10)
    });

    const sectionsSnapshot = getCanonicalTrackSections(track).map((section) => {
      const shortTermGoals = section.shortTermGoals;
      const longTermGoals = section.longTermGoals;
      carePlanSections.push({
        id: stableUuid(`care-plan-section:${planId}:${section.sectionType}`),
        care_plan_id: planId,
        section_type: section.sectionType,
        short_term_goals: shortTermGoals,
        long_term_goals: longTermGoals,
        display_order: section.displayOrder,
        created_at: toIsoAt(addDays(enrollmentDate, 2), 11, 0),
        updated_at: toIsoAt(today, 8, 45)
      });
      return {
        sectionType: section.sectionType,
        shortTermGoals,
        longTermGoals,
        displayOrder: section.displayOrder
      };
    });

    carePlanVersions.push({
      id: stableUuid(`care-plan-version:${planId}:1`),
      care_plan_id: planId,
      version_number: 1,
      snapshot_type: "initial",
      snapshot_date: reviewDate,
      reviewed_by: actorName,
      status,
      next_due_date: nextDueDate,
      no_changes_needed: !modificationsRequired,
      modifications_required: modificationsRequired,
      modifications_description: modificationsDescription,
      care_team_notes: "Initial care-plan snapshot generated from seeded review.",
      sections_snapshot: sectionsSnapshot,
      created_at: toIsoAt(addDays(reviewDate, 1), 14, 20)
    });

    if (idx % 2 === 0) {
      const reviewDate2 = addDays(reviewDate, 180);
      const nextDueDate2 = addDays(reviewDate2, 180);
      const status2 = computeCarePlanStatus(nextDueDate2, today);
      const versionId2 = stableUuid(`care-plan-version:${planId}:2`);
      carePlanVersions.push({
        id: versionId2,
        care_plan_id: planId,
        version_number: 2,
        snapshot_type: "review",
        snapshot_date: reviewDate2,
        reviewed_by: actorName,
        status: status2,
        next_due_date: nextDueDate2,
        no_changes_needed: idx % 4 === 0,
        modifications_required: idx % 4 !== 0,
        modifications_description: idx % 4 !== 0 ? "Added fall-prevention cueing and hydration reminders." : "",
        care_team_notes: "Quarterly review snapshot for test workflow.",
        sections_snapshot: sectionsSnapshot,
        created_at: toIsoAt(addDays(reviewDate2, 1), 13, 30)
      });
      carePlanReviewHistory.push({
        id: stableUuid(`care-plan-review:${planId}:2`),
        care_plan_id: planId,
        review_date: reviewDate2,
        reviewed_by: actorName,
        summary: "Routine interdisciplinary review completed with updated interventions.",
        changes_made: idx % 4 !== 0,
        next_due_date: nextDueDate2,
        version_id: versionId2,
        created_at: toIsoAt(addDays(reviewDate2, 1), 16, 0)
      });
    }
  });

  return {
    carePlans,
    carePlanSections,
    carePlanVersions,
    carePlanReviewHistory
  };
}

function buildBillingRows(db: SeededDb, staffMap: Map<string, string>) {
  const actor =
    db.staff.find((row) => row.role === "coordinator" && row.active) ??
    db.staff.find((row) => row.role === "manager" && row.active) ??
    db.staff.find((row) => row.role === "admin" && row.active) ??
    db.staff[0];
  const actorUserId = actor ? staffMap.get(actor.id) ?? null : null;
  const actorName = actor?.full_name ?? "Billing Coordinator";
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const invoiceMonth = addMonths(today, -1);
  const invoicePeriodStart = invoiceMonth;
  const invoicePeriodEnd = monthEnd(invoiceMonth);

  const settingsByMember = new Map(db.memberBillingSettings.map((row) => [row.member_id, row] as const));
  const scheduleByMember = new Map(db.memberAttendanceSchedules.map((row) => [row.member_id, row] as const));
  const activeMembers = db.members.filter((row) => row.status === "active").slice(0, 10);
  const billedMemberIds = new Set(activeMembers.map((row) => row.id));

  const billingAdjustments: Record<string, unknown>[] = [];
  const billingInvoices: Record<string, unknown>[] = [];
  const billingInvoiceLines: Record<string, unknown>[] = [];
  const billingCoverages: Record<string, unknown>[] = [];
  let invoiceTotal = 0;

  activeMembers.forEach((member, idx) => {
    const invoiceId = stableUuid(`billing-invoice:${member.id}:${invoiceMonth}`);
    const settings = settingsByMember.get(member.id);
    const schedule = scheduleByMember.get(member.id);
    const attendanceDays = db.attendanceRecords.filter(
      (row) => row.member_id === member.id && row.status === "present" && row.attendance_date >= invoicePeriodStart && row.attendance_date <= invoicePeriodEnd
    ).length;
    const scheduledDaysPerWeek =
      (schedule?.monday ? 1 : 0) +
      (schedule?.tuesday ? 1 : 0) +
      (schedule?.wednesday ? 1 : 0) +
      (schedule?.thursday ? 1 : 0) +
      (schedule?.friday ? 1 : 0);
    const billedDays = attendanceDays > 0 ? attendanceDays : Math.max(8, scheduledDaysPerWeek * 4);
    const dailyRate = Number(settings?.custom_daily_rate ?? schedule?.custom_daily_rate ?? schedule?.daily_rate ?? schedule?.default_daily_rate ?? 180);
    const baseProgramAmount = Number((billedDays * dailyRate).toFixed(2));

    const memberTransport = db.transportationLogs.filter(
      (row) => row.member_id === member.id && row.service_date >= invoicePeriodStart && row.service_date <= invoicePeriodEnd
    );
    const transportCount = memberTransport.length;
    const transportRate = settings?.transportation_billing_status === "Waived" ? 0 : 20;
    const transportationAmount = Number((transportCount * transportRate).toFixed(2));

    const memberAncillary = db.ancillaryLogs.filter(
      (row) => row.member_id === member.id && row.service_date >= invoicePeriodStart && row.service_date <= invoicePeriodEnd
    );
    const ancillaryAmount = Number(
      memberAncillary.reduce((sum, row) => sum + Number(row.total_amount ?? row.amount_cents / 100), 0).toFixed(2)
    );

    const adjustmentAmount = idx % 3 === 0 ? -25 : idx % 4 === 0 ? 40 : 0;
    if (adjustmentAmount !== 0) {
      const adjustmentId = stableUuid(`billing-adjustment:${member.id}:${invoiceMonth}`);
      billingAdjustments.push({
        id: adjustmentId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        adjustment_date: addDays(invoicePeriodEnd, -2),
        adjustment_type: adjustmentAmount > 0 ? "ManualCharge" : "Credit",
        description: adjustmentAmount > 0 ? "Additional service support charge." : "Service credit adjustment.",
        quantity: 1,
        unit_rate: Math.abs(adjustmentAmount),
        amount: adjustmentAmount,
        billing_status: "Billed",
        exclusion_reason: null,
        invoice_id: invoiceId,
        created_by_system: false,
        source_table: "attendance_records",
        source_record_id: `${member.id}:${invoiceMonth}`,
        created_by_user_id: actorUserId,
        created_by_name: actorName,
        created_at: toIsoAt(addDays(invoicePeriodEnd, -1), 11, 0),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, -1), 11, 0)
      });
    }

    const totalAmount = Number((baseProgramAmount + transportationAmount + ancillaryAmount + adjustmentAmount).toFixed(2));
    invoiceTotal += totalAmount;
    const invoiceNumber = `ML-${invoiceMonth.replace(/-/g, "")}-${String(idx + 1).padStart(3, "0")}`;

    billingInvoices.push({
      id: invoiceId,
      billing_batch_id: stableUuid(`billing-batch:${invoiceMonth}`),
      member_id: member.id,
      payor_id: settings?.payor_id ?? null,
      invoice_number: invoiceNumber,
      invoice_month: invoiceMonth,
      invoice_source: "BatchGenerated",
      invoice_status: idx % 5 === 0 ? "Sent" : idx % 3 === 0 ? "Finalized" : "Draft",
      export_status: idx % 5 === 0 ? "Exported" : "NotExported",
      billing_mode_snapshot: settings?.billing_mode ?? "Membership",
      monthly_billing_basis_snapshot: settings?.monthly_billing_basis ?? "ScheduledMonthBehind",
      transportation_billing_status_snapshot: settings?.transportation_billing_status ?? "BillNormally",
      billing_method_snapshot: "InvoiceEmail",
      base_period_start: invoicePeriodStart,
      base_period_end: invoicePeriodEnd,
      variable_charge_period_start: invoicePeriodStart,
      variable_charge_period_end: invoicePeriodEnd,
      invoice_date: addDays(invoicePeriodEnd, 1),
      due_date: addDays(invoicePeriodEnd, 16),
      base_program_billed_days: billedDays,
      member_daily_rate_snapshot: dailyRate,
      base_program_amount: baseProgramAmount,
      transportation_amount: transportationAmount,
      ancillary_amount: ancillaryAmount,
      adjustment_amount: adjustmentAmount,
      total_amount: totalAmount,
      notes: "Seeded invoice for billing workflow validation.",
      created_by_user_id: actorUserId,
      created_by_name: actorName,
      finalized_by: idx % 3 === 0 || idx % 5 === 0 ? actorName : null,
      finalized_at: idx % 3 === 0 || idx % 5 === 0 ? toIsoAt(addDays(invoicePeriodEnd, 1), 17, 0) : null,
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 30),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 30)
    });

    const baseLineId = stableUuid(`billing-line:${invoiceId}:base`);
    billingInvoiceLines.push({
      id: baseLineId,
      invoice_id: invoiceId,
      member_id: member.id,
      payor_id: settings?.payor_id ?? null,
      service_date: invoicePeriodEnd,
      service_period_start: invoicePeriodStart,
      service_period_end: invoicePeriodEnd,
      line_type: "BaseProgram",
      description: "Base program charges",
      quantity: billedDays,
      unit_rate: dailyRate,
      amount: baseProgramAmount,
      source_table: "attendance_records",
      source_record_id: `${member.id}:${invoiceMonth}`,
      billing_status: "Billed",
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 45),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 45)
    });
    billingCoverages.push({
      id: stableUuid(`billing-coverage:${invoiceId}:base`),
      member_id: member.id,
      coverage_type: "BaseProgram",
      coverage_start_date: invoicePeriodStart,
      coverage_end_date: invoicePeriodEnd,
      source_invoice_id: invoiceId,
      source_invoice_line_id: baseLineId,
      source_table: "billing_invoice_lines",
      source_record_id: baseLineId,
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 0)
    });

    if (transportationAmount > 0) {
      const transportLineId = stableUuid(`billing-line:${invoiceId}:transport`);
      billingInvoiceLines.push({
        id: transportLineId,
        invoice_id: invoiceId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        service_date: invoicePeriodEnd,
        service_period_start: invoicePeriodStart,
        service_period_end: invoicePeriodEnd,
        line_type: "Transportation",
        description: "Transportation services",
        quantity: transportCount,
        unit_rate: transportRate,
        amount: transportationAmount,
        source_table: "transportation_logs",
        source_record_id: memberTransport[0]?.id ?? `${member.id}:${invoiceMonth}:transport`,
        billing_status: "Billed",
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 50),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 50)
      });
      billingCoverages.push({
        id: stableUuid(`billing-coverage:${invoiceId}:transport`),
        member_id: member.id,
        coverage_type: "Transportation",
        coverage_start_date: invoicePeriodStart,
        coverage_end_date: invoicePeriodEnd,
        source_invoice_id: invoiceId,
        source_invoice_line_id: transportLineId,
        source_table: "billing_invoice_lines",
        source_record_id: transportLineId,
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 5)
      });
    }

    if (ancillaryAmount > 0) {
      const ancillaryLineId = stableUuid(`billing-line:${invoiceId}:ancillary`);
      billingInvoiceLines.push({
        id: ancillaryLineId,
        invoice_id: invoiceId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        service_date: invoicePeriodEnd,
        service_period_start: invoicePeriodStart,
        service_period_end: invoicePeriodEnd,
        line_type: "Ancillary",
        description: "Ancillary service charges",
        quantity: memberAncillary.length,
        unit_rate: memberAncillary.length > 0 ? Number((ancillaryAmount / memberAncillary.length).toFixed(2)) : ancillaryAmount,
        amount: ancillaryAmount,
        source_table: "ancillary_charge_logs",
        source_record_id: memberAncillary[0]?.id ?? `${member.id}:${invoiceMonth}:ancillary`,
        billing_status: "Billed",
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 55),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 55)
      });
      billingCoverages.push({
        id: stableUuid(`billing-coverage:${invoiceId}:ancillary`),
        member_id: member.id,
        coverage_type: "Ancillary",
        coverage_start_date: invoicePeriodStart,
        coverage_end_date: invoicePeriodEnd,
        source_invoice_id: invoiceId,
        source_invoice_line_id: ancillaryLineId,
        source_table: "billing_invoice_lines",
        source_record_id: ancillaryLineId,
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 10)
      });
    }

    if (adjustmentAmount !== 0) {
      const adjustmentLineId = stableUuid(`billing-line:${invoiceId}:adjustment`);
      billingInvoiceLines.push({
        id: adjustmentLineId,
        invoice_id: invoiceId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        service_date: addDays(invoicePeriodEnd, -2),
        service_period_start: null,
        service_period_end: null,
        line_type: adjustmentAmount > 0 ? "Adjustment" : "Credit",
        description: "Manual billing adjustment",
        quantity: 1,
        unit_rate: Math.abs(adjustmentAmount),
        amount: adjustmentAmount,
        source_table: "billing_adjustments",
        source_record_id: stableUuid(`billing-adjustment:${member.id}:${invoiceMonth}`),
        billing_status: "Billed",
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 10, 0),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 10, 0)
      });
      billingCoverages.push({
        id: stableUuid(`billing-coverage:${invoiceId}:adjustment`),
        member_id: member.id,
        coverage_type: "Adjustment",
        coverage_start_date: addDays(invoicePeriodEnd, -2),
        coverage_end_date: addDays(invoicePeriodEnd, -2),
        source_invoice_id: invoiceId,
        source_invoice_line_id: adjustmentLineId,
        source_table: "billing_invoice_lines",
        source_record_id: adjustmentLineId,
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 15)
      });
    }
  });

  const billingBatchId = stableUuid(`billing-batch:${invoiceMonth}`);
  const billingBatches: Record<string, unknown>[] = [
    {
      id: billingBatchId,
      batch_type: "Mixed",
      billing_month: invoiceMonth,
      run_date: addDays(invoicePeriodEnd, 1),
      batch_status: "Finalized",
      invoice_count: billingInvoices.length,
      total_amount: Number(invoiceTotal.toFixed(2)),
      completion_date: addDays(invoicePeriodEnd, 2),
      next_due_date: addDays(invoicePeriodEnd, 30),
      generated_by_user_id: actorUserId,
      generated_by_name: actorName,
      finalized_by: actorName,
      finalized_at: toIsoAt(addDays(invoicePeriodEnd, 2), 16, 30),
      reopened_by: null,
      reopened_at: null,
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 8, 30),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 2), 16, 30)
    }
  ];
  const billingExportJobs: Record<string, unknown>[] = [
    {
      id: stableUuid(`billing-export:${billingBatchId}`),
      billing_batch_id: billingBatchId,
      export_type: "InvoiceSummaryCSV",
      quickbooks_detail_level: "Summary",
      file_name: `billing-summary-${invoiceMonth}.csv`,
      file_data_url: null,
      generated_at: toIsoAt(addDays(invoicePeriodEnd, 3), 10, 0),
      generated_by: actorName,
      status: "Generated",
      notes: "Seeded export artifact for QA validation.",
      created_at: toIsoAt(addDays(invoicePeriodEnd, 3), 10, 0),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 3), 10, 0)
    }
  ];

  const updatedTransportationLogs = db.transportationLogs.map((row, idx) => {
    const shouldBill = billedMemberIds.has(row.member_id) && idx % 5 !== 0;
    const unitRate = Number(row.unit_rate ?? 20);
    const quantity = Number(row.quantity ?? 1);
    return {
      ...row,
      trip_type: row.trip_type ?? "OneWay",
      quantity,
      unit_rate: unitRate,
      total_amount: Number((unitRate * quantity).toFixed(2)),
      billable: row.billable ?? true,
      billing_status: shouldBill ? "Billed" : row.billing_status ?? "Unbilled",
      billing_exclusion_reason: !shouldBill && idx % 7 === 0 ? "Transport included in bundled arrangement." : row.billing_exclusion_reason ?? null,
      invoice_id: shouldBill ? stableUuid(`billing-invoice:${row.member_id}:${invoiceMonth}`) : null
    };
  });
  const updatedAncillaryLogs = db.ancillaryLogs.map((row, idx) => {
    const unitRate = Number(row.unit_rate ?? row.amount_cents / 100);
    const quantity = Number(row.quantity ?? 1);
    const amount = Number((unitRate * quantity).toFixed(2));
    const shouldBill = billedMemberIds.has(row.member_id) && idx % 4 !== 0;
    return {
      ...row,
      unit_rate: unitRate,
      total_amount: amount,
      billing_status: shouldBill ? "Billed" : row.billing_status ?? "Unbilled",
      billing_exclusion_reason: !shouldBill && idx % 9 === 0 ? "Promotional courtesy adjustment." : row.billing_exclusion_reason ?? null,
      invoice_id: shouldBill ? stableUuid(`billing-invoice:${row.member_id}:${invoiceMonth}`) : null
    };
  });

  return {
    billingBatches,
    billingInvoices,
    billingInvoiceLines,
    billingAdjustments,
    billingCoverages,
    billingExportJobs,
    transportationLogs: updatedTransportationLogs,
    ancillaryLogs: updatedAncillaryLogs
  };
}

function buildDerivedRows(db: SeededDb, staffMap: Map<string, string>) {
  const mapStaff = (id: string | null | undefined) => (id ? staffMap.get(id) ?? null : null);
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;

  const manager =
    db.staff.find((row) => row.role === "manager" || row.role === "admin" || row.role === "director") ?? db.staff[0];
  const nurse = db.staff.find((row) => row.role === "nurse") ?? manager;
  const assignableStaff = db.staff.filter((row) => row.active);

  const timePunchExceptions = db.timePunches
    .filter((row) => row.within_fence === false || (row.distance_meters ?? 0) > 120)
    .slice(0, 24)
    .map((row, idx) => {
      const resolved = idx % 3 === 0;
      const exceptionType = row.within_fence === false ? "outside_geofence" : "distance_threshold";
      const message =
        exceptionType === "outside_geofence"
          ? "Punch recorded outside configured site geofence."
          : "Punch distance exceeded configured threshold.";
      return {
        id: ensureUuid(stableUuid(`time-punch-exception:${row.id}`), `time-punch-exception:${row.id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        punch_id: ensureUuid(row.id, `time-punch:${row.id}`),
        exception_type: exceptionType,
        message,
        resolved,
        resolved_by: resolved ? mapStaff(manager.id) : null,
        resolved_at: resolved ? row.punch_at : null,
        created_at: row.punch_at
      };
    })
    .filter((row) => row.staff_user_id);

  const payPeriods = [...db.payPeriods].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const periodForDate = (date: string) =>
    payPeriods.find((row) => row.start_date <= date && row.end_date >= date) ?? null;

  const punchGroups = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      workDate: string;
      inTimes: string[];
      outTimes: string[];
      sampleTimestamp: string;
    }
  >();
  db.punches.forEach((row) => {
    const employeeId = mapStaff(row.employee_id);
    if (!employeeId) return;
    if (row.status === "voided") return;
    const workDate = asDateOnly(row.timestamp);
    if (!workDate) return;
    const key = `${employeeId}:${workDate}`;
    const existing = punchGroups.get(key) ?? {
      employeeId,
      employeeName: row.employee_name,
      workDate,
      inTimes: [],
      outTimes: [],
      sampleTimestamp: row.timestamp
    };
    if (row.type === "in") existing.inTimes.push(row.timestamp);
    if (row.type === "out") existing.outTimes.push(row.timestamp);
    punchGroups.set(key, existing);
  });

  const dailyTimecards = [...punchGroups.values()].map((group) => {
    const sortedIn = [...group.inTimes].sort();
    const sortedOut = [...group.outTimes].sort();
    const firstIn = sortedIn[0] ?? null;
    const lastOut = sortedOut.length > 0 ? sortedOut[sortedOut.length - 1] : null;
    let rawHours = 0;
    if (firstIn && lastOut) {
      const inMs = Date.parse(firstIn);
      const outMs = Date.parse(lastOut);
      if (!Number.isNaN(inMs) && !Number.isNaN(outMs) && outMs > inMs) {
        rawHours = Math.max(0, (outMs - inMs) / 3600000);
      }
    }
    const roundedRaw = Number(rawHours.toFixed(2));
    const mealDeduction = roundedRaw >= 6 ? 0.5 : 0;
    const workedHours = Number(Math.max(0, roundedRaw - mealDeduction).toFixed(2));
    const overtimeHours = Number(Math.max(0, workedHours - 8).toFixed(2));
    const hasException = !firstIn || !lastOut;
    const status: "pending" | "needs_review" | "approved" | "corrected" = hasException
      ? "needs_review"
      : group.workDate < today
        ? "approved"
        : "pending";
    const matchedPeriod = periodForDate(group.workDate);
    return {
      id: ensureUuid(stableUuid(`daily-timecard:${group.employeeId}:${group.workDate}`), `daily-timecard:${group.employeeId}:${group.workDate}`),
      employee_id: group.employeeId,
      employee_name: group.employeeName,
      work_date: group.workDate,
      first_in: firstIn,
      last_out: lastOut,
      raw_hours: roundedRaw,
      meal_deduction_hours: mealDeduction,
      worked_hours: workedHours,
      pto_hours: 0,
      overtime_hours: overtimeHours,
      total_paid_hours: workedHours,
      status,
      director_note: hasException ? "Missing punch pair detected during seed translation." : null,
      approved_by: status === "approved" ? manager.full_name : null,
      approved_at: status === "approved" ? toIsoAt(group.workDate, 18, 0) : null,
      pay_period_id: matchedPeriod ? ensureUuid(matchedPeriod.id, `pay-period:${matchedPeriod.id}`) : null,
      has_exception: hasException,
      created_at: group.sampleTimestamp,
      updated_at: group.sampleTimestamp
    };
  });

  const ptoEntries = db.staff
    .filter((row) => row.active)
    .slice(0, 8)
    .map((row, idx) => {
      const employeeId = mapStaff(row.id);
      if (!employeeId) return null;
      const workDate = addDays(today, -((idx % 5) + 2));
      const type = (["vacation", "sick", "holiday", "personal"] as const)[idx % 4];
      const status = idx % 3 === 0 ? "pending" : "approved";
      return {
        id: ensureUuid(stableUuid(`pto-entry:${employeeId}:${workDate}`), `pto-entry:${employeeId}:${workDate}`),
        employee_id: employeeId,
        employee_name: row.full_name,
        work_date: workDate,
        hours: idx % 2 === 0 ? 8 : 4,
        type,
        status,
        note: "Seeded PTO entry for testing payroll and daily totals.",
        approved_by: status === "approved" ? manager.full_name : null,
        approved_at: status === "approved" ? toIsoAt(workDate, 15, 0) : null,
        created_at: toIsoAt(workDate, 9, 0),
        updated_at: toIsoAt(workDate, 9, 0)
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const ptoByEmployeeDate = new Map<string, number>();
  ptoEntries.forEach((row) => {
    if (row.status === "denied") return;
    const key = `${row.employee_id}:${row.work_date}`;
    ptoByEmployeeDate.set(key, (ptoByEmployeeDate.get(key) ?? 0) + row.hours);
  });

  dailyTimecards.forEach((row) => {
    const ptoHours = ptoByEmployeeDate.get(`${row.employee_id}:${row.work_date}`) ?? 0;
    row.pto_hours = Number(ptoHours.toFixed(2));
    row.total_paid_hours = Number((row.worked_hours + row.pto_hours).toFixed(2));
  });

  const forgottenPunchRequests = dailyTimecards
    .filter((row) => row.has_exception)
    .slice(0, 12)
    .map((row, idx) => {
      const requestType: "missing_in" | "missing_out" | "full_shift" | "edit_shift" = !row.first_in
        ? "missing_in"
        : !row.last_out
          ? "missing_out"
          : "edit_shift";
      const status = idx % 2 === 0 ? "submitted" : "approved";
      return {
        id: ensureUuid(stableUuid(`forgotten-punch:${row.employee_id}:${row.work_date}`), `forgotten-punch:${row.employee_id}:${row.work_date}`),
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        work_date: row.work_date,
        request_type: requestType,
        requested_in: toTimeOnly(row.first_in),
        requested_out: toTimeOnly(row.last_out),
        reason: "Seeded request: missing punch pair detected from translated punch set.",
        employee_note: "Please verify this shift.",
        status,
        director_decision_note: status === "approved" ? "Approved during seed translation." : null,
        approved_by: status === "approved" ? manager.full_name : null,
        approved_at: status === "approved" ? toIsoAt(row.work_date, 14, 0) : null,
        created_at: toIsoAt(row.work_date, 10, 0),
        updated_at: toIsoAt(row.work_date, 10, 0)
      };
    });

  const marEntries = db.memberMedications
    .slice(0, 120)
    .map((row, idx) => {
      const dueDate = asDateOnly(row.date_started, addDays(today, -(idx % 7))) as string;
      const dueAt = toIsoAt(dueDate, 9 + (idx % 3) * 2, 0);
      const status = idx % 4 === 0 ? "scheduled" : idx % 5 === 0 ? "missed" : "administered";
      return {
        id: ensureUuid(row.id, `mar-entry:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        medication_name: row.medication_name,
        due_at: dueAt,
        administered_at: status === "administered" ? toIsoAt(dueDate, 10 + (idx % 3) * 2, 0) : null,
        nurse_user_id: mapStaff(row.created_by_user_id) ?? mapStaff(nurse.id),
        status,
        notes: row.comments ?? null,
        created_at: dueAt
      };
    });

  const activityDateByMember = new Map<string, string>();
  db.dailyActivities.forEach((row) => {
    const current = activityDateByMember.get(row.member_id);
    if (!current || current < row.activity_date) activityDateByMember.set(row.member_id, row.activity_date);
  });

  const documentationTracker = db.members
    .filter((row) => row.status === "active")
    .map((row, idx) => {
      const assigned = assignableStaff[idx % assignableStaff.length] ?? manager;
      const assignedStaffId = mapStaff(assigned.id);
      const startDate = asDateOnly(row.enrollment_date, addDays(today, -(120 + idx))) as string;
      const lastCarePlanUpdate = asDateOnly(row.latest_assessment_date, addDays(startDate, 30));
      const nextCarePlanDue = addDays(lastCarePlanUpdate as string, 180);
      const lastProgressNote = activityDateByMember.get(row.id) ?? addDays(today, -((idx % 10) + 1));
      const nextProgressNoteDue = addDays(lastProgressNote, 30);
      return {
        id: ensureUuid(stableUuid(`doc-tracker:${row.id}`), `doc-tracker:${row.id}`),
        member_id: ensureUuid(row.id, `member:${row.id}`),
        member_name: row.display_name,
        start_date: startDate,
        last_care_plan_update: lastCarePlanUpdate,
        next_care_plan_due: nextCarePlanDue,
        care_plan_done: idx % 4 !== 0,
        last_progress_note: lastProgressNote,
        next_progress_note_due: nextProgressNoteDue,
        note_done: idx % 3 !== 0,
        assigned_staff_user_id: assignedStaffId,
        assigned_staff_name: assigned.full_name,
        qr_code: row.qr_code,
        created_at: toIsoAt(startDate, 9, 0),
        updated_at: toIsoAt(today, 9, 0)
      };
    });

  const documentationAssignments = documentationTracker.flatMap((row) => [
    {
      id: ensureUuid(stableUuid(`doc-assignment:care:${row.member_id}`), `doc-assignment:care:${row.member_id}`),
      member_id: row.member_id,
      assignment_type: "care_plan_review",
      due_at: toIsoAt(row.next_care_plan_due, 20, 0),
      completed: row.care_plan_done,
      completed_at: row.care_plan_done ? toIsoAt(row.next_care_plan_due, 12, 0) : null,
      assigned_staff_user_id: row.assigned_staff_user_id,
      created_at: toIsoAt(today, 8, 30)
    },
    {
      id: ensureUuid(stableUuid(`doc-assignment:progress:${row.member_id}`), `doc-assignment:progress:${row.member_id}`),
      member_id: row.member_id,
      assignment_type: "progress_note",
      due_at: toIsoAt(row.next_progress_note_due, 20, 0),
      completed: row.note_done,
      completed_at: row.note_done ? toIsoAt(row.next_progress_note_due, 13, 0) : null,
      assigned_staff_user_id: row.assigned_staff_user_id,
      created_at: toIsoAt(today, 8, 45)
    }
  ]);

  const documentationEvents = [
    ...db.dailyActivities
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:daily_activity_logs:${row.id}`), `doc-event:daily_activity_logs:${row.id}`),
        event_type: "daily_activity_logged",
        event_table: "daily_activity_logs",
        event_row_id: ensureUuid(row.id, `daily-activity:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.created_at ?? toIsoAt(row.activity_date, 12, 0),
        created_at: row.created_at ?? toIsoAt(row.activity_date, 12, 0)
      }))
      .filter((row) => row.staff_user_id),
    ...db.toiletLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:toilet_logs:${row.id}`), `doc-event:toilet_logs:${row.id}`),
        event_type: "toilet_logged",
        event_table: "toilet_logs",
        event_row_id: ensureUuid(row.id, `toilet-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.event_at,
        created_at: row.event_at
      }))
      .filter((row) => row.staff_user_id),
    ...db.showerLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:shower_logs:${row.id}`), `doc-event:shower_logs:${row.id}`),
        event_type: "shower_logged",
        event_table: "shower_logs",
        event_row_id: ensureUuid(row.id, `shower-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.event_at,
        created_at: row.event_at
      }))
      .filter((row) => row.staff_user_id),
    ...db.transportationLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:transportation_logs:${row.id}`), `doc-event:transportation_logs:${row.id}`),
        event_type: "transport_logged",
        event_table: "transportation_logs",
        event_row_id: ensureUuid(row.id, `transport-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.timestamp,
        created_at: row.timestamp
      }))
      .filter((row) => row.staff_user_id),
    ...db.ancillaryLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:ancillary_charge_logs:${row.id}`), `doc-event:ancillary_charge_logs:${row.id}`),
        event_type: "ancillary_logged",
        event_table: "ancillary_charge_logs",
        event_row_id: ensureUuid(row.id, `ancillary-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.created_at,
        created_at: row.created_at
      }))
      .filter((row) => row.staff_user_id)
  ];

  return {
    timePunchExceptions,
    dailyTimecards,
    forgottenPunchRequests,
    ptoEntries,
    marEntries,
    documentationTracker,
    documentationAssignments,
    documentationEvents
  };
}

function buildRows(sourceDb: SeededDb, staffMap: Map<string, string>) {
  const db = withMemberCohort(sourceDb);
  const mapStaff = (id: string | null | undefined) => (id ? staffMap.get(id) ?? null : null);
  const partnerByExternalId = new Map<string, string>();
  const referralByExternalId = new Map<string, string>();

  const partnerRows = db.partners.map((row) => {
    partnerByExternalId.set(row.partner_id, row.id);
    return { id: row.id, partner_id: row.partner_id, organization_name: row.organization_name, category: row.referral_source_category, active: row.active };
  });
  const referralRows = db.referralSources.map((row) => {
    referralByExternalId.set(row.referral_source_id, row.id);
    return { id: row.id, referral_source_id: row.referral_source_id, partner_id: partnerByExternalId.get(row.partner_id) ?? null, contact_name: row.contact_name, organization_name: row.organization_name, active: row.active };
  });
  const intake = buildIntakeCascade(db, staffMap);
  const derived = buildDerivedRows(db, staffMap);
  const billing = buildBillingRows(db, staffMap);
  const carePlans = buildCarePlanRows(db, staffMap);
  const scheduleChanges = buildScheduleChanges(db, staffMap);

  return {
    sites: [{ id: SITE_ID, site_code: "SITE-ML-01", site_name: "Memory Lane Main Site", latitude: 34.98, longitude: -80.995, fence_radius_meters: 75 }],
    members: db.members.map((row) => ({
      id: row.id,
      display_name: row.display_name,
      status: row.status,
      qr_code: row.qr_code,
      enrollment_date: row.enrollment_date,
      dob: row.dob,
      discharge_date: row.discharge_date,
      discharge_reason: row.discharge_reason,
      discharge_disposition: row.discharge_disposition,
      locker_number: row.locker_number,
      city: row.city,
      code_status: row.code_status,
      discharged_by: row.discharged_by,
      latest_assessment_id: null,
      latest_assessment_date: row.latest_assessment_date,
      latest_assessment_score: row.latest_assessment_score,
      latest_assessment_track: row.latest_assessment_track,
      latest_assessment_admission_review_required: row.latest_assessment_admission_review_required
    })),
    payPeriods: db.payPeriods.map((row) => ({ id: ensureUuid(row.id, `pay-period:${row.id}`), label: row.label, start_date: row.start_date, end_date: row.end_date, is_closed: row.is_closed })),
    timePunches: db.timePunches.map((row) => ({ id: row.id, staff_user_id: mapStaff(row.staff_user_id), site_id: SITE_ID, punch_type: row.punch_type, punch_at: row.punch_at, ...parseLatLng(row.punch_lat_long), distance_meters: row.distance_meters, within_fence: row.within_fence, note: row.note, created_at: row.punch_at })).filter((row) => row.staff_user_id),
    punches: db.punches
      .map((row) => ({
        id: ensureUuid(row.id, `punch:${row.id}`),
        employee_id: mapStaff(row.employee_id),
        employee_name: row.employee_name,
        timestamp: row.timestamp,
        type: row.type,
        source: row.source,
        status: row.status,
        note: row.note,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        linked_time_punch_id: row.linked_time_punch_id ?? null
      }))
      .filter((row) => row.employee_id)
      .filter((row) => !(row.source === "employee" && Boolean(row.linked_time_punch_id))),
    dailyActivities: db.dailyActivities.map((row) => ({ id: row.id, member_id: row.member_id, activity_date: row.activity_date, staff_user_id: mapStaff(row.staff_user_id), activity_1_level: row.activity_1_level, activity_2_level: row.activity_2_level, activity_3_level: row.activity_3_level, activity_4_level: row.activity_4_level, activity_5_level: row.activity_5_level, notes: row.notes, created_at: row.created_at })).filter((row) => row.staff_user_id),
    toiletLogs: db.toiletLogs.map((row) => ({ id: row.id, member_id: row.member_id, event_at: row.event_at, created_at: row.event_at, briefs: row.briefs, member_supplied: row.member_supplied, use_type: row.use_type, staff_user_id: mapStaff(row.staff_user_id), notes: row.notes })).filter((row) => row.staff_user_id),
    showerLogs: db.showerLogs.map((row) => ({ id: row.id, member_id: row.member_id, event_at: row.event_at, created_at: row.event_at, laundry: row.laundry, briefs: row.briefs, staff_user_id: mapStaff(row.staff_user_id) })).filter((row) => row.staff_user_id),
    transportLogs: billing.transportationLogs
      .map((row) => ({
        id: row.id,
        member_id: row.member_id,
        first_name: row.first_name,
        period: row.period,
        transport_type: row.transport_type,
        service_date: row.service_date,
        staff_user_id: mapStaff(row.staff_user_id),
        created_at: row.timestamp,
        trip_type: row.trip_type ?? null,
        quantity: row.quantity ?? 1,
        unit_rate: row.unit_rate ?? 0,
        total_amount: row.total_amount ?? 0,
        billable: row.billable ?? true,
        billing_status: row.billing_status ?? "Unbilled",
        billing_exclusion_reason: row.billing_exclusion_reason ?? null,
        invoice_id: null,
        updated_at: row.timestamp
      }))
      .filter((row) => row.staff_user_id),
    bloodSugar: db.bloodSugarLogs.map((row) => ({ id: row.id, member_id: row.member_id, checked_at: row.checked_at, reading_mg_dl: row.reading_mg_dl, nurse_user_id: mapStaff(row.nurse_user_id), notes: row.notes })),
    photos: db.photoUploads.map((row) => ({ id: row.id, member_id: row.member_id, photo_url: row.photo_url, uploaded_by: mapStaff(row.uploaded_by), uploaded_at: row.uploaded_at })).filter((row) => row.uploaded_by),
    ancillaryCategories: db.ancillaryCategories.map((row) => ({ id: row.id, name: row.name, price_cents: row.price_cents, active: true })),
    ancillaryLogs: billing.ancillaryLogs
      .map((row) => ({
        id: row.id,
        member_id: row.member_id,
        category_id: row.category_id,
        service_date: row.service_date,
        late_pickup_time: row.late_pickup_time,
        staff_user_id: mapStaff(row.staff_user_id),
        notes: row.notes,
        created_at: row.created_at,
        reconciliation_status: row.reconciliation_status,
        reconciled_by: row.reconciled_by,
        reconciled_at: row.reconciled_at,
        reconciliation_note: row.reconciliation_note,
        quantity: row.quantity ?? 1,
        unit_rate: row.unit_rate ?? Number((row.amount_cents / 100).toFixed(2)),
        amount: row.total_amount ?? Number((row.amount_cents / 100).toFixed(2)),
        billing_status: row.billing_status ?? "Unbilled",
        billing_exclusion_reason: row.billing_exclusion_reason ?? null,
        invoice_id: null,
        updated_at: row.created_at
      }))
      .filter((row) => row.staff_user_id),
    timePunchExceptions: derived.timePunchExceptions,
    dailyTimecards: derived.dailyTimecards,
    forgottenPunchRequests: derived.forgottenPunchRequests,
    ptoEntries: derived.ptoEntries,
    documentationTracker: derived.documentationTracker,
    documentationAssignments: derived.documentationAssignments,
    documentationEvents: derived.documentationEvents,
    marEntries: derived.marEntries,
    partners: partnerRows,
    referrals: referralRows,
    leads: db.leads.map((row) => ({ id: row.id, status: normalizeLeadStatus(String(row.status)), stage: row.stage, stage_updated_at: row.stage_updated_at, inquiry_date: row.inquiry_date, tour_date: row.tour_date, tour_completed: row.tour_completed, discovery_date: row.discovery_date, member_start_date: row.member_start_date, caregiver_name: row.caregiver_name, caregiver_relationship: row.caregiver_relationship, caregiver_email: row.caregiver_email, caregiver_phone: row.caregiver_phone, member_name: row.member_name, member_dob: row.member_dob, lead_source: row.lead_source, lead_source_other: row.lead_source_other, referral_name: row.referral_name, likelihood: row.likelihood, next_follow_up_date: row.next_follow_up_date, next_follow_up_type: row.next_follow_up_type, notes_summary: row.notes_summary, lost_reason: row.lost_reason, closed_date: row.closed_date, partner_id: row.partner_id, referral_source_id: row.referral_source_id, created_by_user_id: mapStaff(row.created_by_user_id), created_by_name: row.created_by_name, created_at: row.created_at, updated_at: row.created_at })),
    leadActivities: db.leadActivities.map((row) => ({ id: row.id, lead_id: row.lead_id, member_name: row.member_name, activity_at: row.activity_at, activity_type: row.activity_type, outcome: row.outcome, lost_reason: row.lost_reason, notes: row.notes, next_follow_up_date: row.next_follow_up_date, next_follow_up_type: row.next_follow_up_type, completed_by_user_id: mapStaff(row.completed_by_user_id), completed_by_name: row.completed_by_name, partner_id: row.partner_id, referral_source_id: row.referral_source_id })),
    partnerActivities: db.partnerActivities.map((row) => ({
      id: row.id,
      referral_source_id: row.referral_source_id ? (referralByExternalId.get(row.referral_source_id) ?? null) : null,
      partner_id: row.partner_id ? (partnerByExternalId.get(row.partner_id) ?? null) : null,
      organization_name: row.organization_name,
      contact_name: row.contact_name,
      activity_at: row.activity_at,
      activity_type: row.activity_type,
      notes: row.notes,
      completed_by: row.completed_by,
      completed_by_user_id: mapStaff(row.completed_by_user_id),
      next_follow_up_date: row.next_follow_up_date,
      next_follow_up_type: row.next_follow_up_type,
      last_touched: row.last_touched,
      lead_id: row.lead_id
    })),
    stageHistory: db.leadStageHistory.map((row) => ({ id: row.id, lead_id: row.lead_id, from_stage: row.from_stage, to_stage: row.to_stage, from_status: String(row.from_status ?? "").toLowerCase() || null, to_status: String(row.to_status).toLowerCase(), changed_by_user_id: mapStaff(row.changed_by_user_id), changed_by_name: row.changed_by_name, reason: row.reason, source: row.source, changed_at: row.changed_at, created_at: row.changed_at })),
    intakeAssessments: db.assessments.map((row) => ({ id: row.id, member_id: row.member_id, lead_id: row.lead_id, assessment_date: row.assessment_date, status: row.complete ? "completed" : "draft", completed_by_user_id: mapStaff(row.created_by_user_id), completed_by: row.completed_by, signed_by: row.signed_by, complete: row.complete, total_score: row.total_score, recommended_track: row.recommended_track, admission_review_required: row.admission_review_required, notes: row.notes, created_at: row.created_at, updated_at: row.created_at })),
    assessmentResponses: db.assessmentResponses.map((row) => ({ id: row.id, assessment_id: row.assessment_id, member_id: row.member_id, field_key: row.field_key, field_label: row.field_label, section_type: row.section_type, field_value: row.field_value, field_value_type: row.field_value_type, created_at: row.created_at })),
    physicianOrders: intake.pofRows,
    memberHealthProfiles: intake.mhpRows,
    memberHolds: db.memberHolds.map((row) => ({ ...row, created_by_user_id: mapStaff(row.created_by_user_id), ended_by_user_id: mapStaff(row.ended_by_user_id) })),
    attendanceRecords: db.attendanceRecords.map((row) => ({
      id: ensureUuid(row.id, `attendance-record:${row.id}`),
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      attendance_date: row.attendance_date,
      status: row.status,
      absent_reason: row.absent_reason,
      absent_reason_other: row.absent_reason_other,
      check_in_at: row.check_in_at,
      check_out_at: row.check_out_at,
      notes: row.notes,
      recorded_by_user_id: mapStaff(row.recorded_by_user_id),
      recorded_by_name: row.recorded_by_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      scheduled_day: row.scheduled_day ?? null,
      unscheduled_day: row.unscheduled_day ?? null,
      billable_extra_day: row.billable_extra_day ?? null,
      billing_status: row.billing_status ?? null,
      linked_adjustment_id: row.linked_adjustment_id ?? null
    })),
    memberCommandCenters: db.memberCommandCenters.map((row) => ({
      ...row,
      source_assessment_id: null,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    memberAttendanceSchedules: db.memberAttendanceSchedules.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    memberContacts: db.memberContacts.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberFiles: db.memberFiles.map((row) => ({
      ...row,
      uploaded_by_user_id: mapStaff(row.uploaded_by_user_id)
    })),
    busStopDirectory: db.busStopDirectory.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    transportationManifestAdjustments: db.transportationManifestAdjustments.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    scheduleChanges,
    memberAllergies: db.memberAllergies.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    payors: db.payors.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    memberBillingSettings: db.memberBillingSettings.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    billingScheduleTemplates: db.billingScheduleTemplates.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    centerBillingSettings: db.centerBillingSettings.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    closureRules: db.closureRules.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    centerClosures: db.centerClosures.map((row) => ({
      ...row,
      closure_rule_id: row.closure_rule_id ? ensureUuid(row.closure_rule_id, `closure-rule:${row.closure_rule_id}`) : null,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    billingBatches: billing.billingBatches,
    billingInvoices: billing.billingInvoices,
    billingInvoiceLines: billing.billingInvoiceLines,
    billingAdjustments: billing.billingAdjustments,
    billingCoverages: billing.billingCoverages,
    billingExportJobs: billing.billingExportJobs,
    carePlans: carePlans.carePlans,
    carePlanSections: carePlans.carePlanSections,
    carePlanVersions: carePlans.carePlanVersions,
    carePlanReviewHistory: carePlans.carePlanReviewHistory,
    memberDiagnoses: db.memberDiagnoses.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberMedications: db.memberMedications.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberProviders: db.memberProviders.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    providerDirectory: db.providerDirectory.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    hospitalPreferenceDirectory: db.hospitalPreferenceDirectory.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberEquipment: db.memberEquipment.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberNotes: db.memberNotes.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    }))
  };
}

async function resetForModules(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  modules: SeedModule[],
  existingTables: Map<string, boolean>
) {
  const tables = new Set<string>();
  if (modules.includes("sales")) ["lead_stage_history", "lead_activities", "partner_activities", "leads", "referral_sources", "community_partner_organizations"].forEach((t) => tables.add(t));
  if (modules.includes("intake"))
    [
      "care_plan_review_history",
      "care_plan_versions",
      "care_plan_sections",
      "care_plans",
      "member_notes",
      "member_equipment",
      "hospital_preference_directory",
      "provider_directory",
      "member_providers",
      "member_medications",
      "member_diagnoses",
      "member_health_profiles",
      "physician_orders",
      "assessment_responses",
      "intake_assessments",
      "mar_entries"
    ].forEach((t) => tables.add(t));
  if (modules.includes("attendance"))
    [
      "attendance_records",
      "center_closures",
      "closure_rules",
      "transportation_manifest_adjustments",
      "member_files",
      "member_contacts",
      "member_allergies",
      "member_attendance_schedules",
      "member_command_centers",
      "member_billing_settings",
      "billing_schedule_templates",
      "payors",
      "center_billing_settings",
      "member_holds",
      "schedule_changes",
      "ancillary_charge_logs",
      "ancillary_charge_categories",
      "billing_coverages",
      "billing_invoice_lines",
      "billing_adjustments",
      "billing_invoices",
      "billing_export_jobs",
      "billing_batches",
      "documentation_events",
      "documentation_assignments",
      "documentation_tracker",
      "member_photo_uploads",
      "blood_sugar_logs",
      "transportation_logs",
      "shower_logs",
      "toilet_logs",
      "daily_activity_logs",
      "time_punch_exceptions",
      "daily_timecards",
      "forgotten_punch_requests",
      "pto_entries",
      "punches",
      "time_punches",
      "pay_periods",
      "bus_stop_directory",
      "members",
      "sites"
    ].forEach((t) => tables.add(t));
  const order = [
    "lead_stage_history",
    "lead_activities",
    "partner_activities",
    "billing_coverages",
    "billing_invoice_lines",
    "billing_adjustments",
    "billing_invoices",
    "billing_export_jobs",
    "billing_batches",
    "care_plan_review_history",
    "care_plan_versions",
    "care_plan_sections",
    "care_plans",
    "center_closures",
    "closure_rules",
    "schedule_changes",
    "transportation_manifest_adjustments",
    "member_files",
    "member_contacts",
    "member_allergies",
    "member_attendance_schedules",
    "member_command_centers",
    "member_billing_settings",
    "billing_schedule_templates",
    "attendance_records",
    "member_holds",
    "member_notes",
    "member_equipment",
    "member_providers",
    "member_medications",
    "member_diagnoses",
    "hospital_preference_directory",
    "provider_directory",
    "member_health_profiles",
    "physician_orders",
    "assessment_responses",
    "intake_assessments",
    "documentation_events",
    "documentation_assignments",
    "documentation_tracker",
    "mar_entries",
    "ancillary_charge_logs",
    "ancillary_charge_categories",
    "member_photo_uploads",
    "blood_sugar_logs",
    "transportation_logs",
    "shower_logs",
    "toilet_logs",
    "daily_activity_logs",
    "time_punch_exceptions",
    "daily_timecards",
    "forgotten_punch_requests",
    "pto_entries",
    "punches",
    "time_punches",
    "pay_periods",
    "leads",
    "referral_sources",
    "community_partner_organizations",
    "payors",
    "center_billing_settings",
    "bus_stop_directory",
    "members",
    "sites"
  ];
  for (const table of order.filter((t) => tables.has(t))) await deleteRows(supabase, table, existingTables);
}

async function main() {
  loadEnvFiles();
  const parsed = parseArgs(process.argv.slice(2));
  assertSafeEnvironment(parsed.reset);
  const db = buildSeededMockDb();
  const supabase = createSupabaseAdminClient();
  const staffMap = await ensureAuthProfiles(supabase, db);
  const rows = buildRows(db, staffMap);

  const workload: Array<{ table: string; rows: Record<string, unknown>[]; module: SeedModule | "core"; legacy?: boolean }> = [
    { table: "sites", rows: rows.sites, module: "core" },
    { table: "members", rows: rows.members, module: "core" },
    { table: "pay_periods", rows: rows.payPeriods, module: "attendance" },
    { table: "time_punches", rows: rows.timePunches, module: "attendance" },
    { table: "time_punch_exceptions", rows: rows.timePunchExceptions, module: "attendance", legacy: true },
    { table: "punches", rows: rows.punches, module: "attendance" },
    { table: "daily_timecards", rows: rows.dailyTimecards, module: "attendance", legacy: true },
    { table: "forgotten_punch_requests", rows: rows.forgottenPunchRequests, module: "attendance", legacy: true },
    { table: "pto_entries", rows: rows.ptoEntries, module: "attendance", legacy: true },
    { table: "daily_activity_logs", rows: rows.dailyActivities, module: "attendance" },
    { table: "toilet_logs", rows: rows.toiletLogs, module: "attendance" },
    { table: "shower_logs", rows: rows.showerLogs, module: "attendance" },
    { table: "transportation_logs", rows: rows.transportLogs, module: "attendance" },
    { table: "blood_sugar_logs", rows: rows.bloodSugar, module: "attendance" },
    { table: "mar_entries", rows: rows.marEntries, module: "intake", legacy: true },
    { table: "member_photo_uploads", rows: rows.photos, module: "attendance" },
    { table: "ancillary_charge_categories", rows: rows.ancillaryCategories, module: "attendance" },
    { table: "ancillary_charge_logs", rows: rows.ancillaryLogs, module: "attendance" },
    { table: "documentation_events", rows: rows.documentationEvents, module: "attendance", legacy: true },
    { table: "documentation_tracker", rows: rows.documentationTracker, module: "attendance", legacy: true },
    { table: "documentation_assignments", rows: rows.documentationAssignments, module: "attendance", legacy: true },
    { table: "attendance_records", rows: rows.attendanceRecords, module: "attendance", legacy: true },
    { table: "payors", rows: rows.payors, module: "attendance", legacy: true },
    { table: "center_billing_settings", rows: rows.centerBillingSettings, module: "attendance", legacy: true },
    { table: "closure_rules", rows: rows.closureRules, module: "attendance", legacy: true },
    { table: "center_closures", rows: rows.centerClosures, module: "attendance", legacy: true },
    { table: "member_holds", rows: rows.memberHolds, module: "attendance" },
    { table: "schedule_changes", rows: rows.scheduleChanges, module: "attendance" },
    { table: "member_command_centers", rows: rows.memberCommandCenters, module: "attendance", legacy: true },
    { table: "member_attendance_schedules", rows: rows.memberAttendanceSchedules, module: "attendance", legacy: true },
    { table: "member_contacts", rows: rows.memberContacts, module: "attendance", legacy: true },
    { table: "member_files", rows: rows.memberFiles, module: "attendance", legacy: true },
    { table: "bus_stop_directory", rows: rows.busStopDirectory, module: "attendance", legacy: true },
    { table: "transportation_manifest_adjustments", rows: rows.transportationManifestAdjustments, module: "attendance", legacy: true },
    { table: "member_allergies", rows: rows.memberAllergies, module: "attendance", legacy: true },
    { table: "member_billing_settings", rows: rows.memberBillingSettings, module: "attendance", legacy: true },
    { table: "billing_schedule_templates", rows: rows.billingScheduleTemplates, module: "attendance", legacy: true },
    { table: "billing_batches", rows: rows.billingBatches, module: "attendance" },
    { table: "billing_invoices", rows: rows.billingInvoices, module: "attendance" },
    { table: "billing_invoice_lines", rows: rows.billingInvoiceLines, module: "attendance" },
    { table: "billing_adjustments", rows: rows.billingAdjustments, module: "attendance" },
    { table: "billing_coverages", rows: rows.billingCoverages, module: "attendance" },
    { table: "billing_export_jobs", rows: rows.billingExportJobs, module: "attendance" },
    { table: "community_partner_organizations", rows: rows.partners, module: "sales" },
    { table: "referral_sources", rows: rows.referrals, module: "sales" },
    { table: "leads", rows: rows.leads, module: "sales" },
    { table: "lead_activities", rows: rows.leadActivities, module: "sales" },
    { table: "partner_activities", rows: rows.partnerActivities, module: "sales" },
    { table: "lead_stage_history", rows: rows.stageHistory, module: "sales" },
    { table: "intake_assessments", rows: rows.intakeAssessments, module: "intake" },
    { table: "assessment_responses", rows: rows.assessmentResponses, module: "intake" },
    { table: "physician_orders", rows: rows.physicianOrders, module: "intake" },
    { table: "member_health_profiles", rows: rows.memberHealthProfiles, module: "intake" },
    { table: "care_plans", rows: rows.carePlans, module: "intake" },
    { table: "care_plan_sections", rows: rows.carePlanSections, module: "intake" },
    { table: "care_plan_versions", rows: rows.carePlanVersions, module: "intake" },
    { table: "care_plan_review_history", rows: rows.carePlanReviewHistory, module: "intake" },
    { table: "member_diagnoses", rows: rows.memberDiagnoses, module: "intake", legacy: true },
    { table: "member_medications", rows: rows.memberMedications, module: "intake", legacy: true },
    { table: "member_providers", rows: rows.memberProviders, module: "intake", legacy: true },
    { table: "provider_directory", rows: rows.providerDirectory, module: "intake", legacy: true },
    { table: "hospital_preference_directory", rows: rows.hospitalPreferenceDirectory, module: "intake", legacy: true },
    { table: "member_equipment", rows: rows.memberEquipment, module: "intake", legacy: true },
    { table: "member_notes", rows: rows.memberNotes, module: "intake", legacy: true }
  ];
  const existingTables = await discoverExistingTables(
    supabase,
    workload.map((entry) => entry.table)
  );
  if (parsed.reset) await resetForModules(supabase, parsed.modules, existingTables);

  const selected = workload.filter((entry) => {
    const inModuleScope = entry.module === "core" || parsed.modules.includes(entry.module);
    if (!inModuleScope) return false;
    if (!parsed.legacyOnly) return true;
    return entry.module === "core" || entry.legacy === true || LEGACY_DEPENDENCY_TABLES.has(entry.table);
  });
  const tableCounts = new Map<string, number>();
  const moduleCounts = new Map<string, number>();
  for (const item of selected) {
    let inserted = 0;
    try {
      inserted = await upsertRows(supabase, item.table, item.rows, existingTables);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const triggerConflictMessage = "no unique or exclusion constraint matching the ON CONFLICT specification";
      if (item.table === "time_punches" && message.includes(triggerConflictMessage)) {
        throw new Error(
          "Seeding time_punches failed because payroll canonical sync prerequisites are missing. Apply migrations 0009_payroll_canonical_sync.sql and 0017_reseed_schema_alignment.sql, then rerun seed."
        );
      }
      if (message.includes('record "new" has no field "created_at"')) {
        throw new Error(
          `Seeding ${item.table} failed because the documentation trigger expects created_at. Apply migration 0017_reseed_schema_alignment.sql and rerun seed.`
        );
      }
      throw error;
    }
    tableCounts.set(item.table, inserted);
    const moduleKey = item.module;
    moduleCounts.set(moduleKey, (moduleCounts.get(moduleKey) ?? 0) + inserted);
  }

  console.log("Supabase seed complete.");
  console.log(`Modules: ${parsed.modules.join(", ")}`);
  console.log(`Legacy only: ${parsed.legacyOnly ? "yes" : "no"}`);
  console.log(`Reset: ${parsed.reset ? "yes" : "no"}`);
  selected.forEach((item) => console.log(`${item.table}: ${tableCounts.get(item.table) ?? 0}`));
  for (const [module, count] of moduleCounts.entries()) {
    console.log(`module:${module}: ${count}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
