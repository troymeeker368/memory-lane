import { getMockDb } from "@/lib/mock-repo";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { readMockStateJson, writeMockStateJson } from "@/lib/mock-persistence";

export type CarePlanTrack = "Track 1" | "Track 2" | "Track 3";

export const CARE_PLAN_SECTION_TYPES = [
  "Activities of Daily Living (ADLs) Assistance",
  "Cognitive & Memory Support",
  "Socialization & Emotional Well-Being",
  "Safety & Fall Prevention",
  "Medical & Medication Management"
] as const;

export type CarePlanSectionType = (typeof CARE_PLAN_SECTION_TYPES)[number];
export const CARE_PLAN_SHORT_TERM_LABEL = "Short-Term Goals (within 60 days)";
export const CARE_PLAN_LONG_TERM_LABEL = "Long-Term Goals (within 6 months)";

export type CarePlanStatus = "Due Soon" | "Due Now" | "Overdue" | "Completed";

export interface CarePlan {
  id: string;
  memberId: string;
  memberName: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string | null;
  nextDueDate: string;
  status: CarePlanStatus;
  completedBy: string | null;
  dateOfCompletion: string | null;
  responsiblePartySignature: string | null;
  responsiblePartySignatureDate: string | null;
  administratorSignature: string | null;
  administratorSignatureDate: string | null;
  careTeamNotes: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  createdAt: string;
  updatedAt: string;
}

export interface CarePlanSection {
  id: string;
  carePlanId: string;
  sectionType: CarePlanSectionType;
  shortTermGoals: string;
  longTermGoals: string;
  displayOrder: number;
}

export interface CarePlanTemplate {
  id: string;
  track: CarePlanTrack;
  sectionType: CarePlanSectionType;
  defaultShortTermGoals: string;
  defaultLongTermGoals: string;
}

export interface CarePlanReviewHistory {
  id: string;
  carePlanId: string;
  reviewDate: string;
  reviewedBy: string;
  summary: string;
  changesMade: boolean;
  nextDueDate: string;
  versionId?: string | null;
}

export interface CarePlanVersion {
  id: string;
  carePlanId: string;
  versionNumber: number;
  snapshotType: "initial" | "review";
  snapshotDate: string;
  reviewedBy: string | null;
  status: CarePlanStatus;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
  createdAt: string;
}

export interface CarePlanListRow {
  id: string;
  memberId: string;
  memberName: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string | null;
  nextDueDate: string;
  status: CarePlanStatus;
  completedBy: string | null;
  hasExistingPlan: boolean;
  actionHref: string;
  openHref: string;
}

export interface MemberCarePlanSummary {
  hasExistingPlan: boolean;
  nextDueDate: string | null;
  status: CarePlanStatus | null;
  actionHref: string;
  actionLabel: "New Care Plan" | "Review Care Plan";
  planId: string | null;
}

export interface CarePlanParticipationSummary {
  attendanceDays: number;
  participationDays: number;
  participationRate: number | null;
  windowStartDate: string;
  windowEndDate: string;
}

interface CarePlanStore {
  carePlans: CarePlan[];
  sections: CarePlanSection[];
  templates: CarePlanTemplate[];
  history: CarePlanReviewHistory[];
  versions: CarePlanVersion[];
}

interface PersistedCarePlanState {
  version: 1;
  counter: number;
  seeded: boolean;
  carePlans: CarePlan[];
  sections: CarePlanSection[];
  history: CarePlanReviewHistory[];
  versions: CarePlanVersion[];
}

const CARE_PLAN_STATE_FILE = "care-plans.json";

function readPersistedCarePlanState() {
  const candidate = readMockStateJson<PersistedCarePlanState | null>(CARE_PLAN_STATE_FILE, null);
  if (!candidate || candidate.version !== 1) return null;
  return candidate;
}

const initialPersistedCarePlanState = readPersistedCarePlanState();

