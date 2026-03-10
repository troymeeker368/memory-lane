import {
  ATTENDANCE_ABSENCE_REASON_OPTIONS,
  ANCILLARY_CHARGE_CATALOG,
  LEAD_ACTIVITY_OUTCOMES,
  LEAD_ACTIVITY_TYPES,
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  MEMBER_CONTACT_CATEGORY_OPTIONS,
  MEMBER_FILE_CATEGORY_OPTIONS,
  TOILET_USE_TYPE_OPTIONS,
  TRANSPORT_TYPE_OPTIONS,
  canonicalLeadStatus
} from "@/lib/canonical";
import { calculateAssessmentTotal, getAssessmentTrack } from "@/lib/assessment";
import { getStandardDailyRateForAttendanceDays } from "@/lib/services/billing-rate-tiers";
import { getWeekdayForDate } from "@/lib/services/operations-calendar";
import { isScheduledWeekday } from "@/lib/services/member-schedule-selectors";
import fixturesJson from "@/lib/mock/canonical-fixtures.json";
import { createStablePseudonym, createStablePseudonymMap } from "@/lib/mock/pseudonyms";
import { getCurrentPayPeriod } from "@/lib/pay-period";
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";
import type {
  MockAuditLog,
  MockAncillaryCategory,
  MockAncillaryLog,
  MockAttendanceRecord,
  MockAssessment,
  MockAssessmentResponse,
  MockBillingAdjustment,
  MockBillingBatch,
  MockBillingExportJob,
  MockBillingCoverage,
  MockBillingInvoice,
  MockBillingInvoiceLine,
  MockBillingScheduleTemplate,
  MockCenterBillingSetting,
  MockCenterClosure,
  MockBusStopDirectory,
  MockBloodSugarLog,
  MockDailyActivityLog,
  MockDb,
  MockMemberAttendanceSchedule,
  MockMemberAllergy,
  MockMemberCommandCenter,
  MockMemberContact,
  MockMemberDiagnosis,
  MockMemberEquipment,
  MockMemberFile,
  MockMemberHold,
  MockMemberHealthProfile,
  MockMemberMedication,
  MockMemberNote,
  MockMemberProvider,
  MockMemberBillingSetting,
  MockPayor,
  MockHospitalPreferenceDirectory,
  MockProviderDirectory,
  MockLead,
  MockLeadActivity,
  MockLeadStageHistory,
  MockMember,
  MockPartner,
  MockPartnerActivity,
  MockPhotoUpload,
  MockReferralSource,
  MockShowerLog,
  MockStaff,
  MockTimePunch,
  MockToiletLog,
  MockTransportationLog
} from "@/lib/mock/types";

interface FixtureStaffRow {
  staff_id: string;
  name: string;
  role: string;
  active: string;
  email: string;
  email_normalized: string;
}

interface FixtureMemberKey {
  key: string;
  qr: string;
  status: string;
  row: number;
}

interface CanonicalFixtures {
  counts: Record<string, number>;
  options: Record<string, string[]>;
  staff: FixtureStaffRow[];
  memberKeys: FixtureMemberKey[];
}