let counter =
  initialPersistedCarePlanState && Number.isFinite(initialPersistedCarePlanState.counter)
    ? initialPersistedCarePlanState.counter
    : 5000;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}`;
}

const GOAL_PREFIX_PATTERN = /^\s*(?:\d+[\.\)]|[-*])\s+/;

function splitGoalLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(GOAL_PREFIX_PATTERN, "").trim())
    .filter(Boolean);
}

export function normalizeGoalList(input: string) {
  const lines = splitGoalLines(input);
  return lines.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
}

export function getGoalListItems(input: string) {
  return splitGoalLines(input);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(date: string) {
  const todayEastern = toEasternDate();
  const target = new Date(`${date}T00:00:00.000Z`);
  const today = new Date(`${todayEastern}T00:00:00.000Z`);
  const diff = target.getTime() - today.getTime();
  return Math.floor(diff / 86400000);
}

export function computeCarePlanStatus(nextDueDate: string): CarePlanStatus {
  const delta = daysUntil(nextDueDate);
  if (delta < 0) return "Overdue";
  if (delta === 0) return "Due Now";
  if (delta <= 14) return "Due Soon";
  return "Completed";
}

export function computeInitialDueDate(enrollmentDate: string) {
  return addDays(enrollmentDate, 30);
}

export function computeNextReviewDueDate(lastReviewDate: string) {
  return addDays(lastReviewDate, 180);
}

function daysSince(date: string) {
  return -daysUntil(date);
}

function resolveTrack(value: string | null | undefined): CarePlanTrack {
  if (value === "Track 1" || value === "Track 2" || value === "Track 3") return value;
  return "Track 1";
}

function computePendingInitialCarePlanStatus(enrollmentDate: string): CarePlanStatus {
  const elapsed = daysSince(enrollmentDate);
  if (elapsed <= 30) return "Due Soon";
  return "Overdue";
}

function normalizeDateOnly(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCarePlanParticipationSummary(memberId: string): CarePlanParticipationSummary {
  const db = getMockDb();
  const windowEndDate = toEasternDate();
  const windowStartDate = addDays(windowEndDate, -180);

  const attendanceDays = db.attendanceRecords.filter((record) => {
    const recordDate = normalizeDateOnly(record.attendance_date);
    return record.member_id === memberId && !!recordDate && recordDate >= windowStartDate && recordDate <= windowEndDate;
  }).length;

  const participationDates = new Set(
    db.dailyActivities
      .filter((row) => row.member_id === memberId)
      .map((row) => normalizeDateOnly(row.activity_date))
      .filter((value): value is string => Boolean(value))
      .filter((value) => value >= windowStartDate && value <= windowEndDate)
  );

  const participationDays = participationDates.size;
  const participationRate =
    attendanceDays === 0 ? null : Math.round((participationDays / attendanceDays) * 100);

  return {
    attendanceDays,
    participationDays,
    participationRate,
    windowStartDate,
    windowEndDate
  };
}

// Canonical template wording is sourced from C:/Users/meeke/OneDrive - Town Square/care plans.docx.
// TODO: Load track templates from backend-managed care-plan master data when backend is wired.
const templates: CarePlanTemplate[] = [
  {
    id: "tpl-t1-adl",
    track: "Track 1",
    sectionType: "Activities of Daily Living (ADLs) Assistance",
    defaultShortTermGoals:
      "Member will complete daily self-care tasks (dressing, grooming, toileting) independently with only minimal reminders.\nMember will participate in light physical activity on most program days to support mobility.",
    defaultLongTermGoals:
      "Member will maintain independence in ADLs with occasional prompts as needed.\nMember will follow a consistent daily routine that supports comfort and participation."
  },
  {
    id: "tpl-t1-cog",
    track: "Track 1",
    sectionType: "Cognitive & Memory Support",
    defaultShortTermGoals:
      "Member will participate in structured memory activities (puzzles, word games) at least once weekly.\nMember will use memory aids (calendar, whiteboard, labeled objects) for orientation on program days.",
    defaultLongTermGoals:
      "Member will continue to participate actively in memory and orientation activities.\nMember will engage in reminiscence activities (storytelling, group discussions) at least monthly to support identity and confidence."
  },
  {
    id: "tpl-t1-social",
    track: "Track 1",
    sectionType: "Socialization & Emotional Well-Being",
    defaultShortTermGoals:
      "Member will attend at least one group activity per week to strengthen social connections.\nMember will engage in a preferred hobby or creative activity at least twice per month.",
    defaultLongTermGoals:
      "Member will maintain friendships within the center community and participate in discussions regularly.\nMember will demonstrate consistent positive social engagement to prevent isolation."
  },
  {
    id: "tpl-t1-safety",
    track: "Track 1",
    sectionType: "Safety & Fall Prevention",
    defaultShortTermGoals:
      "Member will use safe mobility practices (assistive devices if applicable) during program attendance.\nStaff will maintain an environment free of tripping hazards.",
    defaultLongTermGoals:
      "Member will maintain steady mobility and independence in movement.\nMember will continue strength and stability activities regularly to reduce fall risk."
  },
  {
    id: "tpl-t1-med",
    track: "Track 1",
    sectionType: "Medical & Medication Management",
    defaultShortTermGoals:
      "Member will demonstrate awareness of medication schedule with minimal reminders.\nMember will attend routine health check-ups as scheduled.",
    defaultLongTermGoals:
      "Member will maintain stable health through consistent medication use and wellness monitoring.\nMember will demonstrate continued independence in medication management where appropriate."
  },
  {
    id: "tpl-t2-adl",
    track: "Track 2",
    sectionType: "Activities of Daily Living (ADLs) Assistance",
    defaultShortTermGoals:
      "Member will complete self-care tasks (dressing, grooming, toileting) with verbal or visual prompts as needed.\nMember will participate in structured light physical activity on program days to support mobility.",
    defaultLongTermGoals:
      "Member will maintain independence in personal care tasks with structured assistance.\nMember will demonstrate reduced frustration and greater comfort with ADLs through familiar routines."
  },
  {
    id: "tpl-t2-cog",
    track: "Track 2",
    sectionType: "Cognitive & Memory Support",
    defaultShortTermGoals:
      "Member will engage in simplified memory or cognitive activities at least once weekly with staff support.\nMember will use orientation supports (visual aids, daily reminders) during program attendance.",
    defaultLongTermGoals:
      "Member will maintain participation in familiar activities that promote memory and confidence.\nMember will respond positively to structured prompts that encourage recall and orientation."
  },
  {
    id: "tpl-t2-social",
    track: "Track 2",
    sectionType: "Socialization & Emotional Well-Being",
    defaultShortTermGoals:
      "Member will participate in small group activities with staff guidance at least weekly.\nMember will engage in a familiar hobby or simple creative project at least monthly.",
    defaultLongTermGoals:
      "Member will maintain regular socialization through structured, staff-supported interactions.\nMember will demonstrate increased comfort and reduced isolation through ongoing engagement."
  },
  {
    id: "tpl-t2-safety",
    track: "Track 2",
    sectionType: "Safety & Fall Prevention",
    defaultShortTermGoals:
      "Member will use safe mobility practices with staff supervision during transitions.\nMember will participate in scheduled walking or movement activities to support stability.",
    defaultLongTermGoals:
      "Member will maintain mobility and safe movement patterns with ongoing staff support.\nMember will reduce fall risk by participating in balance and stability activities regularly."
  },
  {
    id: "tpl-t2-med",
    track: "Track 2",
    sectionType: "Medical & Medication Management",
    defaultShortTermGoals:
      "Member will adhere to medication schedule with nurse-directed assistance.\nMember will be monitored for changes in health status, and concerns will be communicated promptly.",
    defaultLongTermGoals:
      "Member will maintain stable health through consistent medication and wellness tracking.\nMember will continue to access appropriate healthcare services and provider follow-up as needed."
  },
  {
    id: "tpl-t3-adl",
    track: "Track 3",
    sectionType: "Activities of Daily Living (ADLs) Assistance",
    defaultShortTermGoals:
      "Member will participate in daily self-care routines with frequent verbal prompts and partial assistance as needed.\nMember will demonstrate reduced frustration during grooming, dressing, and toileting when steps are simplified.",
    defaultLongTermGoals:
      "Member will continue to engage in basic self-care tasks with structured support.\nMember will maintain comfort and dignity through a predictable ADL routine."
  },
  {
    id: "tpl-t3-cog",
    track: "Track 3",
    sectionType: "Cognitive & Memory Support",
    defaultShortTermGoals:
      "Member will engage in simplified cognitive or sensory activities (music, photos, familiar objects) at least weekly.\nMember will respond to orientation cues (gentle reminders, familiar prompts) during program days.",
    defaultLongTermGoals:
      "Member will maintain participation in familiar or sensory-based activities that support confidence and emotional well-being.\nMember will demonstrate reduced distress through structured, supportive approaches to recall and engagement."
  },
  {
    id: "tpl-t3-social",
    track: "Track 3",
    sectionType: "Socialization & Emotional Well-Being",
    defaultShortTermGoals:
      "Member will participate in one-on-one or small group activities with staff support at least weekly.\nMember will demonstrate comfort in social settings through positive engagement (smiling, responding, or joining in).",
    defaultLongTermGoals:
      "Member will sustain meaningful social interaction with peers or staff through guided participation.\nMember will demonstrate improved emotional comfort through ongoing social engagement."
  },
  {
    id: "tpl-t3-safety",
    track: "Track 3",
    sectionType: "Safety & Fall Prevention",
    defaultShortTermGoals:
      "Member will complete mobility transitions (e.g., sitting to standing) safely with staff supervision.\nMember will participate in scheduled movement or walking breaks to support stability.",
    defaultLongTermGoals:
      "Member will maintain safe mobility patterns with continued supervision and environmental support.\nMember will reduce fall risk through consistent staff assistance and structured movement activities."
  },
  {
    id: "tpl-t3-med",
    track: "Track 3",
    sectionType: "Medical & Medication Management",
    defaultShortTermGoals:
      "Member will receive medication with direct staff assistance to ensure accuracy.\nMember will be monitored for changes in comfort, pain, or health status during program attendance.",
    defaultLongTermGoals:
      "Member will maintain stable health with ongoing supervision of medications and wellness needs.\nMember will prevent unnecessary complications through proactive communication with caregivers and providers."
  }
];

const store: CarePlanStore = {
  carePlans:
    initialPersistedCarePlanState && Array.isArray(initialPersistedCarePlanState.carePlans)
      ? initialPersistedCarePlanState.carePlans
      : [],
  sections:
    initialPersistedCarePlanState && Array.isArray(initialPersistedCarePlanState.sections)
      ? initialPersistedCarePlanState.sections
      : [],
  templates,
  history:
    initialPersistedCarePlanState && Array.isArray(initialPersistedCarePlanState.history)
      ? initialPersistedCarePlanState.history
      : [],
  versions:
    initialPersistedCarePlanState && Array.isArray(initialPersistedCarePlanState.versions)
      ? initialPersistedCarePlanState.versions
      : []
};

let seeded = initialPersistedCarePlanState ? Boolean(initialPersistedCarePlanState.seeded) : false;

function hydrateCarePlanStateFromDisk() {
  const persisted = readPersistedCarePlanState();
  if (!persisted) return;

  counter = Number.isFinite(persisted.counter) ? persisted.counter : counter;
  seeded = Boolean(persisted.seeded);
  store.carePlans = Array.isArray(persisted.carePlans) ? persisted.carePlans : [];
  store.sections = Array.isArray(persisted.sections) ? persisted.sections : [];
  store.history = Array.isArray(persisted.history) ? persisted.history : [];
  store.versions = Array.isArray(persisted.versions) ? persisted.versions : [];
}

function persistCarePlanState() {
  writeMockStateJson<PersistedCarePlanState>(CARE_PLAN_STATE_FILE, {
    version: 1,
    counter,
    seeded,
    carePlans: store.carePlans,
    sections: store.sections,
    history: store.history,
    versions: store.versions
  });
}

function buildDefaultSections(carePlanId: string, track: CarePlanTrack): CarePlanSection[] {
  return templates
    .filter((t) => t.track === track)
    .map((template, idx) => ({
      id: nextId("care-plan-section"),
      carePlanId,
      sectionType: template.sectionType,
      shortTermGoals: normalizeGoalList(template.defaultShortTermGoals),
      longTermGoals: normalizeGoalList(template.defaultLongTermGoals),
      displayOrder: idx + 1
    }));
}

function getSectionsForPlan(carePlanId: string) {
  return store.sections
    .filter((section) => section.carePlanId === carePlanId)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((section) => ({
      sectionType: section.sectionType,
      shortTermGoals: normalizeGoalList(section.shortTermGoals),
      longTermGoals: normalizeGoalList(section.longTermGoals),
      displayOrder: section.displayOrder
    }));
}

function nextVersionNumber(carePlanId: string) {
  const max = store.versions
    .filter((version) => version.carePlanId === carePlanId)
    .reduce((current, version) => Math.max(current, version.versionNumber), 0);
  return max + 1;
}

function createCarePlanVersion(input: {
  carePlanId: string;
  snapshotType: "initial" | "review";
  snapshotDate: string;
  reviewedBy: string | null;
  status: CarePlanStatus;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
}) {
  const version: CarePlanVersion = {
    id: nextId("care-plan-version"),
    carePlanId: input.carePlanId,
    versionNumber: nextVersionNumber(input.carePlanId),
    snapshotType: input.snapshotType,
    snapshotDate: input.snapshotDate,
    reviewedBy: input.reviewedBy,
    status: input.status,
    nextDueDate: input.nextDueDate,
    noChangesNeeded: input.noChangesNeeded,
    modificationsRequired: input.modificationsRequired,
    modificationsDescription: input.modificationsDescription,
    careTeamNotes: input.careTeamNotes,
    sections: getSectionsForPlan(input.carePlanId),
    createdAt: toEasternISO()
  };

  store.versions.unshift(version);
  return version;
}

function backfillCarePlanVersionsForLegacyState() {
  let changed = false;

  const plansMissingVersions = store.carePlans.filter((plan) => !store.versions.some((version) => version.carePlanId === plan.id));
  plansMissingVersions.forEach((plan) => {
    createCarePlanVersion({
      carePlanId: plan.id,
      snapshotType: plan.lastCompletedDate ? "review" : "initial",
      snapshotDate: plan.lastCompletedDate || plan.reviewDate,
      reviewedBy: plan.completedBy ?? null,
      status: computeCarePlanStatus(plan.nextDueDate),
      nextDueDate: plan.nextDueDate,
      noChangesNeeded: plan.noChangesNeeded,
      modificationsRequired: plan.modificationsRequired,
      modificationsDescription: plan.modificationsDescription,
      careTeamNotes: plan.careTeamNotes
    });
    changed = true;
  });

  store.history.forEach((entry) => {
    if (entry.versionId) return;
    const candidates = store.versions
      .filter((version) => version.carePlanId === entry.carePlanId)
      .sort((a, b) => {
        if (a.snapshotDate !== b.snapshotDate) return a.snapshotDate < b.snapshotDate ? 1 : -1;
        return b.versionNumber - a.versionNumber;
      });
    const exact = candidates.find((version) => version.snapshotDate === entry.reviewDate);
    if (exact) {
      entry.versionId = exact.id;
      changed = true;
      return;
    }
    const latest = candidates[0];
    if (latest) {
      entry.versionId = latest.id;
      changed = true;
    }
  });

  if (changed) {
    persistCarePlanState();
  }
}

function seedCarePlans() {
  // Refresh from disk every call so dev multi-worker/HMR sessions share persisted care-plan updates.
  hydrateCarePlanStateFromDisk();

  if (seeded) {
    backfillCarePlanVersionsForLegacyState();
    return;
  }
  seeded = true;

  const db = getMockDb();
  const nurse = db.staff.find((s) => s.role === "nurse") ?? db.staff[0];

  const seedMembers = db.members.filter((member) => member.status === "active");

  seedMembers.forEach((member, idx) => {
    const tracks: CarePlanTrack[] = ["Track 1", "Track 2", "Track 3"];
    const track: CarePlanTrack = tracks[idx % tracks.length];
    const enrollmentDate = member.enrollment_date ?? addDays(toEasternDate(), -(40 + idx * 10));
    const lastCompleted = idx % 4 === 0 ? null : addDays(enrollmentDate, 30 + idx * 3);
    const nextDue = lastCompleted ? computeNextReviewDueDate(lastCompleted) : computeInitialDueDate(enrollmentDate);
    const nowIso = toEasternISO();

    const carePlan: CarePlan = {
      id: nextId("care-plan"),
      memberId: member.id,
      memberName: member.display_name,
      track,
      enrollmentDate,
      reviewDate: lastCompleted ?? enrollmentDate,
      lastCompletedDate: lastCompleted,
      nextDueDate: nextDue,
      status: computeCarePlanStatus(nextDue),
      completedBy: lastCompleted ? nurse.full_name : null,
      dateOfCompletion: lastCompleted,
      responsiblePartySignature: lastCompleted ? "Family Representative" : null,
      responsiblePartySignatureDate: lastCompleted,
      administratorSignature: lastCompleted ? nurse.full_name : null,
      administratorSignatureDate: lastCompleted,
      careTeamNotes: "Care team reviewed goals and interventions for ongoing day-center support.",
      noChangesNeeded: !!lastCompleted,
      modificationsRequired: false,
      modificationsDescription: "",
      createdAt: nowIso,
      updatedAt: nowIso
    };

    store.carePlans.push(carePlan);
    store.sections.push(...buildDefaultSections(carePlan.id, track));
    const seededVersion = createCarePlanVersion({
      carePlanId: carePlan.id,
      snapshotType: lastCompleted ? "review" : "initial",
      snapshotDate: lastCompleted ?? carePlan.reviewDate,
      reviewedBy: lastCompleted ? nurse.full_name : null,
      status: computeCarePlanStatus(nextDue),
      nextDueDate: nextDue,
      noChangesNeeded: !!lastCompleted,
      modificationsRequired: false,
      modificationsDescription: "",
      careTeamNotes: carePlan.careTeamNotes
    });

    if (lastCompleted) {
      store.history.push({
        id: nextId("care-plan-review"),
        carePlanId: carePlan.id,
        reviewDate: lastCompleted,
        reviewedBy: nurse.full_name,
        summary: "Periodic care plan review completed.",
        changesMade: false,
        nextDueDate: nextDue,
        versionId: seededVersion.id
      });
    }
  });

  persistCarePlanState();
}

export function getCarePlanTemplates(track?: CarePlanTrack) {
  seedCarePlans();
  return store.templates
    .filter((template) => (track ? template.track === track : true))
    .map((template) => ({
      ...template,
      defaultShortTermGoals: normalizeGoalList(template.defaultShortTermGoals),
      defaultLongTermGoals: normalizeGoalList(template.defaultLongTermGoals)
    }));
}

export function getCarePlanTracks(): CarePlanTrack[] {
  return ["Track 1", "Track 2", "Track 3"];
}

function getPendingInitialCarePlanRows(): CarePlanListRow[] {
  seedCarePlans();
  const db = getMockDb();
  const existingMemberIds = new Set(store.carePlans.map((plan) => plan.memberId));

  return db.members
    .filter((member) => member.status === "active" && !!member.enrollment_date && !existingMemberIds.has(member.id))
    .map((member) => {
      const enrollmentDate = member.enrollment_date as string;
      const nextDueDate = computeInitialDueDate(enrollmentDate);
      const status = computePendingInitialCarePlanStatus(enrollmentDate);
      const createHref = `/health/care-plans/new?memberId=${member.id}`;
      return {
        id: `pending-${member.id}`,
        memberId: member.id,
        memberName: member.display_name,
        track: resolveTrack(member.latest_assessment_track),
        enrollmentDate,
        reviewDate: enrollmentDate,
        lastCompletedDate: null,
        nextDueDate,
        status,
        completedBy: null,
        hasExistingPlan: false,
        actionHref: createHref,
        openHref: createHref
      };
    });
}

export function getCarePlans(filters?: { memberId?: string; track?: string; status?: string; query?: string }): CarePlanListRow[] {
  seedCarePlans();
  const existingRows: CarePlanListRow[] = store.carePlans.map((carePlan) => ({
    id: carePlan.id,
    memberId: carePlan.memberId,
    memberName: carePlan.memberName,
    track: carePlan.track,
    enrollmentDate: carePlan.enrollmentDate,
    reviewDate: carePlan.reviewDate,
    lastCompletedDate: carePlan.lastCompletedDate,
    nextDueDate: carePlan.nextDueDate,
    status: computeCarePlanStatus(carePlan.nextDueDate),
    completedBy: carePlan.completedBy,
    hasExistingPlan: true,
    actionHref: `/health/care-plans/${carePlan.id}?view=review`,
    openHref: `/health/care-plans/${carePlan.id}`
  }));

  const pendingRows = getPendingInitialCarePlanRows();

  return [...existingRows, ...pendingRows]
    .filter((carePlan) => (filters?.memberId ? carePlan.memberId === filters.memberId : true))
    .filter((carePlan) => (filters?.track ? carePlan.track === filters.track : true))
    .filter((carePlan) => (filters?.status && filters.status !== "All" ? carePlan.status === filters.status : true))
    .filter((carePlan) => {
      if (!filters?.query) return true;
      const q = filters.query.toLowerCase();
      return carePlan.memberName.toLowerCase().includes(q) || carePlan.track.toLowerCase().includes(q);
    })
    .sort((a, b) => (a.nextDueDate > b.nextDueDate ? 1 : -1));
}

export function getCarePlanById(id: string) {
  seedCarePlans();
  const carePlan = store.carePlans.find((item) => item.id === id);
  if (!carePlan) return null;

  return {
    carePlan: { ...carePlan, status: computeCarePlanStatus(carePlan.nextDueDate) },
    sections: store.sections
      .filter((section) => section.carePlanId === id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((section) => ({
        ...section,
        shortTermGoals: normalizeGoalList(section.shortTermGoals),
        longTermGoals: normalizeGoalList(section.longTermGoals)
      })),
    history: store.history.filter((row) => row.carePlanId === id).sort((a, b) => (a.reviewDate < b.reviewDate ? 1 : -1)),
    versions: store.versions.filter((version) => version.carePlanId === id).sort((a, b) => b.versionNumber - a.versionNumber),
    participationSummary: getCarePlanParticipationSummary(carePlan.memberId)
  };
}

export function getCarePlanDashboard() {
  seedCarePlans();
  const plans = getCarePlans();
  const dueSoon = plans.filter((plan) => plan.status === "Due Soon");
  const dueNow = plans.filter((plan) => plan.status === "Due Now");
  const overdue = plans.filter((plan) => plan.status === "Overdue");

  const recentlyCompleted = [...store.history]
    .sort((a, b) => (a.reviewDate < b.reviewDate ? 1 : -1))
    .slice(0, 10)
    .map((history) => {
      const plan = store.carePlans.find((item) => item.id === history.carePlanId);
      return {
        ...history,
        memberId: plan?.memberId ?? "",
        memberName: plan?.memberName ?? "Unknown Member",
        track: plan?.track ?? "Track 1",
        versionId: history.versionId ?? null
      };
    });

  return {
    summary: {
      total: plans.length,
      dueSoon: dueSoon.length,
      dueNow: dueNow.length,
      overdue: overdue.length,
      completedRecently: recentlyCompleted.length
    },
    dueSoon,
    dueNow,
    overdue,
    recentlyCompleted,
    plans
  };
}

export function getCarePlansForMember(memberId: string) {
  seedCarePlans();
  return store.carePlans
    .filter((plan) => plan.memberId === memberId)
    .map((carePlan) => ({ ...carePlan, status: computeCarePlanStatus(carePlan.nextDueDate) }))
    .sort((a, b) => (a.nextDueDate > b.nextDueDate ? 1 : -1));
}

export function getLatestCarePlanForMember(memberId: string) {
  seedCarePlans();
  const latest = store.carePlans
    .filter((plan) => plan.memberId === memberId)
    .sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.reviewDate < b.reviewDate ? 1 : -1;
    })[0];

  if (!latest) return null;
  return { ...latest, status: computeCarePlanStatus(latest.nextDueDate) };
}

export function getMemberCarePlanSummary(memberId: string): MemberCarePlanSummary {
  const latest = getLatestCarePlanForMember(memberId);
  if (latest) {
    return {
      hasExistingPlan: true,
      nextDueDate: latest.nextDueDate,
      status: latest.status,
      actionHref: `/health/care-plans/${latest.id}?view=review`,
      actionLabel: "Review Care Plan",
      planId: latest.id
    };
  }

  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId);
  if (member?.enrollment_date) {
    return {
      hasExistingPlan: false,
      nextDueDate: computeInitialDueDate(member.enrollment_date),
      status: computePendingInitialCarePlanStatus(member.enrollment_date),
      actionHref: `/health/care-plans/new?memberId=${memberId}`,
      actionLabel: "New Care Plan",
      planId: null
    };
  }

  return {
    hasExistingPlan: false,
    nextDueDate: null,
    status: null,
    actionHref: `/health/care-plans/new?memberId=${memberId}`,
    actionLabel: "New Care Plan",
    planId: null
  };
}

export function getCarePlanVersionById(carePlanId: string, versionId: string) {
  seedCarePlans();
  const version = store.versions.find((item) => item.carePlanId === carePlanId && item.id === versionId);
  if (!version) return null;

  const carePlan = store.carePlans.find((item) => item.id === carePlanId);
  if (!carePlan) return null;

  return {
    carePlan: { ...carePlan, status: computeCarePlanStatus(carePlan.nextDueDate) },
    version
  };
}

export function createCarePlan(input: {
  memberId: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  careTeamNotes: string;
  noChangesNeeded?: boolean;
  modificationsRequired?: boolean;
  modificationsDescription?: string;
  completedBy?: string;
  dateOfCompletion?: string;
  responsiblePartySignature?: string;
  responsiblePartySignatureDate?: string;
  administratorSignature?: string;
  administratorSignatureDate?: string;
  sections: Array<{ sectionType: CarePlanSectionType; shortTermGoals: string; longTermGoals: string; displayOrder: number }>;
}) {
  seedCarePlans();
  const db = getMockDb();
  const member = db.members.find((m) => m.id === input.memberId);
  if (!member) {
    throw new Error("Member not found.");
  }

  const nowIso = toEasternISO();
  const hasCompletion = !!input.dateOfCompletion;
  const nextDue = hasCompletion
    ? computeNextReviewDueDate(input.dateOfCompletion as string)
    : computeInitialDueDate(input.enrollmentDate);
  const resolvedCompletedBy = input.completedBy?.trim() || null;
  const resolvedAdministratorSignature = input.administratorSignature?.trim() || resolvedCompletedBy;
  const resolvedAdministratorSignatureDate = resolvedAdministratorSignature ? input.administratorSignatureDate || input.dateOfCompletion || null : null;

  const plan: CarePlan = {
    id: nextId("care-plan"),
    memberId: input.memberId,
    memberName: member.display_name,
    track: input.track,
    enrollmentDate: input.enrollmentDate,
    reviewDate: input.reviewDate || input.dateOfCompletion || input.enrollmentDate,
    lastCompletedDate: input.dateOfCompletion || null,
    nextDueDate: nextDue,
    status: computeCarePlanStatus(nextDue),
    completedBy: resolvedCompletedBy,
    dateOfCompletion: input.dateOfCompletion || null,
    responsiblePartySignature: input.responsiblePartySignature || null,
    responsiblePartySignatureDate: input.responsiblePartySignatureDate || null,
    administratorSignature: resolvedAdministratorSignature,
    administratorSignatureDate: resolvedAdministratorSignatureDate,
    careTeamNotes: input.careTeamNotes,
    noChangesNeeded: !!input.noChangesNeeded,
    modificationsRequired: !!input.modificationsRequired,
    modificationsDescription: input.modificationsDescription || "",
    createdAt: nowIso,
    updatedAt: nowIso
  };

  store.carePlans.unshift(plan);

  const nextSections = input.sections.map((section) => ({
    id: nextId("care-plan-section"),
    carePlanId: plan.id,
    sectionType: section.sectionType,
    shortTermGoals: normalizeGoalList(section.shortTermGoals),
    longTermGoals: normalizeGoalList(section.longTermGoals),
    displayOrder: section.displayOrder
  }));

  store.sections.push(...nextSections);

  const createdVersion = createCarePlanVersion({
    carePlanId: plan.id,
    snapshotType: hasCompletion ? "review" : "initial",
    snapshotDate: input.dateOfCompletion || input.reviewDate || input.enrollmentDate,
    reviewedBy: resolvedCompletedBy,
    status: plan.status,
    nextDueDate: plan.nextDueDate,
    noChangesNeeded: !!input.noChangesNeeded,
    modificationsRequired: !!input.modificationsRequired,
    modificationsDescription: input.modificationsDescription || "",
    careTeamNotes: input.careTeamNotes
  });

  if (hasCompletion) {
    store.history.unshift({
      id: nextId("care-plan-review"),
      carePlanId: plan.id,
      reviewDate: input.dateOfCompletion as string,
      reviewedBy: resolvedCompletedBy || "Nurse",
      summary: "Initial care plan completion submitted.",
      changesMade: true,
      nextDueDate: nextDue,
      versionId: createdVersion.id
    });
  }

  persistCarePlanState();
  return plan;
}

export function reviewCarePlan(input: {
  carePlanId: string;
  reviewDate: string;
  reviewedBy: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{ id: string; shortTermGoals: string; longTermGoals: string }>;
  responsiblePartySignature?: string;
  responsiblePartySignatureDate?: string;
  administratorSignature?: string;
  administratorSignatureDate?: string;
}) {
  seedCarePlans();
  const plan = store.carePlans.find((row) => row.id === input.carePlanId);
  if (!plan) {
    throw new Error("Care plan not found.");
  }

  input.sections.forEach((sectionPatch) => {
    const section = store.sections.find((row) => row.id === sectionPatch.id && row.carePlanId === input.carePlanId);
    if (!section) return;
    section.shortTermGoals = normalizeGoalList(sectionPatch.shortTermGoals);
    section.longTermGoals = normalizeGoalList(sectionPatch.longTermGoals);
  });

  const nextDueDate = computeNextReviewDueDate(input.reviewDate);
  const resolvedAdministratorSignature = input.administratorSignature?.trim() || input.reviewedBy || plan.administratorSignature;
  const resolvedAdministratorSignatureDate = input.administratorSignatureDate || (resolvedAdministratorSignature ? input.reviewDate : plan.administratorSignatureDate);

  plan.reviewDate = input.reviewDate;
  plan.lastCompletedDate = input.reviewDate;
  plan.nextDueDate = nextDueDate;
  plan.status = computeCarePlanStatus(nextDueDate);
  plan.completedBy = input.reviewedBy;
  plan.dateOfCompletion = input.reviewDate;
  plan.noChangesNeeded = input.noChangesNeeded;
  plan.modificationsRequired = input.modificationsRequired;
  plan.modificationsDescription = input.modificationsDescription;
  plan.careTeamNotes = input.careTeamNotes;
  plan.responsiblePartySignature = input.responsiblePartySignature || plan.responsiblePartySignature;
  plan.responsiblePartySignatureDate = input.responsiblePartySignatureDate || plan.responsiblePartySignatureDate;
  plan.administratorSignature = resolvedAdministratorSignature;
  plan.administratorSignatureDate = resolvedAdministratorSignatureDate;
  plan.updatedAt = toEasternISO();

  const reviewVersion = createCarePlanVersion({
    carePlanId: plan.id,
    snapshotType: "review",
    snapshotDate: input.reviewDate,
    reviewedBy: input.reviewedBy,
    status: plan.status,
    nextDueDate,
    noChangesNeeded: input.noChangesNeeded,
    modificationsRequired: input.modificationsRequired,
    modificationsDescription: input.modificationsDescription,
    careTeamNotes: input.careTeamNotes
  });

  store.history.unshift({
    id: nextId("care-plan-review"),
    carePlanId: plan.id,
    reviewDate: input.reviewDate,
    reviewedBy: input.reviewedBy,
    summary: input.noChangesNeeded ? "No changes needed" : "Modifications required",
    changesMade: input.modificationsRequired,
    nextDueDate,
    versionId: reviewVersion.id
  });

  persistCarePlanState();
  return plan;
}