const fixtures = fixturesJson as CanonicalFixtures;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SITE_ID = "SITE-ML-01";

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickByIndex<T>(arr: T[], index: number) {
  return arr[index % arr.length];
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function countOf(key: string, fallback: number) {
  const value = fixtures.counts[key];
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function addDays(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toEasternDate(date);
}

function dateDaysAgo(days: number) {
  return toEasternDate(new Date(Date.now() - days * DAY_MS));
}

function isoAt(dateOnly: string, hour: number, minute: number) {
  return easternDateTimeLocalToISO(`${dateOnly}T${pad2(hour)}:${pad2(minute)}`);
}

function slugify(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function boolFrom(seed: string, threshold: number) {
  return (hashString(seed) % 1000) / 1000 < threshold;
}

function uuidFromKey(key: string) {
  const bytes = new Array(16).fill(0).map((_, idx) => hashString(`${key}:${idx}`) & 0xff);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toRole(rawRole: string): AppRole {
  const value = rawRole.trim().toLowerCase();
  if (value.includes("program") || value.includes("assistant") || value.includes("staff")) return "program-assistant";
  if (value.includes("coordinator")) return "coordinator";
  if (value.includes("sales")) return "sales";
  if (value.includes("director")) return "director";
  if (value.includes("nurse")) return "nurse";
  if (value.includes("manager")) return "manager";
  if (value.includes("admin")) return "admin";
  return "program-assistant";
}

function ensureRoleCoverage(rows: MockStaff[]) {
  const staff = [...rows];
  const has = (role: AppRole) => staff.some((row) => row.role === role);

  if (!has("program-assistant") && staff[0]) staff[0] = { ...staff[0], role: "program-assistant" };
  if (!has("coordinator") && staff[1]) staff[1] = { ...staff[1], role: "coordinator" };
  if (!has("nurse") && staff[2]) staff[2] = { ...staff[2], role: "nurse" };
  if (!has("sales") && staff[3]) staff[3] = { ...staff[3], role: "sales" };
  if (!has("manager") && staff[4]) staff[4] = { ...staff[4], role: "manager" };
  if (!has("director") && staff[5]) staff[5] = { ...staff[5], role: "director" };
  if (!has("admin") && staff[6]) staff[6] = { ...staff[6], role: "admin" };

  const required: Array<{ role: AppRole; name: string; staffId: string }> = [
    { role: "program-assistant", name: "Skyler Program Assistant", staffId: "stf_seed_program_assistant" },
    { role: "coordinator", name: "Casey Coordinator", staffId: "stf_seed_coordinator" },
    { role: "sales", name: "Sasha Sales", staffId: "stf_seed_sales" },
    { role: "director", name: "Dakota Director", staffId: "stf_seed_director" },
    { role: "admin", name: "Avery Admin", staffId: "stf_seed_admin" },
    { role: "manager", name: "Morgan Manager", staffId: "stf_seed_manager" },
    { role: "nurse", name: "Nora Nurse", staffId: "stf_seed_nurse" }
  ];

  required.forEach((item) => {
    if (has(item.role)) return;
    const emailSlug = slugify(item.name);
    staff.push({
      id: uuidFromKey(item.staffId),
      staff_id: item.staffId,
      full_name: item.name,
      email: `${emailSlug}@memorylane.local`,
      email_normalized: `${emailSlug}@memorylane.local`,
      role: item.role,
      active: true
    });
  });

  return staff;
}

function buildStaff() {
  const staff = fixtures.staff.map((row, idx) => {
    const fullName = row.name?.trim() || `Staff ${idx + 1}`;
    const emailSlug = slugify(fullName) || `staff.${idx + 1}`;
    const email = row.email?.trim() || `${emailSlug}@memorylane.local`;

    return {
      id: uuidFromKey(`staff:${row.staff_id || idx}`),
      staff_id: row.staff_id || `stf_seed_${idx + 1}`,
      full_name: fullName,
      email,
      email_normalized: row.email_normalized?.trim() || email.toLowerCase(),
      role: toRole(row.role),
      active: row.active !== "0"
    } as MockStaff;
  });

  return ensureRoleCoverage(staff);
}

function buildMembers() {
  const sourceMembers =
    fixtures.memberKeys.length > 0
      ? fixtures.memberKeys
      : Array.from({ length: countOf("members", 45) }).map((_, idx) => ({
          key: `seed-member-${idx + 1}`,
          qr: `QR-${String(idx + 1).padStart(4, "0")}`,
          status: "Active",
          row: idx + 2
        }));

  const keys = sourceMembers.map((member) => member.key);
  const pseudonyms = createStablePseudonymMap(keys, "member");
  const cityOptions = ["Fort Mill", "Rock Hill", "Charlotte", "Tega Cay", "Indian Land"];

  const members = sourceMembers.map((member, idx) => {
    const key = member.key;
    const enrollmentOffset = 15 + (hashString(`enrollment:${key}`) % 600);
    const birthSeed = hashString(`dob:${key}`);
    const dob = (() => {
      const date = new Date();
      date.setUTCFullYear(date.getUTCFullYear() - (62 + (birthSeed % 28)));
      date.setUTCMonth(birthSeed % 12);
      date.setUTCDate(1 + (birthSeed % 27));
      return toEasternDate(date);
    })();

    return {
      id: uuidFromKey(`member:${key}`),
      display_name: pseudonyms.get(key) ?? `Member ${idx + 1}`,
      locker_number: null,
      status: member.status?.toLowerCase() === "inactive" ? "inactive" : "active",
      discharge_date: null,
      discharge_reason: null,
      discharge_disposition: null,
      discharged_by: null,
      qr_code: member.qr?.trim() || `QR-${String(idx + 1).padStart(4, "0")}`,
      enrollment_date: idx % 9 === 0 ? null : dateDaysAgo(enrollmentOffset),
      dob,
      city: pickByIndex(cityOptions, idx),
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
    } as MockMember;
  });

  const normalizeName = (value: string) => value.trim().toLowerCase();
  const lockerReference: Array<{ locker: string; memberName: string }> = [
    { locker: "5", memberName: "Bob Lewis" },
    { locker: "11", memberName: "Ferdie Trandel" },
    { locker: "27", memberName: "Don G" },
    { locker: "33", memberName: "Liliia Velushchak" },
    { locker: "34", memberName: "Doris Joyce Hollingsworth" }
  ];

  const activeMembers = members.filter((row) => row.status === "active");
  const unassignedActiveMembers = () => activeMembers.filter((row) => !row.locker_number);
  const assignedLockers = new Set<string>();

  lockerReference.forEach((entry) => {
    const match = activeMembers.find((member) => normalizeName(member.display_name) === normalizeName(entry.memberName));
    if (!match || match.locker_number) return;
    match.locker_number = entry.locker;
    assignedLockers.add(entry.locker);
  });

  lockerReference.forEach((entry) => {
    if (assignedLockers.has(entry.locker)) return;
    const fallback = unassignedActiveMembers()[0];
    if (!fallback) return;
    fallback.locker_number = entry.locker;
    assignedLockers.add(entry.locker);
  });

  const targetAssignedCount = Math.ceil(activeMembers.length * 0.75);
  let nextLocker = 1;
  activeMembers.forEach((member) => {
    if (member.locker_number) return;
    if (assignedLockers.size >= targetAssignedCount) return;

    while (assignedLockers.has(String(nextLocker))) {
      nextLocker += 1;
    }
    member.locker_number = String(nextLocker);
    assignedLockers.add(member.locker_number);
    nextLocker += 1;
  });

  return members;
}

function seedBalancedTracksForActiveMembers(members: MockMember[]) {
  const trackCycle: Array<"Track 1" | "Track 2" | "Track 3"> = ["Track 1", "Track 2", "Track 3"];
  const scoreByTrack: Record<(typeof trackCycle)[number], number> = {
    "Track 1": 68,
    "Track 2": 52,
    "Track 3": 34
  };

  const activeSorted = members
    .filter((member) => member.status === "active")
    .sort((left, right) => left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" }));

  activeSorted.forEach((member, idx) => {
    const track = trackCycle[idx % trackCycle.length]!;
    member.latest_assessment_track = track;
    member.latest_assessment_score = scoreByTrack[track];
    member.latest_assessment_admission_review_required = false;
  });

  return members;
}

function buildAncillaryCategories() {
  return ANCILLARY_CHARGE_CATALOG.map((category) => ({
    id: uuidFromKey(`ancillary-category:${category.name}`),
    name: category.name,
    price_cents: category.price_cents
  })) as MockAncillaryCategory[];
}

function pickWorker(staff: MockStaff[], index: number) {
  const active = staff.filter((row) => row.active);
  return pickByIndex(active, index);
}

function pickClinical(staff: MockStaff[], index: number) {
  const rows = staff.filter((row) => row.active && (row.role === "nurse" || row.role === "admin"));
  return rows.length > 0 ? pickByIndex(rows, index) : pickWorker(staff, index);
}

function pickSales(staff: MockStaff[], index: number) {
  const rows = staff.filter((row) => row.active && (row.role === "admin" || row.role === "manager"));
  return rows.length > 0 ? pickByIndex(rows, index) : pickWorker(staff, index);
}

function buildOperational(staff: MockStaff[], members: MockMember[], categories: MockAncillaryCategory[]) {
  const activeMembers = members.filter((row) => row.status === "active");
  const memberPool = activeMembers.length > 0 ? activeMembers : members;
  const participationReasons = fixtures.options.participationReasons ?? ["Other"];

  const dailyActivities: MockDailyActivityLog[] = [];
  const toiletLogs: MockToiletLog[] = [];
  const showerLogs: MockShowerLog[] = [];
  const transportationLogs: MockTransportationLog[] = [];
  const photoUploads: MockPhotoUpload[] = [];
  const bloodSugarLogs: MockBloodSugarLog[] = [];
  const ancillaryLogs: MockAncillaryLog[] = [];

  const dailyCount = countOf("participation", 2000);
  for (let idx = 0; idx < dailyCount; idx += 1) {
    const member = pickByIndex(memberPool, idx);
    const worker = pickWorker(staff, idx);
    const activityDate = dateDaysAgo(idx % 120);

    const levels = [0, 1, 2, 3, 4].map((slot) => {
      const roll = hashString(`daily:${idx}:${slot}`) % 100;
      if (roll < 8) return 0;
      if (roll < 22) return 25;
      if (roll < 45) return 50;
      if (roll < 70) return 75;
      return 100;
    });

    const reasonFor = (level: number, slot: number) => (level === 0 ? pickByIndex(participationReasons, idx + slot) : null);
    const participation = Math.round((levels[0] + levels[1] + levels[2] + levels[3] + levels[4]) / 5);

    const late = boolFrom(`daily-late:${idx}`, 0.18);
    const enteredDate = late ? addDays(activityDate, 3 + (idx % 2)) : activityDate;
    const enteredAt = isoAt(enteredDate, 14 + (idx % 4), (idx * 13) % 60);

    dailyActivities.push({
      id: uuidFromKey(`daily:${idx}`),
      timestamp: enteredAt,
      activity_date: activityDate,
      staff_user_id: worker.id,
      staff_name: worker.full_name,
      staff_recording_activity: worker.full_name,
      member_id: member.id,
      member_name: member.display_name,
      participation,
      participation_reason: participation === 0 ? reasonFor(0, 0) : null,
      activity_1_level: levels[0],
      reason_missing_activity_1: reasonFor(levels[0], 1),
      activity_2_level: levels[1],
      reason_missing_activity_2: reasonFor(levels[1], 2),
      activity_3_level: levels[2],
      reason_missing_activity_3: reasonFor(levels[2], 3),
      activity_4_level: levels[3],
      reason_missing_activity_4: reasonFor(levels[3], 4),
      activity_5_level: levels[4],
      reason_missing_activity_5: reasonFor(levels[4], 5),
      notes: idx % 5 === 0 ? "Participation documented during core activity block." : null,
      email_address: worker.email,
      created_at: enteredAt
    });
  }

  const ancillaryTarget = countOf("ancillary", 63);
  const autoChargeTarget = Math.max(1, Math.floor(ancillaryTarget * 0.6));
  const toiletCount = countOf("toilet", 1800);
  const chargeStep = Math.max(1, Math.floor(toiletCount / autoChargeTarget));
  const briefsCategory = categories.find((c) => c.name.toLowerCase() === "briefs") ?? categories[0];
  let autoChargeCount = 0;

  for (let idx = 0; idx < toiletCount; idx += 1) {
    const member = pickByIndex(memberPool, idx);
    const worker = pickWorker(staff, idx + 17);
    const eventDate = dateDaysAgo(idx % 95);
    const eventAt = isoAt(eventDate, 8 + (idx % 9), (idx * 7) % 60);
    const forceCharge = autoChargeCount < autoChargeTarget && idx % chargeStep === 0;

    const briefs = forceCharge ? true : boolFrom(`toilet-briefs:${idx}`, 0.16);
    const memberSupplied = briefs ? (forceCharge ? false : boolFrom(`toilet-supplied:${idx}`, 0.62)) : false;

    const toiletId = uuidFromKey(`toilet:${idx}`);
    let linkedChargeId: string | null = null;

    if (briefs && !memberSupplied && autoChargeCount < autoChargeTarget) {
      autoChargeCount += 1;
      linkedChargeId = uuidFromKey(`ancillary:auto:${idx}`);
      ancillaryLogs.push({
        id: linkedChargeId,
        timestamp: eventAt,
        member_id: member.id,
        member_name: member.display_name,
        category_id: briefsCategory.id,
        category_name: briefsCategory.name,
        amount_cents: briefsCategory.price_cents,
        service_date: eventDate,
        late_pickup_time: null,
        staff_user_id: worker.id,
        staff_name: worker.full_name,
        staff_recording_entry: worker.full_name,
        notes: "Auto-generated from Toilet Log (briefs changed and not member supplied)",
        source_entity: "toiletLogs",
        source_entity_id: toiletId,
        quantity: 1,
        created_at: eventAt,
        reconciliation_status: idx % 5 === 0 ? "reconciled" : "open",
        reconciled_by: idx % 5 === 0 ? worker.full_name : null,
        reconciled_at: idx % 5 === 0 ? isoAt(addDays(eventDate, 2), 10, (idx * 2) % 60) : null,
        reconciliation_note: idx % 5 === 0 ? "Auto-charge reviewed during weekly billing check." : null
      });
    }

    toiletLogs.push({
      id: toiletId,
      ratee: String((idx % 5) + 1),
      event_at: eventAt,
      event_date: eventDate,
      member_id: member.id,
      member_name: member.display_name,
      briefs,
      member_supplied: memberSupplied,
      use_type: pickByIndex(TOILET_USE_TYPE_OPTIONS as unknown as string[], idx),
      staff_user_id: worker.id,
      staff_name: worker.full_name,
      staff_assisting: worker.full_name,
      linked_ancillary_charge_id: linkedChargeId,
      notes: idx % 11 === 0 ? "Assisted transfer and hygiene support completed." : null
    });
  }

  const showerCount = countOf("shower", 180);
  for (let idx = 0; idx < showerCount; idx += 1) {
    const member = pickByIndex(memberPool, idx * 2);
    const worker = pickWorker(staff, idx + 41);
    const eventDate = dateDaysAgo(idx % 120);
    const eventAt = isoAt(eventDate, 10 + (idx % 6), (idx * 9) % 60);

    showerLogs.push({
      id: uuidFromKey(`shower:${idx}`),
      timestamp: boolFrom(`shower-late:${idx}`, 0.1) ? isoAt(addDays(eventDate, 1), 9, (idx * 11) % 60) : eventAt,
      event_at: eventAt,
      event_date: eventDate,
      member_id: member.id,
      member_name: member.display_name,
      laundry: boolFrom(`shower-laundry:${idx}`, 0.45),
      briefs: boolFrom(`shower-briefs:${idx}`, 0.2),
      staff_user_id: worker.id,
      staff_name: worker.full_name,
      staff_assisting: worker.full_name,
      linked_ancillary_charge_id: null,
      notes: idx % 8 === 0 ? "Shower completed with cueing and standby assist." : null
    });
  }

  const transportationCount = countOf("transportation", 1500);
  for (let idx = 0; idx < transportationCount; idx += 1) {
    const member = pickByIndex(memberPool, idx * 3);
    const worker = pickWorker(staff, idx + 58);
    const serviceDate = dateDaysAgo(idx % 90);
    const period = idx % 2 === 0 ? "AM" : "PM";
    const expectedHour = period === "AM" ? 8 : 16;
    const late = boolFrom(`transport-late:${idx}`, 0.22);

    transportationLogs.push({
      id: uuidFromKey(`transport:${idx}`),
      timestamp: isoAt(late ? addDays(serviceDate, 1) : serviceDate, late ? expectedHour + 3 : expectedHour, (idx * 17) % 60),
      first_name: member.display_name.split(" ")[0] ?? "Member",
      member_id: member.id,
      member_name: member.display_name,
      pick_up_drop_off: period,
      period,
      transport_type: pickByIndex(TRANSPORT_TYPE_OPTIONS as unknown as string[], idx),
      service_date: serviceDate,
      staff_user_id: worker.id,
      staff_name: worker.full_name,
      staff_responsible: worker.full_name,
      notes: null
    });
  }

  const photoCount = countOf("photos", 420);
  for (let idx = 0; idx < photoCount; idx += 1) {
    const member = pickByIndex(memberPool, idx * 7);
    const worker = pickWorker(staff, idx + 8);
    const uploadDate = dateDaysAgo(idx % 160);
    photoUploads.push({
      id: uuidFromKey(`photo:${idx}`),
      member_id: member.id,
      member_name: member.display_name,
      photo_url: `https://placehold.co/600x400?text=Member+Photo+${idx + 1}`,
      file_name: `member-photo-${String(idx + 1).padStart(4, "0")}.jpg`,
      file_type: "image/jpeg",
      uploaded_by: worker.id,
      uploaded_by_name: worker.full_name,
      uploaded_at: isoAt(uploadDate, 9 + (idx % 8), (idx * 5) % 60),
      upload_date: uploadDate,
      staff_clean: worker.full_name,
      notes: idx % 14 === 0 ? "Activity photo uploaded for internal documentation." : null
    });
  }

  const bloodSugarCount = countOf("bloodSugar", 81);
  for (let idx = 0; idx < bloodSugarCount; idx += 1) {
    const member = pickByIndex(memberPool, idx * 5);
    const nurse = pickClinical(staff, idx);
    const checkDate = dateDaysAgo(idx % 75);
    const reading = 78 + (hashString(`blood:${idx}`) % 120);

    bloodSugarLogs.push({
      id: uuidFromKey(`blood:${idx}`),
      member_id: member.id,
      member_name: member.display_name,
      checked_at: isoAt(checkDate, pickByIndex([8, 12, 17], idx), (idx * 6) % 60),
      reading_mg_dl: reading,
      nurse_user_id: nurse.id,
      nurse_name: nurse.full_name,
      notes: reading > 180 ? "Elevated reading observed; follow-up per protocol." : reading < 90 ? "Low-normal reading; snack provided." : null
    });
  }

  const manualAncillaryCount = Math.max(0, ancillaryTarget - ancillaryLogs.length);
  for (let idx = 0; idx < manualAncillaryCount; idx += 1) {
    const member = pickByIndex(memberPool, idx * 4);
    const worker = pickWorker(staff, idx + 77);
    const category = pickByIndex(categories, idx + 1);
    const quantity = boolFrom(`ancillary-qty:${idx}`, 0.2) ? 2 : 1;
    const serviceDate = dateDaysAgo(idx % 60);

    ancillaryLogs.push({
      id: uuidFromKey(`ancillary:manual:${idx}`),
      timestamp: isoAt(serviceDate, 17, (idx * 3) % 60),
      member_id: member.id,
      member_name: member.display_name,
      category_id: category.id,
      category_name: category.name,
      amount_cents: category.price_cents * quantity,
      service_date: serviceDate,
      late_pickup_time: category.name.toLowerCase().includes("late pick-up") ? `${pad2(18 + (idx % 3))}:${pad2((idx * 10) % 60)}` : null,
      staff_user_id: worker.id,
      staff_name: worker.full_name,
      staff_recording_entry: worker.full_name,
      notes: "Manual ancillary entry",
      source_entity: null,
      source_entity_id: null,
      quantity,
      created_at: isoAt(serviceDate, 18, (idx * 7) % 60),
      reconciliation_status: idx % 12 === 0 ? "void" : idx % 4 === 0 ? "reconciled" : "open",
      reconciled_by: idx % 4 === 0 ? worker.full_name : null,
      reconciled_at: idx % 4 === 0 ? isoAt(addDays(serviceDate, 3), 9, (idx * 9) % 60) : null,
      reconciliation_note: idx % 12 === 0 ? "Voided duplicate test charge." : idx % 4 === 0 ? "Manual charge reconciled to source documentation." : null
    });
  }

  return {
    dailyActivities,
    toiletLogs,
    showerLogs,
    transportationLogs,
    photoUploads,
    bloodSugarLogs,
    ancillaryLogs
  };
}

function buildTimePunches(staff: MockStaff[]) {
  const punches: MockTimePunch[] = [];
  const count = countOf("timeClock", 38);
  const workers = staff.filter((row) => row.active);
  const period = getCurrentPayPeriod();

  let shift = 0;
  while (punches.length < count) {
    const worker = pickByIndex(workers, shift);
    const dateInPeriod = addDays(period.startDate, shift % 14);
    const dateOlder = dateDaysAgo(18 + (shift % 21));
    const shiftDate = shift < Math.ceil(count / 2) ? dateInPeriod : dateOlder;
    const startHour = 7 + (shift % 3);
    const startMinute = (shift * 11) % 60;
    const shiftHours = shift % 13 === 0 ? 13 : 7 + (shift % 3);
    const missingOut = shift % 17 === 0;
    const outsideFence = shift % 9 === 0;

    punches.push({
      id: uuidFromKey(`punch:in:${shift}`),
      punch_id: `PUNCH-${String(10000 + shift * 2).padStart(5, "0")}`,
      staff_user_id: worker.id,
      staff_id: worker.staff_id,
      staff_name: worker.full_name,
      punch_type: "in",
      punch_at: isoAt(shiftDate, startHour, startMinute),
      punch_lat_long: outsideFence ? "34.980,-80.995" : "34.987,-80.987",
      site_id: DEFAULT_SITE_ID,
      within_fence: !outsideFence,
      distance_meters: outsideFence ? 210 : 11,
      note: "Shift start"
    });

    if (!missingOut && punches.length < count) {
      punches.push({
        id: uuidFromKey(`punch:out:${shift}`),
        punch_id: `PUNCH-${String(10001 + shift * 2).padStart(5, "0")}`,
        staff_user_id: worker.id,
        staff_id: worker.staff_id,
        staff_name: worker.full_name,
        punch_type: "out",
        punch_at: isoAt(shiftDate, Math.min(23, startHour + shiftHours), (startMinute + 15) % 60),
        punch_lat_long: "34.987,-80.987",
        site_id: DEFAULT_SITE_ID,
        within_fence: true,
        distance_meters: 9,
        note: "Shift end"
      });
    }

    shift += 1;
  }

  return punches.slice(0, count);
}

function stageForLead(index: number) {
  const roll = hashString(`lead-stage:${index}`) % 100;
  if (roll < 28) return "Inquiry";
  if (roll < 48) return "Tour";
  if (roll < 63) return "Enrollment in Progress";
  if (roll < 81) return "Nurture";
  if (roll < 92) return "Closed - Won";
  return "Closed - Lost";
}

function buildSales(staff: MockStaff[]) {
  const partners: MockPartner[] = [];
  const referralSources: MockReferralSource[] = [];
  const leads: MockLead[] = [];
  const leadActivities: MockLeadActivity[] = [];
  const partnerActivities: MockPartnerActivity[] = [];

  const partnerCategories = fixtures.options.partnerCategories ?? ["Community Organizations", "Medical Provider", "Word of Mouth"];

  const partnerCount = countOf("partners", 120);
  for (let idx = 0; idx < partnerCount; idx += 1) {
    const contact = createStablePseudonym(`partner-contact:${idx}`, "partner");
    partners.push({
      id: uuidFromKey(`partner:${idx}`),
      partner_id: `P-${String(idx + 1).padStart(4, "0")}`,
      organization_name: `Community Partner Organization ${String(idx + 1).padStart(3, "0")}`,
      referral_source_category: pickByIndex(partnerCategories, idx),
      location: `Region ${1 + (idx % 8)}`,
      primary_phone: `803-55${String(1000 + (idx % 9000)).slice(-4)}`,
      secondary_phone: idx % 7 === 0 ? `803-66${String(2000 + (idx % 7000)).slice(-4)}` : null,
      primary_email: `partner${idx + 1}@example.org`,
      active: idx % 9 !== 0,
      notes: idx % 5 === 0 ? "Active referral relationship and periodic outreach." : null,
      last_touched: dateDaysAgo(idx % 45),
      contact_name: contact
    });
  }

  const referralCount = countOf("referralSources", 200);
  for (let idx = 0; idx < referralCount; idx += 1) {
    const partner = pickByIndex(partners, idx);
    const contact = createStablePseudonym(`referral-contact:${idx}`, "referral");
    referralSources.push({
      id: uuidFromKey(`ref-source:${idx}`),
      referral_source_id: `RS-${String(idx + 1).padStart(4, "0")}`,
      partner_id: partner.partner_id,
      contact_name: contact,
      organization_name: partner.organization_name,
      job_title: pickByIndex(["Case Manager", "Director", "Care Coordinator", "Social Worker"], idx),
      primary_phone: `704-55${String(3000 + (idx % 6000)).slice(-4)}`,
      secondary_phone: idx % 8 === 0 ? `704-77${String(1000 + (idx % 9000)).slice(-4)}` : null,
      primary_email: `referral${idx + 1}@example.org`,
      preferred_contact_method: pickByIndex(["Email", "Phone", "Text"], idx),
      active: idx % 11 !== 0,
      notes: idx % 6 === 0 ? "Prefers monthly check-ins and status updates." : null,
      last_touched: dateDaysAgo(idx % 40)
    });
  }

  const leadCount = countOf("leads", 139);
  for (let idx = 0; idx < leadCount; idx += 1) {
    const owner = pickSales(staff, idx);
    const stage = stageForLead(idx);
    const status = canonicalLeadStatus(stage.includes("Closed - Won") ? "Won" : stage.includes("Closed - Lost") ? "Lost" : stage.includes("Nurture") ? "Nurture" : "Open", stage);
    const source = pickByIndex(LEAD_SOURCE_OPTIONS as unknown as string[], idx);
    const hasPartner = source === "Referral" || source === "Hospital/Provider" || source === "Community Event";
    const partner = hasPartner ? pickByIndex(partners, idx) : null;
    const referral = hasPartner ? pickByIndex(referralSources, idx) : null;
    const inquiryDate = dateDaysAgo(8 + (idx % 220));
    const tourDate = stage === "Tour" || stage === "Enrollment in Progress" || stage === "Closed - Won" || stage === "Closed - Lost" ? addDays(inquiryDate, 4 + (idx % 20)) : null;

    const caregiver = createStablePseudonym(`caregiver:${idx}`, "caregiver");
    leads.push({
      id: uuidFromKey(`lead:${idx}`),
      lead_id: `L-${String(90000 + idx).padStart(5, "0")}`,
      created_at: isoAt(inquiryDate, 10 + (idx % 6), (idx * 5) % 60),
      created_by_user_id: owner.id,
      created_by_name: owner.full_name,
      status,
      stage,
      stage_updated_at: isoAt(addDays(inquiryDate, 2 + (idx % 10)), 15, (idx * 7) % 60),
      inquiry_date: inquiryDate,
      tour_date: tourDate,
      tour_completed: stage !== "Inquiry" && stage !== "Nurture",
      discovery_date: stage === "Inquiry" ? null : addDays(inquiryDate, 1 + (idx % 5)),
      member_start_date: stage === "Enrollment in Progress" || stage === "Closed - Won" ? addDays(inquiryDate, 21 + (idx % 30)) : null,
      caregiver_name: caregiver,
      caregiver_relationship: pickByIndex(["Daughter", "Son", "Spouse", "Niece", "Friend"], idx),
      caregiver_email: `${slugify(caregiver)}@example.com`,
      caregiver_phone: `839-55${String(2000 + (idx % 7000)).slice(-4)}`,
      member_name: createStablePseudonym(`lead-member:${idx}`, "lead-member"),
      member_dob: idx % 4 === 0 ? null : addDays(inquiryDate, -(22000 + (idx % 9500))),
      lead_source: source,
      lead_source_other: source === "Other" ? "Community outreach" : null,
      referral_name: referral?.contact_name ?? null,
      likelihood: pickByIndex(LEAD_LIKELIHOOD_OPTIONS as unknown as string[], idx),
      next_follow_up_date: status === "Open" || status === "Nurture" ? addDays(inquiryDate, 3 + (idx % 14)) : null,
      next_follow_up_type: status === "Open" || status === "Nurture" ? pickByIndex(LEAD_FOLLOW_UP_TYPES as unknown as string[], idx) : null,
      notes_summary: "Inquiry entered from canonical workbook-aligned pipeline seed.",
      lost_reason: status === "Lost" ? pickByIndex(LEAD_LOST_REASON_OPTIONS as unknown as string[], idx) : null,
      closed_date: status === "Won" || status === "Lost" ? addDays(inquiryDate, 10 + (idx % 35)) : null,
      partner_id: partner?.partner_id ?? null,
      referral_source_id: referral?.referral_source_id ?? null
    });
  }

  const leadActivityCount = countOf("leadActivities", 22);
  for (let idx = 0; idx < leadActivityCount; idx += 1) {
    const lead = pickByIndex(leads, idx * 5 + 1);
    const owner = pickSales(staff, idx + 13);
    const activityDate = addDays(lead.inquiry_date, 1 + (idx % 18));
    const outcome = pickByIndex(LEAD_ACTIVITY_OUTCOMES as unknown as string[], idx);

    leadActivities.push({
      id: uuidFromKey(`lead-activity:${idx}`),
      activity_id: `LA-${String(50000 + idx).padStart(5, "0")}`,
      lead_id: lead.id,
      member_name: lead.member_name,
      activity_at: isoAt(activityDate, 11 + (idx % 6), (idx * 9) % 60),
      activity_type: pickByIndex(LEAD_ACTIVITY_TYPES as unknown as string[], idx),
      outcome,
      lost_reason: outcome === "Not a fit" ? pickByIndex(LEAD_LOST_REASON_OPTIONS as unknown as string[], idx) : null,
      notes: "Follow-up activity logged for pipeline progression.",
      next_follow_up_date: lead.status === "Open" || lead.status === "Nurture" ? addDays(activityDate, 5 + (idx % 7)) : null,
      next_follow_up_type: lead.status === "Open" || lead.status === "Nurture" ? pickByIndex(LEAD_FOLLOW_UP_TYPES as unknown as string[], idx + 2) : null,
      completed_by_user_id: owner.id,
      completed_by_name: owner.full_name,
      partner_id: lead.partner_id ?? null,
      referral_source_id: lead.referral_source_id ?? null
    });
  }

  const partnerActivityCount = Math.max(countOf("partnerActivities", 0), 18);
  for (let idx = 0; idx < partnerActivityCount; idx += 1) {
    const partner = pickByIndex(partners, idx);
    const referral = referralSources.find((source) => source.partner_id === partner.partner_id) ?? null;
    const lead = leads.find((item) => item.partner_id === partner.partner_id) ?? null;
    const owner = pickSales(staff, idx + 5);
    const activityDate = dateDaysAgo(idx % 75);

    partnerActivities.push({
      id: uuidFromKey(`partner-activity:${idx}`),
      partner_activity_id: `PA-${String(60000 + idx).padStart(5, "0")}`,
      referral_source_id: referral?.referral_source_id ?? null,
      partner_id: partner.partner_id,
      organization_name: partner.organization_name,
      contact_name: referral?.contact_name ?? partner.contact_name,
      activity_at: isoAt(activityDate, 10 + (idx % 7), (idx * 8) % 60),
      activity_type: pickByIndex(LEAD_ACTIVITY_TYPES as unknown as string[], idx),
      notes: "Partner outreach logged in mock mode.",
      completed_by: owner.full_name,
      next_follow_up_date: addDays(activityDate, 14 + (idx % 10)),
      next_follow_up_type: pickByIndex(LEAD_FOLLOW_UP_TYPES as unknown as string[], idx),
      last_touched: activityDate,
      lead_id: lead?.id ?? null,
      completed_by_user_id: owner.id
    });
  }

  return { partners, referralSources, leads, leadActivities, partnerActivities };
}

function buildAssessments(staff: MockStaff[], members: MockMember[]) {
  const activeMembers = members.filter((row) => row.status === "active");
  const memberPool = activeMembers.length > 0 ? activeMembers : members;
  const nurses = staff.filter((row) => row.role === "nurse" || row.role === "admin");
  const assessmentCount = Math.max(24, Math.floor(memberPool.length * 0.9));

  const scoreProfiles: Array<[15 | 10 | 5, 15 | 10 | 5, 15 | 10 | 5, 15 | 10 | 5, 15 | 10 | 5]> = [
    [15, 15, 15, 10, 10],
    [15, 10, 10, 10, 10],
    [10, 10, 10, 10, 10],
    [10, 10, 10, 5, 5],
    [10, 10, 5, 5, 5],
    [5, 5, 5, 5, 5]
  ];

  const assessments: MockAssessment[] = [];
  for (let idx = 0; idx < assessmentCount; idx += 1) {
    const member = pickByIndex(memberPool, idx);
    const nurse = pickByIndex(nurses.length > 0 ? nurses : staff, idx);
    const assessmentDate = dateDaysAgo(12 + (idx % 170));
    const complete = idx % 6 !== 0;

    const [s1, s2, s3, s4, s5] = pickByIndex(scoreProfiles, idx);
    const total = calculateAssessmentTotal({
      orientationGeneralHealth: s1,
      dailyRoutinesIndependence: s2,
      nutritionDietaryNeeds: s3,
      mobilitySafety: s4,
      socialEmotionalWellness: s5
    });
    const track = getAssessmentTrack(total);

    assessments.push({
      id: uuidFromKey(`assessment:${idx}`),
      lead_id: null,
      lead_stage_at_assessment: null,
      lead_status_at_assessment: null,
      member_id: member.id,
      member_name: member.display_name,
      assessment_date: assessmentDate,
      completed_by: nurse.full_name,
      signed_by: nurse.full_name,
      complete,

      feeling_today: idx % 4 === 0 ? "Tired but engaged" : "Good and ready for day program",
      health_lately: idx % 5 === 0 ? "Variable energy; monitor hydration" : "Stable baseline per caregiver report",
      allergies: idx % 6 === 0 ? "Penicillin" : "None reported",
      code_status: idx % 8 === 0 ? "DNR" : "Full Code",
      orientation_dob_verified: idx % 5 !== 0,
      orientation_city_verified: idx % 7 !== 0,
      orientation_year_verified: idx % 6 !== 0,
      orientation_occupation_verified: idx % 4 !== 0,
      orientation_notes: "Orientation prompts used as needed during intake.",

      medication_management_status: idx % 3 === 0 ? "Needs full cueing" : "Independent with reminders",
      dressing_support_status: idx % 4 === 0 ? "Needs partial assistance" : "Independent",
      assistive_devices: idx % 2 === 0 ? "Walker" : "None",
      incontinence_products: idx % 3 === 0 ? "Briefs" : "None",
      on_site_medication_use: idx % 5 === 0 ? "Yes" : "No",
      on_site_medication_list:
        idx % 5 === 0
          ? pickByIndex(
              [
                "Donepezil 10mg AM; Metformin 500mg PM",
                "Lisinopril 10mg daily",
                "Memantine 5mg BID; Aspirin 81mg daily"
              ],
              idx
            )
          : "",
      independence_notes: "Daily routine support aligned to current functional status.",

      diet_type: pickByIndex(["Regular", "Diabetic", "Low Sodium"], idx),
      diet_other: "",
      diet_restrictions_notes: idx % 5 === 0 ? "Encourage low sugar snacks and hydration." : "Standard meal plan tolerated.",

      mobility_steadiness: idx % 3 === 0 ? "Unsteady" : "Steady with supervision",
      falls_history: idx % 7 === 0 ? "Fall in last 6 months" : "No recent falls reported",
      mobility_aids: idx % 2 === 0 ? "Walker" : "Cane",
      mobility_safety_notes: "Transfer safety cues reviewed with team.",

      overwhelmed_by_noise: idx % 4 === 0,
      social_triggers: idx % 4 === 0 ? "Loud/crowded spaces" : "None identified",
      emotional_wellness_notes: "Monitor engagement and redirect as needed.",

      joy_sparks: idx % 2 === 0 ? "Music and gardening discussions" : "Group games and storytelling",
      personal_notes: "Preferred seating near familiar peers.",

      score_orientation_general_health: s1,
      score_daily_routines_independence: s2,
      score_nutrition_dietary_needs: s3,
      score_mobility_safety: s4,
      score_social_emotional_wellness: s5,
      total_score: total,
      recommended_track: track.recommendedTrack,
      admission_review_required: track.admissionReviewRequired,

      transport_can_enter_exit_vehicle: idx % 3 === 0 ? "Needs assistance" : "Independent",
      transport_assistance_level: idx % 3 === 0 ? "1:1 assist" : "Standby",
      transport_mobility_aid: idx % 2 === 0 ? "Walker" : "None",
      transport_can_remain_seated_buckled: idx % 5 !== 0,
      transport_behavior_concern: idx % 8 === 0 ? "May unbuckle without reminders" : "None observed",
      transport_appropriate: idx % 7 !== 0,
      transport_notes: "Transportation suitability reviewed during assessment.",
      vitals_hr: 64 + (idx % 22),
      vitals_bp: idx % 4 === 0 ? "118/74" : idx % 3 === 0 ? "126/82" : "122/78",
      vitals_o2_percent: 95 + (idx % 5),
      vitals_rr: 14 + (idx % 7),

      reviewer_name: nurse.full_name,
      notes: "Initial intake assessment captured for planning and onboarding.",
      created_by_user_id: nurse.id,
      created_by_name: nurse.full_name,
      created_at: isoAt(assessmentDate, 15, (idx * 4) % 60)
    });
  }

  return assessments;
}

function buildAssessmentResponses(assessments: MockAssessment[]): MockAssessmentResponse[] {
  const responses: MockAssessmentResponse[] = [];

  function pushResponse(
    assessment: MockAssessment,
    section: string,
    key: string,
    label: string,
    value: string | number | boolean,
    valueType: MockAssessmentResponse["field_value_type"]
  ) {
    responses.push({
      id: uuidFromKey(`assessment-response:${assessment.id}:${key}`),
      assessment_id: assessment.id,
      member_id: assessment.member_id,
      field_key: key,
      field_label: label,
      section_type: section,
      field_value: String(value),
      field_value_type: valueType,
      created_at: assessment.created_at
    });
  }

  assessments.forEach((assessment) => {
    pushResponse(assessment, "Orientation & General Health", "feeling_today", "How Member Is Feeling Today", assessment.feeling_today, "string");
    pushResponse(assessment, "Orientation & General Health", "health_lately", "Health Lately", assessment.health_lately, "string");
    pushResponse(assessment, "Orientation & General Health", "allergies", "Allergies", assessment.allergies, "string");
    pushResponse(assessment, "Orientation & General Health", "code_status", "Code Status", assessment.code_status, "string");
    pushResponse(assessment, "Orientation & General Health", "orientation_dob_verified", "Orientation DOB Verified", assessment.orientation_dob_verified, "boolean");
    pushResponse(assessment, "Orientation & General Health", "orientation_city_verified", "Orientation City Verified", assessment.orientation_city_verified, "boolean");
    pushResponse(assessment, "Orientation & General Health", "orientation_year_verified", "Orientation Current Year Verified", assessment.orientation_year_verified, "boolean");
    pushResponse(assessment, "Orientation & General Health", "orientation_occupation_verified", "Orientation Former Occupation Verified", assessment.orientation_occupation_verified, "boolean");

    pushResponse(assessment, "Independence & Daily Routines", "medication_management_status", "Medication Management", assessment.medication_management_status, "string");
    pushResponse(assessment, "Independence & Daily Routines", "dressing_support_status", "Dressing Support", assessment.dressing_support_status, "string");
    pushResponse(assessment, "Independence & Daily Routines", "assistive_devices", "Assistive Devices", assessment.assistive_devices, "string");
    pushResponse(assessment, "Independence & Daily Routines", "incontinence_products", "Incontinence Products", assessment.incontinence_products, "string");
    pushResponse(assessment, "Independence & Daily Routines", "on_site_medication_use", "On-site Medication Use", assessment.on_site_medication_use, "string");
    pushResponse(assessment, "Independence & Daily Routines", "on_site_medication_list", "On-site Medication List", assessment.on_site_medication_list, "string");

    pushResponse(assessment, "Diet & Nutrition", "diet_type", "Diet Type", assessment.diet_type, "string");
    pushResponse(assessment, "Diet & Nutrition", "diet_other", "Diet Other", assessment.diet_other, "string");
    pushResponse(assessment, "Diet & Nutrition", "diet_restrictions_notes", "Diet Notes", assessment.diet_restrictions_notes, "string");

    pushResponse(assessment, "Mobility & Safety", "mobility_steadiness", "Steadiness / Mobility", assessment.mobility_steadiness, "string");
    pushResponse(assessment, "Mobility & Safety", "falls_history", "Falls History", assessment.falls_history, "string");
    pushResponse(assessment, "Mobility & Safety", "mobility_aids", "Mobility Aids", assessment.mobility_aids, "string");
    pushResponse(assessment, "Mobility & Safety", "mobility_safety_notes", "Mobility / Safety Notes", assessment.mobility_safety_notes, "string");

    pushResponse(assessment, "Social Engagement & Emotional Wellness", "overwhelmed_by_noise", "Overwhelmed by Noise/Busyness", assessment.overwhelmed_by_noise, "boolean");
    pushResponse(assessment, "Social Engagement & Emotional Wellness", "social_triggers", "Known Triggers", assessment.social_triggers, "string");
    pushResponse(assessment, "Social Engagement & Emotional Wellness", "emotional_wellness_notes", "Emotional Wellness Notes", assessment.emotional_wellness_notes, "string");
    pushResponse(assessment, "Personal Notes & Joy Sparks", "joy_sparks", "Joy Sparks", assessment.joy_sparks, "string");
    pushResponse(assessment, "Personal Notes & Joy Sparks", "personal_notes", "Personal Notes", assessment.personal_notes, "string");

    pushResponse(assessment, "Scoring", "score_orientation_general_health", "Orientation & General Health Score", assessment.score_orientation_general_health, "number");
    pushResponse(assessment, "Scoring", "score_daily_routines_independence", "Daily Routines & Independence Score", assessment.score_daily_routines_independence, "number");
    pushResponse(assessment, "Scoring", "score_nutrition_dietary_needs", "Nutrition & Dietary Needs Score", assessment.score_nutrition_dietary_needs, "number");
    pushResponse(assessment, "Scoring", "score_mobility_safety", "Mobility & Safety Score", assessment.score_mobility_safety, "number");
    pushResponse(assessment, "Scoring", "score_social_emotional_wellness", "Social & Emotional Wellness Score", assessment.score_social_emotional_wellness, "number");
    pushResponse(assessment, "Scoring", "total_score", "Total Score", assessment.total_score, "number");
    pushResponse(assessment, "Scoring", "recommended_track", "Recommended Track", assessment.recommended_track, "string");
    pushResponse(assessment, "Scoring", "admission_review_required", "Admission Review Required", assessment.admission_review_required, "boolean");

    pushResponse(assessment, "Transportation Screening", "transport_can_enter_exit_vehicle", "Can Enter/Exit Vehicle", assessment.transport_can_enter_exit_vehicle, "string");
    pushResponse(assessment, "Transportation Screening", "transport_assistance_level", "Transport Assistance Level", assessment.transport_assistance_level, "string");
    pushResponse(assessment, "Transportation Screening", "transport_mobility_aid", "Transport Mobility Aid", assessment.transport_mobility_aid, "string");
    pushResponse(assessment, "Transportation Screening", "transport_can_remain_seated_buckled", "Can Remain Seated and Buckled", assessment.transport_can_remain_seated_buckled, "boolean");
    pushResponse(assessment, "Transportation Screening", "transport_behavior_concern", "Transport Behavior Concern", assessment.transport_behavior_concern, "string");
    pushResponse(assessment, "Transportation Screening", "transport_appropriate", "Appropriate for Center Transportation", assessment.transport_appropriate, "boolean");
    pushResponse(assessment, "Vital Signs", "vitals_hr", "HR", assessment.vitals_hr, "number");
    pushResponse(assessment, "Vital Signs", "vitals_bp", "BP", assessment.vitals_bp, "string");
    pushResponse(assessment, "Vital Signs", "vitals_o2_percent", "O2 %", assessment.vitals_o2_percent, "number");
    pushResponse(assessment, "Vital Signs", "vitals_rr", "RR", assessment.vitals_rr, "number");
  });

  return responses;
}

function buildMemberHealthArtifacts(
  members: MockMember[],
  assessments: MockAssessment[],
  staff: MockStaff[]
): {
  memberHealthProfiles: MockMemberHealthProfile[];
  memberDiagnoses: MockMemberDiagnosis[];
  memberMedications: MockMemberMedication[];
  memberAllergies: MockMemberAllergy[];
  memberProviders: MockMemberProvider[];
  providerDirectory: MockProviderDirectory[];
  hospitalPreferenceDirectory: MockHospitalPreferenceDirectory[];
  memberEquipment: MockMemberEquipment[];
  memberNotes: MockMemberNote[];
} {
  const now = toEasternISO();
  const nurse =
    staff.find((row) => row.role === "nurse") ??
    staff[0] ?? {
      id: uuidFromKey("seed-fallback-nurse"),
      staff_id: "stf_fallback_nurse",
      full_name: "Fallback Nurse",
      email: "fallback.nurse@memorylane.local",
      email_normalized: "fallback.nurse@memorylane.local",
      role: "nurse" as const,
      active: true
    };
  const latestAssessmentByMember = new Map<string, MockAssessment>();

  assessments.forEach((assessment) => {
    const existing = latestAssessmentByMember.get(assessment.member_id);
    if (!existing || existing.assessment_date < assessment.assessment_date) {
      latestAssessmentByMember.set(assessment.member_id, assessment);
    }
  });

  const memberHealthProfiles = members.map((member, idx) => {
    const latest = latestAssessmentByMember.get(member.id);
    const sourceDate = latest?.assessment_date ?? member.latest_assessment_date ?? member.enrollment_date ?? dateDaysAgo(60);

    return {
      id: uuidFromKey(`mhp:${member.id}`),
      member_id: member.id,
      gender: idx % 2 === 0 ? "Female" : "Male",
      payor: idx % 3 === 0 ? "Veterans Program" : "Private Pay",
      original_referral_source: idx % 2 === 0 ? "Hospital Referral" : "Family Referral",
      photo_consent: true,
      profile_image_url: null,
      primary_caregiver_name: `Caregiver ${idx + 1}`,
      primary_caregiver_phone: `803-555-${String(1000 + idx).slice(-4)}`,
      responsible_party_name: `Responsible Party ${idx + 1}`,
      responsible_party_phone: `803-555-${String(2000 + idx).slice(-4)}`,
      provider_name: "Dr. Morgan White",
      provider_phone: "803-555-3000",
      important_alerts: member.social_triggers ?? null,

      diet_type: member.diet_type,
      dietary_restrictions: member.diet_restrictions_notes,
      swallowing_difficulty: null,
      diet_texture: null,
      supplements: null,
      foods_to_omit: null,

      ambulation: member.mobility_status,
      transferring: null,
      bathing: null,
      dressing: member.dressing_support_status,
      eating: null,
      bladder_continence: member.incontinence_products,
      bowel_continence: null,
      toileting: null,
      toileting_needs: member.incontinence_products,
      toileting_comments: null,
      hearing: null,
      vision: null,
      dental: null,
      speech_verbal_status: null,
      speech_comments: null,
      personal_appearance_hygiene_grooming: null,
      may_self_medicate: member.medication_management_status?.toLowerCase().includes("independent") ?? null,
      medication_manager_name: member.medication_management_status?.toLowerCase().includes("independent") ? null : "Caregiver",

      orientation_dob: member.orientation_dob_verified ? member.dob : null,
      orientation_city: member.orientation_city_verified ? member.city : null,
      orientation_current_year: member.orientation_year_verified ? toEasternDate().slice(0, 4) : null,
      orientation_former_occupation: member.orientation_occupation_verified ? "Verified" : null,
      memory_impairment: member.latest_assessment_track === "Track 1" ? "Mild" : member.latest_assessment_track ? "Moderate" : null,
      memory_severity: member.latest_assessment_track === "Track 3" ? "High" : member.latest_assessment_track ? "Medium" : null,
      wandering: false,
      combative_disruptive: false,
      sleep_issues: false,
      self_harm_unsafe: false,
      impaired_judgement: false,
      delirium: false,
      disorientation: false,
      agitation_resistive: false,
      screaming_loud_noises: false,
      exhibitionism_disrobing: false,
      exit_seeking: false,
      cognitive_behavior_comments: member.social_triggers,

      code_status: member.code_status,
      dnr: member.code_status === "DNR",
      dni: false,
      polst_molst_colst: null,
      hospice: false,
      advanced_directives_obtained: false,
      power_of_attorney: null,
      hospital_preference: null,
      legal_comments: null,

      source_assessment_id: latest?.id ?? member.latest_assessment_id,
      source_assessment_at: sourceDate,
      created_at: now,
      updated_at: now
    };
  });

  const memberDiagnoses: MockMemberDiagnosis[] = members.slice(0, Math.max(18, Math.floor(members.length * 0.5))).map((member, idx) => ({
    id: uuidFromKey(`mhp-diagnosis:${member.id}:${idx}`),
    member_id: member.id,
    diagnosis_type: idx % 2 === 0 ? "primary" : "secondary",
    diagnosis_name: idx % 2 === 0 ? "Dementia" : "Type 2 Diabetes",
    diagnosis_code: null,
    date_added: dateDaysAgo(30 + idx),
    comments: null,
    created_by_user_id: nurse.id,
    created_by_name: nurse.full_name,
    created_at: now,
    updated_at: now
  }));

  const memberMedications: MockMemberMedication[] = members.slice(0, Math.max(16, Math.floor(members.length * 0.45))).map((member, idx) => ({
    id: uuidFromKey(`mhp-medication:${member.id}:${idx}`),
    member_id: member.id,
    medication_name: idx % 2 === 0 ? "Donepezil" : "Metformin",
    date_started: dateDaysAgo(120 - (idx % 60)),
    medication_status: idx % 7 === 0 ? "inactive" : "active",
    inactivated_at: idx % 7 === 0 ? dateDaysAgo(20 - (idx % 10)) : null,
    dose: idx % 2 === 0 ? "10 mg" : "500 mg",
    quantity: "1 tablet",
    form: "Tablet",
    frequency: idx % 2 === 0 ? "Daily" : "BID",
    route: "PO",
    comments: null,
    created_by_user_id: nurse.id,
    created_by_name: nurse.full_name,
    created_at: now,
    updated_at: now
  }));

  const memberAllergies: MockMemberAllergy[] = members.flatMap((member, idx) => {
    if (idx % 5 === 0) return [];

    const primary: MockMemberAllergy = {
      id: uuidFromKey(`mhp-allergy:${member.id}:${idx}:primary`),
      member_id: member.id,
      allergy_group: idx % 3 === 0 ? "food" : idx % 3 === 1 ? "medication" : "environmental",
      allergy_name: idx % 3 === 0 ? "Peanuts" : idx % 3 === 1 ? "Penicillin" : "Pollen",
      severity: idx % 2 === 0 ? "Moderate" : "Mild",
      comments: null,
      created_by_user_id: nurse.id,
      created_by_name: nurse.full_name,
      created_at: now,
      updated_at: now
    };

    const includeSecondary = idx % 7 === 0;
    if (!includeSecondary) return [primary];

    const secondary: MockMemberAllergy = {
      id: uuidFromKey(`mhp-allergy:${member.id}:${idx}:secondary`),
      member_id: member.id,
      allergy_group: primary.allergy_group === "food" ? "medication" : "food",
      allergy_name: primary.allergy_group === "food" ? "Sulfa" : "Shellfish",
      severity: "High",
      comments: null,
      created_by_user_id: nurse.id,
      created_by_name: nurse.full_name,
      created_at: now,
      updated_at: now
    };

    return [primary, secondary];
  });

  const memberProviders: MockMemberProvider[] = members
    .slice(0, Math.max(20, Math.floor(members.length * 0.6)))
    .map((member, idx) => ({
      id: uuidFromKey(`mhp-provider:${member.id}:${idx}`),
      member_id: member.id,
      provider_name: idx % 2 === 0 ? "Dr. Morgan White" : "Dr. Alicia Greene",
      specialty: idx % 2 === 0 ? "Geriatrics" : "Family Medicine",
      specialty_other: null,
      practice_name: idx % 2 === 0 ? "Town Square Geriatric Care" : "Carolina Family Medicine",
      provider_phone: `803-555-${String(3100 + idx).slice(-4)}`,
      created_by_user_id: nurse.id,
      created_by_name: nurse.full_name,
      created_at: now,
      updated_at: now
    }));

  const providerDirectory: MockProviderDirectory[] = Array.from(
    new Map(
      memberProviders.map((provider) => [
        provider.provider_name.trim().toLowerCase(),
        {
          id: uuidFromKey(`provider-directory:${provider.provider_name.trim().toLowerCase()}`),
          provider_name: provider.provider_name,
          specialty: provider.specialty ?? null,
          specialty_other: provider.specialty_other ?? null,
          practice_name: provider.practice_name ?? null,
          provider_phone: provider.provider_phone ?? null,
          created_by_user_id: provider.created_by_user_id,
          created_by_name: provider.created_by_name,
          created_at: now,
          updated_at: now
        } as MockProviderDirectory
      ])
    ).values()
  );

  const seededHospitals = [
    "Atrium Health Pineville",
    "Piedmont Medical Center",
    "Novant Health Presbyterian Medical Center",
    "Catawba Valley Medical Center"
  ];
  const hospitalPreferenceDirectory: MockHospitalPreferenceDirectory[] = Array.from(
    new Map(
      [
        ...seededHospitals.map((hospitalName) => ({
          hospitalName,
          createdByUserId: nurse.id,
          createdByName: nurse.full_name
        })),
        ...memberHealthProfiles
          .map((profile) => String((profile as { hospital_preference?: string | null }).hospital_preference ?? "").trim())
          .filter((hospitalName) => hospitalName.length > 0)
          .map((hospitalName) => ({
            hospitalName,
            createdByUserId: nurse.id,
            createdByName: nurse.full_name
          }))
      ].map((entry) => [
        entry.hospitalName.toLowerCase(),
        {
          id: uuidFromKey(`hospital-preference-directory:${entry.hospitalName.toLowerCase()}`),
          hospital_name: entry.hospitalName,
          created_by_user_id: entry.createdByUserId,
          created_by_name: entry.createdByName,
          created_at: now,
          updated_at: now
        } as MockHospitalPreferenceDirectory
      ])
    ).values()
  );

  const memberEquipment: MockMemberEquipment[] = members.slice(0, Math.max(20, Math.floor(members.length * 0.55))).map((member, idx) => ({
    id: uuidFromKey(`mhp-equipment:${member.id}:${idx}`),
    member_id: member.id,
    equipment_type: idx % 3 === 0 ? "Walker" : idx % 3 === 1 ? "Wheelchair" : "Disposable items",
    provider_source: "Center Supply",
    status: "Active",
    comments: null,
    created_by_user_id: nurse.id,
    created_by_name: nurse.full_name,
    created_at: now,
    updated_at: now
  }));

  const memberNotes: MockMemberNote[] = members.slice(0, Math.max(24, Math.floor(members.length * 0.7))).map((member, idx) => ({
    id: uuidFromKey(`mhp-note:${member.id}:${idx}`),
    member_id: member.id,
    note_type: idx % 2 === 0 ? "Clinical Update" : "Care Team Note",
    note_text: idx % 2 === 0 ? "Member tolerated group activity without issues." : "Monitor hydration and afternoon fatigue.",
    created_by_user_id: nurse.id,
    created_by_name: nurse.full_name,
    created_at: now,
    updated_at: now
  }));

  return {
    memberHealthProfiles,
    memberDiagnoses,
    memberMedications,
    memberAllergies,
    memberProviders,
    providerDirectory,
    hospitalPreferenceDirectory,
    memberEquipment,
    memberNotes
  };
}

function buildMemberCommandCenterArtifacts(
  members: MockMember[],
  assessments: MockAssessment[],
  staff: MockStaff[]
): {
  memberCommandCenters: MockMemberCommandCenter[];
  memberAttendanceSchedules: MockMemberAttendanceSchedule[];
  memberContacts: MockMemberContact[];
  memberFiles: MockMemberFile[];
} {
  const now = toEasternISO();
  const coordinator =
    staff.find((row) => row.role === "manager") ??
    staff.find((row) => row.role === "admin") ??
    staff[0] ?? {
      id: "system",
      full_name: "System User"
    };

  const latestAssessmentByMember = new Map<string, MockAssessment>();
  assessments.forEach((assessment) => {
    const current = latestAssessmentByMember.get(assessment.member_id);
    if (!current || current.assessment_date < assessment.assessment_date) {
      latestAssessmentByMember.set(assessment.member_id, assessment);
    }
  });

  const maritalOptions = ["Single", "Married", "Widowed", "Divorced"];
  const languageOptions = ["English", "Spanish", "French", "German"];
  const religionOptions = ["Christian", "Catholic", "Jewish", "None"];
  const ethnicityOptions = ["White", "Black or African American", "Hispanic/Latino", "Asian"];
  const veteranBranchOptions = ["Army", "Navy", "Air Force", "Marine Corps", "Coast Guard"];
  const payorOptions = ["Private Pay", "VA", "Long-Term Care Insurance", "Family Support"];
  const locationOptions = ["Fort Mill Center", "Rock Hill Center"];

  const memberCommandCenters: MockMemberCommandCenter[] = members.map((member, idx) => {
    const latest = latestAssessmentByMember.get(member.id) ?? null;
    const fromAssessmentAllergies = latest?.allergies?.trim() ?? "";
    const noKnownAllergies = fromAssessmentAllergies.toUpperCase() === "NKA";
    const profileGender = idx % 2 === 0 ? "M" : "F";

    const isVeteran = idx % 9 === 0;
    return {
      id: uuidFromKey(`command-center:${member.id}`),
      member_id: member.id,
      gender: profileGender,
      payor: pickByIndex(payorOptions, idx),
      original_referral_source: latest?.lead_id ? "Referral" : "Community Outreach",
      photo_consent: true,
      profile_image_url: null,
      location: pickByIndex(locationOptions, idx),

      street_address: `${120 + idx} Main St`,
      city: member.city ?? "Fort Mill",
      state: "SC",
      zip: `297${String((idx % 40) + 10).padStart(2, "0")}`,
      marital_status: pickByIndex(maritalOptions, idx),
      primary_language: pickByIndex(languageOptions, idx),
      secondary_language: idx % 5 === 0 ? "Spanish" : null,
      religion: pickByIndex(religionOptions, idx),
      ethnicity: pickByIndex(ethnicityOptions, idx),
      is_veteran: isVeteran,
      veteran_branch: isVeteran ? pickByIndex(veteranBranchOptions, idx) : null,

      code_status: member.code_status ?? latest?.code_status ?? "Full Code",
      dnr: (member.code_status ?? latest?.code_status ?? "Full Code") === "DNR",
      dni: false,
      polst_molst_colst: null,
      hospice: false,
      advanced_directives_obtained: idx % 2 === 0,
      power_of_attorney: idx % 3 === 0 ? "On File" : null,
      funeral_home: null,
      legal_comments: null,

      diet_type: member.diet_type ?? latest?.diet_type ?? "Regular",
      dietary_preferences_restrictions: member.diet_restrictions_notes ?? latest?.diet_restrictions_notes ?? null,
      swallowing_difficulty: null,
      supplements: null,
      food_dislikes: null,
      foods_to_omit: null,
      diet_texture: "Regular",
      no_known_allergies: noKnownAllergies,
      medication_allergies: !noKnownAllergies ? fromAssessmentAllergies || member.allergies : null,
      food_allergies: null,
      environmental_allergies: null,
      command_center_notes: latest?.joy_sparks || latest?.personal_notes || null,

      source_assessment_id: latest?.id ?? null,
      source_assessment_at: latest?.assessment_date ?? null,
      updated_by_user_id: coordinator.id,
      updated_by_name: coordinator.full_name,
      created_at: now,
      updated_at: now
    };
  });

  const memberAttendanceSchedules: MockMemberAttendanceSchedule[] = members.map((member, idx) => {
    const scheduleSeed = hashString(`attendance:${member.id}`);
    const monday = (scheduleSeed & 1) === 1;
    const tuesday = (scheduleSeed & 2) === 2;
    const wednesday = (scheduleSeed & 4) === 4;
    const thursday = (scheduleSeed & 8) === 8;
    const friday = (scheduleSeed & 16) === 16;
    const hasAnyDay = monday || tuesday || wednesday || thursday || friday;

    const transportationRequired = member.transport_appropriate ?? (idx % 3 === 0);
    const defaultDoorToDoorAddress = `${120 + idx} Main St, ${member.city ?? "Fort Mill"}, SC, 297${String((idx % 40) + 10).padStart(2, "0")}`;
    const mondayEnabled = hasAnyDay ? monday : true;
    const tuesdayEnabled = hasAnyDay ? tuesday : false;
    const wednesdayEnabled = hasAnyDay ? wednesday : true;
    const thursdayEnabled = hasAnyDay ? thursday : false;
    const fridayEnabled = hasAnyDay ? friday : true;
    const attendanceDaysPerWeek = [mondayEnabled, tuesdayEnabled, wednesdayEnabled, thursdayEnabled, fridayEnabled].filter(Boolean).length;
    const defaultDailyRate = getStandardDailyRateForAttendanceDays(attendanceDaysPerWeek);
    const buildDayTransport = (dayKey: string, dayEnabled: boolean) => {
      if (!transportationRequired || !dayEnabled) {
        return {
          amMode: null,
          amDoorToDoorAddress: null,
          amBusNumber: null,
          amBusStop: null,
          pmMode: null,
          pmDoorToDoorAddress: null,
          pmBusNumber: null,
          pmBusStop: null
        } as const;
      }

      const amMode = hashString(`${dayKey}:am:${member.id}`) % 2 === 0 ? "Door to Door" : "Bus Stop";
      const pmMode = hashString(`${dayKey}:pm:${member.id}`) % 2 === 0 ? "Door to Door" : "Bus Stop";
      return {
        amMode,
        amDoorToDoorAddress: amMode === "Door to Door" ? defaultDoorToDoorAddress : null,
        amBusNumber: amMode === "Bus Stop" ? (String((hashString(`${dayKey}:am-bus:${idx}`) % 3) + 1) as "1" | "2" | "3") : null,
        amBusStop: amMode === "Bus Stop" ? `Stop ${((hashString(`${dayKey}:am-stop:${idx}`) % 6) + 1).toString()}` : null,
        pmMode,
        pmDoorToDoorAddress: pmMode === "Door to Door" ? defaultDoorToDoorAddress : null,
        pmBusNumber: pmMode === "Bus Stop" ? (String((hashString(`${dayKey}:pm-bus:${idx}`) % 3) + 1) as "1" | "2" | "3") : null,
        pmBusStop: pmMode === "Bus Stop" ? `Stop ${((hashString(`${dayKey}:pm-stop:${idx}`) % 6) + 1).toString()}` : null
      } as const;
    };

    const mondayTransport = buildDayTransport("monday", mondayEnabled);
    const tuesdayTransport = buildDayTransport("tuesday", tuesdayEnabled);
    const wednesdayTransport = buildDayTransport("wednesday", wednesdayEnabled);
    const thursdayTransport = buildDayTransport("thursday", thursdayEnabled);
    const fridayTransport = buildDayTransport("friday", fridayEnabled);
    const firstActiveMode =
      mondayTransport.amMode ??
      mondayTransport.pmMode ??
      tuesdayTransport.amMode ??
      tuesdayTransport.pmMode ??
      wednesdayTransport.amMode ??
      wednesdayTransport.pmMode ??
      thursdayTransport.amMode ??
      thursdayTransport.pmMode ??
      fridayTransport.amMode ??
      fridayTransport.pmMode;
    const firstBusNumber =
      mondayTransport.amBusNumber ??
      mondayTransport.pmBusNumber ??
      tuesdayTransport.amBusNumber ??
      tuesdayTransport.pmBusNumber ??
      wednesdayTransport.amBusNumber ??
      wednesdayTransport.pmBusNumber ??
      thursdayTransport.amBusNumber ??
      thursdayTransport.pmBusNumber ??
      fridayTransport.amBusNumber ??
      fridayTransport.pmBusNumber;
    const firstBusStop =
      mondayTransport.amBusStop ??
      mondayTransport.pmBusStop ??
      tuesdayTransport.amBusStop ??
      tuesdayTransport.pmBusStop ??
      wednesdayTransport.amBusStop ??
      wednesdayTransport.pmBusStop ??
      thursdayTransport.amBusStop ??
      thursdayTransport.pmBusStop ??
      fridayTransport.amBusStop ??
      fridayTransport.pmBusStop;

    return {
      id: uuidFromKey(`attendance:${member.id}`),
      member_id: member.id,
      enrollment_date: member.enrollment_date,
      monday: mondayEnabled,
      tuesday: tuesdayEnabled,
      wednesday: wednesdayEnabled,
      thursday: thursdayEnabled,
      friday: fridayEnabled,
      full_day: idx % 4 !== 0,
      transportation_required: transportationRequired,
      transportation_mode: firstActiveMode,
      transport_bus_number: firstActiveMode === "Bus Stop" ? firstBusNumber : null,
      transportation_bus_stop: firstActiveMode === "Bus Stop" ? firstBusStop : null,
      transport_monday_period: mondayTransport.amMode ? "AM" : mondayTransport.pmMode ? "PM" : null,
      transport_tuesday_period: tuesdayTransport.amMode ? "AM" : tuesdayTransport.pmMode ? "PM" : null,
      transport_wednesday_period: wednesdayTransport.amMode ? "AM" : wednesdayTransport.pmMode ? "PM" : null,
      transport_thursday_period: thursdayTransport.amMode ? "AM" : thursdayTransport.pmMode ? "PM" : null,
      transport_friday_period: fridayTransport.amMode ? "AM" : fridayTransport.pmMode ? "PM" : null,
      transport_monday_am_mode: mondayTransport.amMode,
      transport_monday_am_door_to_door_address: mondayTransport.amDoorToDoorAddress,
      transport_monday_am_bus_number: mondayTransport.amBusNumber,
      transport_monday_am_bus_stop: mondayTransport.amBusStop,
      transport_monday_pm_mode: mondayTransport.pmMode,
      transport_monday_pm_door_to_door_address: mondayTransport.pmDoorToDoorAddress,
      transport_monday_pm_bus_number: mondayTransport.pmBusNumber,
      transport_monday_pm_bus_stop: mondayTransport.pmBusStop,
      transport_tuesday_am_mode: tuesdayTransport.amMode,
      transport_tuesday_am_door_to_door_address: tuesdayTransport.amDoorToDoorAddress,
      transport_tuesday_am_bus_number: tuesdayTransport.amBusNumber,
      transport_tuesday_am_bus_stop: tuesdayTransport.amBusStop,
      transport_tuesday_pm_mode: tuesdayTransport.pmMode,
      transport_tuesday_pm_door_to_door_address: tuesdayTransport.pmDoorToDoorAddress,
      transport_tuesday_pm_bus_number: tuesdayTransport.pmBusNumber,
      transport_tuesday_pm_bus_stop: tuesdayTransport.pmBusStop,
      transport_wednesday_am_mode: wednesdayTransport.amMode,
      transport_wednesday_am_door_to_door_address: wednesdayTransport.amDoorToDoorAddress,
      transport_wednesday_am_bus_number: wednesdayTransport.amBusNumber,
      transport_wednesday_am_bus_stop: wednesdayTransport.amBusStop,
      transport_wednesday_pm_mode: wednesdayTransport.pmMode,
      transport_wednesday_pm_door_to_door_address: wednesdayTransport.pmDoorToDoorAddress,
      transport_wednesday_pm_bus_number: wednesdayTransport.pmBusNumber,
      transport_wednesday_pm_bus_stop: wednesdayTransport.pmBusStop,
      transport_thursday_am_mode: thursdayTransport.amMode,
      transport_thursday_am_door_to_door_address: thursdayTransport.amDoorToDoorAddress,
      transport_thursday_am_bus_number: thursdayTransport.amBusNumber,
      transport_thursday_am_bus_stop: thursdayTransport.amBusStop,
      transport_thursday_pm_mode: thursdayTransport.pmMode,
      transport_thursday_pm_door_to_door_address: thursdayTransport.pmDoorToDoorAddress,
      transport_thursday_pm_bus_number: thursdayTransport.pmBusNumber,
      transport_thursday_pm_bus_stop: thursdayTransport.pmBusStop,
      transport_friday_am_mode: fridayTransport.amMode,
      transport_friday_am_door_to_door_address: fridayTransport.amDoorToDoorAddress,
      transport_friday_am_bus_number: fridayTransport.amBusNumber,
      transport_friday_am_bus_stop: fridayTransport.amBusStop,
      transport_friday_pm_mode: fridayTransport.pmMode,
      transport_friday_pm_door_to_door_address: fridayTransport.pmDoorToDoorAddress,
      transport_friday_pm_bus_number: fridayTransport.pmBusNumber,
      transport_friday_pm_bus_stop: fridayTransport.pmBusStop,
      daily_rate: defaultDailyRate,
      transportation_billing_status: "BillNormally",
      billing_rate_effective_date: member.enrollment_date ?? toEasternDate(),
      billing_notes: null,
      attendance_days_per_week: attendanceDaysPerWeek,
      default_daily_rate: defaultDailyRate,
      use_custom_daily_rate: false,
      custom_daily_rate: null,
      make_up_days_available: idx % 5 === 0 ? 2 : 0,
      attendance_notes: null,
      updated_by_user_id: coordinator.id,
      updated_by_name: coordinator.full_name,
      created_at: now,
      updated_at: now
    };
  });

  const memberContacts: MockMemberContact[] = members.flatMap((member, idx) => {
    const contactsForMember: MockMemberContact[] = [];
    const categories = [
      MEMBER_CONTACT_CATEGORY_OPTIONS[4],
      MEMBER_CONTACT_CATEGORY_OPTIONS[3],
      MEMBER_CONTACT_CATEGORY_OPTIONS[0]
    ];

    categories.forEach((category, contactIdx) => {
      if (contactIdx === 2 && idx % 2 !== 0) return;
      const name = createStablePseudonym(`contact:${member.id}:${contactIdx}`, "contact");
      contactsForMember.push({
        id: uuidFromKey(`contact:${member.id}:${contactIdx}`),
        member_id: member.id,
        contact_name: name,
        relationship_to_member: contactIdx === 0 ? "Daughter" : contactIdx === 1 ? "Son" : "Care Manager",
        category,
        category_other: null,
        email: `${slugify(name)}@example.org`,
        cellular_number: `803-555-${String(6000 + (idx * 3 + contactIdx)).slice(-4)}`,
        work_number: null,
        home_number: null,
        street_address: `${200 + idx} Oak Ave`,
        city: member.city ?? "Fort Mill",
        state: "SC",
        zip: `297${String((idx % 40) + 10).padStart(2, "0")}`,
        created_by_user_id: coordinator.id,
        created_by_name: coordinator.full_name,
        created_at: now,
        updated_at: now
      });
    });

    if (idx % 7 === 0) {
      contactsForMember.push({
        id: uuidFromKey(`contact:${member.id}:other`),
        member_id: member.id,
        contact_name: createStablePseudonym(`contact:${member.id}:other`, "contact"),
        relationship_to_member: "Family Friend",
        category: "Other",
        category_other: "Neighbor Support",
        email: null,
        cellular_number: `803-555-${String(7000 + idx).slice(-4)}`,
        work_number: null,
        home_number: null,
        street_address: null,
        city: member.city ?? "Fort Mill",
        state: "SC",
        zip: null,
        created_by_user_id: coordinator.id,
        created_by_name: coordinator.full_name,
        created_at: now,
        updated_at: now
      });
    }

    return contactsForMember;
  });

  const memberFiles: MockMemberFile[] = members
    .slice(0, Math.max(30, Math.floor(members.length * 0.7)))
    .map((member, idx) => {
      const category = pickByIndex(MEMBER_FILE_CATEGORY_OPTIONS.slice(0, 7), idx);
      const uploadedAt = toEasternISO(new Date(Date.now() - (idx + 1) * DAY_MS));
      const fileName = `${member.display_name.replace(/\s+/g, "_")}_${category.replace(/[^a-zA-Z0-9]+/g, "_")}.txt`;
      return {
        id: uuidFromKey(`member-file:${member.id}:${idx}`),
        member_id: member.id,
        file_name: fileName,
        file_type: "text/plain",
        file_data_url: `data:text/plain;charset=utf-8,${encodeURIComponent(`Mock ${category} file for ${member.display_name}`)}`,
        category,
        category_other: null,
        uploaded_by_user_id: coordinator.id,
        uploaded_by_name: coordinator.full_name,
        uploaded_at: uploadedAt,
        updated_at: uploadedAt
      };
    });

  return {
    memberCommandCenters,
    memberAttendanceSchedules,
    memberContacts,
    memberFiles
  };
}

function buildLeadStageHistory(leads: MockLead[]): MockLeadStageHistory[] {
  return leads.map((lead, idx) => ({
    id: uuidFromKey(`lead-stage-history:${lead.id}:${idx}`),
    lead_id: lead.id,
    from_stage: null,
    to_stage: lead.stage,
    from_status: null,
    to_status: lead.status,
    changed_at: lead.created_at,
    changed_by_user_id: lead.created_by_user_id,
    changed_by_name: lead.created_by_name,
    reason: "Initial lead creation",
    source: "seed"
  }));
}

function buildAttendanceRecords(input: {
  members: MockMember[];
  schedules: MockMemberAttendanceSchedule[];
  staff: MockStaff[];
}): MockAttendanceRecord[] {
  const staffPool = input.staff.filter((row) => row.active);
  const fallbackStaff = staffPool[0] ?? input.staff[0];
  if (!fallbackStaff) return [];

  const schedulesByMember = new Map(input.schedules.map((row) => [row.member_id, row] as const));
  const records: MockAttendanceRecord[] = [];

  const operationalDaysBack = 70;
  for (let dayOffset = 0; dayOffset <= operationalDaysBack; dayOffset += 1) {
    const attendanceDate = dateDaysAgo(dayOffset);
    const weekday = getWeekdayForDate(attendanceDate);
    if (weekday === "saturday" || weekday === "sunday") {
      continue;
    }

    input.members.forEach((member, memberIndex) => {
      if (member.status !== "active") return;
      const schedule = schedulesByMember.get(member.id);
      if (!schedule || !isScheduledWeekday(schedule, weekday)) return;

      const roll = hashString(`attendance-record:${member.id}:${attendanceDate}`);
      const skipForPending = dayOffset === 0 && roll % 5 === 0;
      if (skipForPending) return;

      const status: "present" | "absent" = roll % 8 === 0 ? "absent" : "present";
      const recorder = pickByIndex(staffPool.length > 0 ? staffPool : [fallbackStaff], memberIndex + dayOffset);

      const checkInHour = 8 + (roll % 3);
      const checkOutHour = 14 + (roll % 4);
      const checkInMinute = roll % 50;
      const checkOutMinute = (roll + 17) % 50;
      const absentReason =
        status === "absent"
          ? pickByIndex(ATTENDANCE_ABSENCE_REASON_OPTIONS as unknown as string[], roll)
          : null;
      const absentReasonOther =
        status === "absent" && absentReason === "Other"
          ? "Family emergency"
          : null;

      records.push({
        id: uuidFromKey(`attendance-record:${member.id}:${attendanceDate}`),
        member_id: member.id,
        attendance_date: attendanceDate,
        status,
        absent_reason: absentReason,
        absent_reason_other: absentReasonOther,
        check_in_at: status === "present" ? isoAt(attendanceDate, checkInHour, checkInMinute) : null,
        check_out_at: status === "present" ? isoAt(attendanceDate, checkOutHour, checkOutMinute) : null,
        notes: status === "absent" && roll % 3 === 0 ? "Family notified center of planned absence." : null,
        recorded_by_user_id: recorder.id,
        recorded_by_name: recorder.full_name,
        created_at: isoAt(attendanceDate, 17, (roll + 23) % 60),
        updated_at: isoAt(attendanceDate, 17, (roll + 29) % 60)
      });
    });
  }

  return records.sort((left, right) => {
    if (left.attendance_date === right.attendance_date) {
      return left.recorded_by_name.localeCompare(right.recorded_by_name, undefined, { sensitivity: "base" });
    }
    return left.attendance_date > right.attendance_date ? -1 : 1;
  });
}

function buildMemberHolds(input: { members: MockMember[]; staff: MockStaff[] }): MockMemberHold[] {
  const actor =
    input.staff.find((row) => row.active && (row.role === "admin" || row.role === "manager")) ??
    input.staff.find((row) => row.active) ??
    input.staff[0];
  if (!actor) return [];

  const activeMembers = input.members.filter((member) => member.status === "active");
  const today = toEasternDate();
  const now = toEasternISO();
  const holds: MockMemberHold[] = [];

  if (activeMembers[0]) {
    holds.push({
      id: uuidFromKey(`member-hold:${activeMembers[0].id}:active`),
      member_id: activeMembers[0].id,
      start_date: addDays(today, -2),
      end_date: addDays(today, 5),
      status: "active",
      reason: "Medical Leave",
      reason_other: null,
      notes: "Seeded active hold for operations testing.",
      created_by_user_id: actor.id,
      created_by_name: actor.full_name,
      created_at: now,
      updated_at: now,
      ended_at: null,
      ended_by_user_id: null,
      ended_by_name: null
    });
  }

  if (activeMembers[1]) {
    const endedDate = addDays(today, -12);
    const endedAt = isoAt(endedDate, 17, 0);
    holds.push({
      id: uuidFromKey(`member-hold:${activeMembers[1].id}:ended`),
      member_id: activeMembers[1].id,
      start_date: addDays(today, -20),
      end_date: endedDate,
      status: "ended",
      reason: "Vacation",
      reason_other: null,
      notes: "Seeded historical hold for audit/report testing.",
      created_by_user_id: actor.id,
      created_by_name: actor.full_name,
      created_at: isoAt(addDays(today, -20), 9, 10),
      updated_at: endedAt,
      ended_at: endedAt,
      ended_by_user_id: actor.id,
      ended_by_name: actor.full_name
    });
  }

  if (activeMembers[2]) {
    holds.push({
      id: uuidFromKey(`member-hold:${activeMembers[2].id}:upcoming`),
      member_id: activeMembers[2].id,
      start_date: addDays(today, 3),
      end_date: addDays(today, 7),
      status: "active",
      reason: "Family Request",
      reason_other: null,
      notes: "Seeded upcoming hold to validate future-date logic.",
      created_by_user_id: actor.id,
      created_by_name: actor.full_name,
      created_at: now,
      updated_at: now,
      ended_at: null,
      ended_by_user_id: null,
      ended_by_name: null
    });
  }

  return holds;
}

function buildBillingFoundation(input: {
  members: MockMember[];
  staff: MockStaff[];
  schedules: MockMemberAttendanceSchedule[];
  nowIso: string;
}) {
  const today = toEasternDate();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const actor =
    input.staff.find((row) => row.active && (row.role === "coordinator" || row.role === "admin" || row.role === "manager")) ??
    input.staff.find((row) => row.active) ??
    input.staff[0];
  const actorId = actor?.id ?? "system";
  const actorName = actor?.full_name ?? "System Seed";
  const scheduleByMemberId = new Map(input.schedules.map((row) => [row.member_id, row] as const));

  const scheduledDaysPerWeek = (memberId: string) => {
    const schedule = scheduleByMemberId.get(memberId);
    if (!schedule) return 0;
    const weekdays = [schedule.monday, schedule.tuesday, schedule.wednesday, schedule.thursday, schedule.friday];
    return weekdays.filter(Boolean).length;
  };

  const centerBillingSettings: MockCenterBillingSetting[] = [
    {
      id: uuidFromKey("center-billing-setting:default"),
      default_daily_rate: 180,
      default_extra_day_rate: 180,
      default_transport_one_way_rate: 10,
      default_transport_round_trip_rate: 20,
      billing_cutoff_day: 25,
      default_billing_mode: "Membership",
      effective_start_date: yearStart,
      effective_end_date: null,
      active: true,
      created_at: input.nowIso,
      updated_at: input.nowIso,
      updated_by_user_id: actorId,
      updated_by_name: actorName
    }
  ];

  const centerClosures: MockCenterClosure[] = [
    {
      id: uuidFromKey(`center-closure:${yearStart.slice(0, 4)}-01-01`),
      closure_date: `${yearStart.slice(0, 4)}-01-01`,
      closure_name: "New Year's Day",
      closure_type: "Holiday",
      billable_override: false,
      notes: null,
      active: true,
      created_at: input.nowIso,
      updated_at: input.nowIso,
      updated_by_user_id: actorId,
      updated_by_name: actorName
    },
    {
      id: uuidFromKey(`center-closure:${yearStart.slice(0, 4)}-11-27`),
      closure_date: `${yearStart.slice(0, 4)}-11-27`,
      closure_name: "Thanksgiving Closure",
      closure_type: "Holiday",
      billable_override: false,
      notes: null,
      active: true,
      created_at: input.nowIso,
      updated_at: input.nowIso,
      updated_by_user_id: actorId,
      updated_by_name: actorName
    },
    {
      id: uuidFromKey(`center-closure:${yearStart.slice(0, 4)}-12-25`),
      closure_date: `${yearStart.slice(0, 4)}-12-25`,
      closure_name: "Christmas Day",
      closure_type: "Holiday",
      billable_override: false,
      notes: null,
      active: true,
      created_at: input.nowIso,
      updated_at: input.nowIso,
      updated_by_user_id: actorId,
      updated_by_name: actorName
    }
  ];

  const payors: MockPayor[] = input.members
    .filter((member) => member.status === "active")
    .map((member, idx) => {
      const slug = slugify(member.display_name).replace(/\./g, "");
      return {
        id: uuidFromKey(`payor:${member.id}`),
        payor_name: `${member.display_name} Family`,
        payor_type: "Private",
        billing_contact_name: member.display_name,
        billing_email: `${slug || `member${idx + 1}`}@example.com`,
        billing_phone: "803-555-0100",
        billing_method: idx % 8 === 0 ? "Manual" : "InvoiceEmail",
        auto_draft_enabled: false,
        quickbooks_customer_name: null,
        quickbooks_customer_ref: null,
        status: "active",
        notes: null,
        created_at: input.nowIso,
        updated_at: input.nowIso,
        updated_by_user_id: actorId,
        updated_by_name: actorName
      } satisfies MockPayor;
    });

  const payorByName = new Map(payors.map((row) => [row.payor_name, row.id] as const));

  const memberBillingSettings: MockMemberBillingSetting[] = input.members
    .filter((member) => member.status === "active")
    .map((member) => {
      const seed = hashString(`member-billing:${member.id}`);
      const daysPerWeek = scheduledDaysPerWeek(member.id);
      const tierRate = getStandardDailyRateForAttendanceDays(daysPerWeek);
      const usesCenterDefaultRate = tierRate === 180;
      const transportMode =
        seed % 10 === 0 ? "Waived" : seed % 10 === 1 ? "IncludedInProgramRate" : "BillNormally";
      const payorId =
        payors.find((row) => row.payor_name.startsWith(member.display_name))?.id ??
        payorByName.get(`${member.display_name} Family`) ??
        null;

      return {
        id: uuidFromKey(`member-billing-setting:${member.id}`),
        member_id: member.id,
        payor_id: payorId,
        use_center_default_billing_mode: true,
        billing_mode: null,
        monthly_billing_basis: seed % 5 === 0 ? "ActualAttendanceMonthBehind" : "ScheduledMonthBehind",
        use_center_default_rate: usesCenterDefaultRate,
        custom_daily_rate: usesCenterDefaultRate ? null : tierRate,
        flat_monthly_rate: null,
        bill_extra_days: seed % 7 !== 0,
        transportation_billing_status: transportMode,
        bill_ancillary_arrears: seed % 11 !== 0,
        active: true,
        effective_start_date: yearStart,
        effective_end_date: null,
        billing_notes:
          daysPerWeek <= 0
            ? "Seeded default tier due to missing weekly schedule."
            : `Seeded pricing tier: ${daysPerWeek} day(s)/week -> $${tierRate}/day.`,
        created_at: input.nowIso,
        updated_at: input.nowIso,
        updated_by_user_id: actorId,
        updated_by_name: actorName
      } satisfies MockMemberBillingSetting;
    });

  const billingScheduleTemplates: MockBillingScheduleTemplate[] = input.members
    .filter((member) => member.status === "active")
    .map((member) => {
      const schedule = scheduleByMemberId.get(member.id);
      return {
        id: uuidFromKey(`billing-schedule-template:${member.id}`),
        member_id: member.id,
        effective_start_date: schedule?.enrollment_date ?? yearStart,
        effective_end_date: null,
        monday: schedule?.monday ?? false,
        tuesday: schedule?.tuesday ?? false,
        wednesday: schedule?.wednesday ?? false,
        thursday: schedule?.thursday ?? false,
        friday: schedule?.friday ?? false,
        saturday: false,
        sunday: false,
        active: true,
        notes: null,
        created_at: input.nowIso,
        updated_at: input.nowIso,
        updated_by_user_id: actorId,
        updated_by_name: actorName
      } satisfies MockBillingScheduleTemplate;
    });

  const billingAdjustments: MockBillingAdjustment[] = [];
  const billingBatches: MockBillingBatch[] = [];
  const billingInvoices: MockBillingInvoice[] = [];
  const billingInvoiceLines: MockBillingInvoiceLine[] = [];
  const billingExportJobs: MockBillingExportJob[] = [];
  const billingCoverages: MockBillingCoverage[] = [];

  return {
    centerBillingSettings,
    centerClosures,
    payors,
    memberBillingSettings,
    billingScheduleTemplates,
    billingAdjustments,
    billingBatches,
    billingInvoices,
    billingInvoiceLines,
    billingExportJobs,
    billingCoverages
  };
}

function buildAuditLogs(): MockAuditLog[] {
  return [];
}

export function buildSeededMockDb(): MockDb {
  const nowIso = toEasternISO();
  const staff = buildStaff();
  const members = buildMembers();
  const ancillaryCategories = buildAncillaryCategories();

  const operational = buildOperational(staff, members, ancillaryCategories);
  const sales = buildSales(staff);
  const assessments = buildAssessments(staff, members);
  const assessmentResponses = buildAssessmentResponses(assessments);
  const timePunches = buildTimePunches(staff);
  const leadStageHistory = buildLeadStageHistory(sales.leads);
  const auditLogs = buildAuditLogs();
  const memberHealthArtifacts = buildMemberHealthArtifacts(members, assessments, staff);
  const memberCommandCenterArtifacts = buildMemberCommandCenterArtifacts(members, assessments, staff);
  const attendanceRecords = buildAttendanceRecords({
    members,
    schedules: memberCommandCenterArtifacts.memberAttendanceSchedules,
    staff
  });
  const memberHolds = buildMemberHolds({
    members,
    staff
  });
  const billingFoundation = buildBillingFoundation({
    members,
    staff,
    schedules: memberCommandCenterArtifacts.memberAttendanceSchedules,
    nowIso
  });
  const busStopDirectory: MockBusStopDirectory[] = Array.from(
    new Set(
      memberCommandCenterArtifacts.memberAttendanceSchedules
        .flatMap((schedule) => [
          schedule.transport_monday_am_bus_stop,
          schedule.transport_monday_pm_bus_stop,
          schedule.transport_tuesday_am_bus_stop,
          schedule.transport_tuesday_pm_bus_stop,
          schedule.transport_wednesday_am_bus_stop,
          schedule.transport_wednesday_pm_bus_stop,
          schedule.transport_thursday_am_bus_stop,
          schedule.transport_thursday_pm_bus_stop,
          schedule.transport_friday_am_bus_stop,
          schedule.transport_friday_pm_bus_stop
        ])
        .map((value) => (value ?? "").trim())
        .filter((value) => value.length > 0)
    )
  )
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((busStopName) => ({
      id: uuidFromKey(`bus-stop-directory:${busStopName.toLowerCase()}`),
      bus_stop_name: busStopName,
      created_by_user_id: "system",
      created_by_name: "System Seed",
      created_at: nowIso,
      updated_at: nowIso
    }));

  const latestAssessmentByMember = new Map<string, MockAssessment>();
  assessments.forEach((assessment) => {
    const current = latestAssessmentByMember.get(assessment.member_id);
    if (!current || current.assessment_date < assessment.assessment_date) {
      latestAssessmentByMember.set(assessment.member_id, assessment);
    }
  });

  const membersWithAssessmentSummary = members.map((member) => {
    const latest = latestAssessmentByMember.get(member.id);
    if (!latest) return member;

    return {
      ...member,
      allergies: latest.allergies || null,
      code_status: latest.code_status || null,
      orientation_dob_verified: latest.orientation_dob_verified,
      orientation_city_verified: latest.orientation_city_verified,
      orientation_year_verified: latest.orientation_year_verified,
      orientation_occupation_verified: latest.orientation_occupation_verified,
      medication_management_status: latest.medication_management_status || null,
      dressing_support_status: latest.dressing_support_status || null,
      assistive_devices: latest.assistive_devices || null,
      incontinence_products: latest.incontinence_products || null,
      on_site_medication_use: latest.on_site_medication_use || null,
      on_site_medication_list: latest.on_site_medication_list || null,
      diet_type: latest.diet_type || null,
      diet_restrictions_notes: latest.diet_restrictions_notes || null,
      mobility_status: latest.mobility_steadiness || null,
      mobility_aids: latest.mobility_aids || null,
      social_triggers: latest.social_triggers || null,
      joy_sparks: latest.joy_sparks || null,
      personal_notes: latest.personal_notes || null,
      transport_can_enter_exit_vehicle: latest.transport_can_enter_exit_vehicle || null,
      transport_assistance_level: latest.transport_assistance_level || null,
      transport_mobility_aid: latest.transport_mobility_aid || null,
      transport_can_remain_seated_buckled: latest.transport_can_remain_seated_buckled,
      transport_behavior_concern: latest.transport_behavior_concern || null,
      transport_appropriate: latest.transport_appropriate,
      latest_assessment_id: latest.id,
      latest_assessment_date: latest.assessment_date,
      latest_assessment_score: latest.total_score,
      latest_assessment_track: latest.recommended_track,
      latest_assessment_admission_review_required: latest.admission_review_required
    } as MockMember;
  });
  const membersWithSeededTracks = seedBalancedTracksForActiveMembers(membersWithAssessmentSummary);

  return {
    staff,
    members: membersWithSeededTracks,
    memberCommandCenters: memberCommandCenterArtifacts.memberCommandCenters,
    memberAttendanceSchedules: memberCommandCenterArtifacts.memberAttendanceSchedules,
    memberHolds,
    attendanceRecords,
    transportationManifestAdjustments: [],
    memberContacts: memberCommandCenterArtifacts.memberContacts,
    memberFiles: memberCommandCenterArtifacts.memberFiles,
    timePunches,
    dailyActivities: operational.dailyActivities,
    toiletLogs: operational.toiletLogs,
    showerLogs: operational.showerLogs,
    transportationLogs: operational.transportationLogs,
    photoUploads: operational.photoUploads,
    bloodSugarLogs: operational.bloodSugarLogs,
    ancillaryCategories,
    ancillaryLogs: operational.ancillaryLogs,
    centerBillingSettings: billingFoundation.centerBillingSettings,
    centerClosures: billingFoundation.centerClosures,
    payors: billingFoundation.payors,
    memberBillingSettings: billingFoundation.memberBillingSettings,
    billingScheduleTemplates: billingFoundation.billingScheduleTemplates,
    billingAdjustments: billingFoundation.billingAdjustments,
    billingBatches: billingFoundation.billingBatches,
    billingInvoices: billingFoundation.billingInvoices,
    billingInvoiceLines: billingFoundation.billingInvoiceLines,
    billingExportJobs: billingFoundation.billingExportJobs,
    billingCoverages: billingFoundation.billingCoverages,
    leads: sales.leads,
    leadActivities: sales.leadActivities,
    partners: sales.partners,
    referralSources: sales.referralSources,
    partnerActivities: sales.partnerActivities,
    leadStageHistory,
    auditLogs,
    assessments,
    assessmentResponses,
    memberHealthProfiles: memberHealthArtifacts.memberHealthProfiles,
    memberDiagnoses: memberHealthArtifacts.memberDiagnoses,
    memberMedications: memberHealthArtifacts.memberMedications,
    memberAllergies: memberHealthArtifacts.memberAllergies,
    memberProviders: memberHealthArtifacts.memberProviders,
    providerDirectory: memberHealthArtifacts.providerDirectory,
    hospitalPreferenceDirectory: memberHealthArtifacts.hospitalPreferenceDirectory,
    busStopDirectory,
    memberEquipment: memberHealthArtifacts.memberEquipment,
    memberNotes: memberHealthArtifacts.memberNotes
  };
}


