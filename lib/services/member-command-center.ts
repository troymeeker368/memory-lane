import { addMockRecord, getMemberMakeupDayBalance, getMockDb, listMemberMakeupLedger, updateMockRecord } from "@/lib/mock-repo";
import { getCarePlansForMember, getMemberCarePlanSummary } from "@/lib/services/care-plans";
import { isMockMode } from "@/lib/runtime";
import { toEasternISO } from "@/lib/timezone";

function trimOrNull(value?: string | null) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function coalesceIfEmpty(current: string | null | undefined, next: string | null | undefined) {
  if (trimOrNull(current)) return trimOrNull(current);
  return trimOrNull(next);
}

function formatMailingAddress(input: {
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}) {
  const parts = [input.street_address, input.city, input.state, input.zip]
    .map((value) => trimOrNull(value))
    .filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(", ") : null;
}

function sortByLastName(a: string, b: string) {
  const toKey = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return fullName.toLowerCase();
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(" ");
    return `${last}, ${first}`.toLowerCase();
  };

  return toKey(a).localeCompare(toKey(b));
}

function normalizeLocker(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) {
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  }
  return cleaned.toUpperCase();
}

function sortLockerValues(a: string, b: string) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum) && /^\d+$/.test(a);
  const bIsNum = Number.isFinite(bNum) && /^\d+$/.test(b);
  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function getAvailableLockerNumbersForMember(memberId: string) {
  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId) ?? null;
  const currentLocker = normalizeLocker(member?.locker_number ?? null);
  const usedByOtherActive = new Set(
    db.members
      .filter((row) => row.status === "active" && row.id !== memberId)
      .map((row) => normalizeLocker(row.locker_number))
      .filter((value): value is string => Boolean(value))
  );

  const pool = new Set<string>();
  for (let locker = 1; locker <= 72; locker += 1) {
    pool.add(String(locker));
  }
  db.members.forEach((row) => {
    const locker = normalizeLocker(row.locker_number);
    if (locker) pool.add(locker);
  });
  if (currentLocker) pool.add(currentLocker);

  return [...pool]
    .filter((locker) => !usedByOtherActive.has(locker) || locker === currentLocker)
    .sort(sortLockerValues);
}

export function calculateAgeYears(dob: string | null) {
  if (!dob) return null;
  const parsedDob = new Date(`${dob}T00:00:00.000`);
  if (Number.isNaN(parsedDob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - parsedDob.getFullYear();
  const monthDelta = now.getMonth() - parsedDob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsedDob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function calculateMonthsEnrolled(enrollmentDate: string | null) {
  if (!enrollmentDate) return null;
  const parsed = new Date(`${enrollmentDate}T00:00:00.000`);
  if (Number.isNaN(parsed.getTime())) return null;

  const now = new Date();
  let months = (now.getFullYear() - parsed.getFullYear()) * 12 + (now.getMonth() - parsed.getMonth());
  if (now.getDate() < parsed.getDate()) {
    months -= 1;
  }

  return months >= 0 ? months : 0;
}

function defaultCommandCenter(memberId: string) {
  const now = toEasternISO();
  return {
    id: "",
    member_id: memberId,
    gender: null,
    payor: null,
    original_referral_source: null,
    photo_consent: null,
    profile_image_url: null,
    location: null,

    street_address: null,
    city: null,
    state: null,
    zip: null,
    marital_status: null,
    primary_language: "English",
    secondary_language: null,
    religion: null,
    ethnicity: null,
    is_veteran: null,
    veteran_branch: null,

    code_status: null,
    dnr: null,
    dni: null,
    polst_molst_colst: null,
    hospice: null,
    advanced_directives_obtained: null,
    power_of_attorney: null,
    funeral_home: null,
    legal_comments: null,

    diet_type: "Regular",
    dietary_preferences_restrictions: null,
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
}

function defaultAttendanceSchedule(member: { id: string; enrollment_date: string | null }) {
  const now = toEasternISO();
  return {
    id: "",
    member_id: member.id,
    enrollment_date: member.enrollment_date,
    monday: true,
    tuesday: false,
    wednesday: true,
    thursday: false,
    friday: true,
    full_day: true,
    transportation_required: null,
    transportation_mode: null,
    transport_bus_number: null,
    transportation_bus_stop: null,
    transport_monday_period: null,
    transport_tuesday_period: null,
    transport_wednesday_period: null,
    transport_thursday_period: null,
    transport_friday_period: null,
    transport_monday_am_mode: null,
    transport_monday_am_door_to_door_address: null,
    transport_monday_am_bus_number: null,
    transport_monday_am_bus_stop: null,
    transport_monday_pm_mode: null,
    transport_monday_pm_door_to_door_address: null,
    transport_monday_pm_bus_number: null,
    transport_monday_pm_bus_stop: null,
    transport_tuesday_am_mode: null,
    transport_tuesday_am_door_to_door_address: null,
    transport_tuesday_am_bus_number: null,
    transport_tuesday_am_bus_stop: null,
    transport_tuesday_pm_mode: null,
    transport_tuesday_pm_door_to_door_address: null,
    transport_tuesday_pm_bus_number: null,
    transport_tuesday_pm_bus_stop: null,
    transport_wednesday_am_mode: null,
    transport_wednesday_am_door_to_door_address: null,
    transport_wednesday_am_bus_number: null,
    transport_wednesday_am_bus_stop: null,
    transport_wednesday_pm_mode: null,
    transport_wednesday_pm_door_to_door_address: null,
    transport_wednesday_pm_bus_number: null,
    transport_wednesday_pm_bus_stop: null,
    transport_thursday_am_mode: null,
    transport_thursday_am_door_to_door_address: null,
    transport_thursday_am_bus_number: null,
    transport_thursday_am_bus_stop: null,
    transport_thursday_pm_mode: null,
    transport_thursday_pm_door_to_door_address: null,
    transport_thursday_pm_bus_number: null,
    transport_thursday_pm_bus_stop: null,
    transport_friday_am_mode: null,
    transport_friday_am_door_to_door_address: null,
    transport_friday_am_bus_number: null,
    transport_friday_am_bus_stop: null,
    transport_friday_pm_mode: null,
    transport_friday_pm_door_to_door_address: null,
    transport_friday_pm_bus_number: null,
    transport_friday_pm_bus_stop: null,
    make_up_days_available: 0,
    attendance_notes: null,
    updated_by_user_id: null,
    updated_by_name: null,
    created_at: now,
    updated_at: now
  };
}

export function ensureMemberCommandCenterProfile(memberId: string) {
  const db = getMockDb();
  const existing = db.memberCommandCenters.find((row) => row.member_id === memberId);
  if (existing) return existing;

  return addMockRecord("memberCommandCenters", {
    ...defaultCommandCenter(memberId),
    member_id: memberId
  });
}

export function ensureMemberAttendanceSchedule(memberId: string) {
  const db = getMockDb();
  const existing = db.memberAttendanceSchedules.find((row) => row.member_id === memberId);
  if (existing) return existing;

  const member = db.members.find((row) => row.id === memberId);
  if (!member) return null;

  return addMockRecord("memberAttendanceSchedules", {
    ...defaultAttendanceSchedule(member),
    member_id: memberId,
    enrollment_date: member.enrollment_date
  });
}

export function getMemberCommandCenterIndex(filters?: { q?: string; status?: "all" | "active" | "inactive" }) {
  if (!isMockMode()) {
    // TODO(backend): Replace with operations-member command center materialized view query.
    return [];
  }

  const db = getMockDb();
  const query = (filters?.q ?? "").trim().toLowerCase();
  const status = filters?.status ?? "all";

  return db.members
    .filter((member) => (status === "all" ? true : member.status === status))
    .filter((member) =>
      query
        ? member.display_name.toLowerCase().includes(query) ||
          String(member.locker_number ?? "").toLowerCase().includes(query)
        : true
    )
    .map((member) => {
      const profile = db.memberCommandCenters.find((row) => row.member_id === member.id) ?? defaultCommandCenter(member.id);
      const schedule = db.memberAttendanceSchedules.find((row) => row.member_id === member.id) ?? defaultAttendanceSchedule(member);
      const makeupBalance = getMemberMakeupDayBalance(member.id);
      const mhpPhoto = db.memberHealthProfiles.find((row) => row.member_id === member.id)?.profile_image_url ?? null;
      return {
        member,
        profile: {
          ...profile,
          profile_image_url: profile.profile_image_url ?? mhpPhoto
        },
        schedule: {
          ...schedule,
          make_up_days_available: makeupBalance
        },
        makeupBalance,
        age: calculateAgeYears(member.dob),
        monthsEnrolled: calculateMonthsEnrolled(schedule.enrollment_date ?? member.enrollment_date)
      };
    })
    .sort((a, b) => sortByLastName(a.member.display_name, b.member.display_name));
}

export function getMemberCommandCenterDetail(memberId: string) {
  if (!isMockMode()) {
    // TODO(backend): Replace with joined operations member detail query set.
    return null;
  }

  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId);
  if (!member) return null;

  const profile = ensureMemberCommandCenterProfile(memberId);
  const schedule = ensureMemberAttendanceSchedule(memberId);
  const makeupBalance = getMemberMakeupDayBalance(memberId);
  const makeupLedger = listMemberMakeupLedger(memberId);
  const scheduleWithBalance = schedule
    ? {
        ...schedule,
        make_up_days_available: makeupBalance
      }
    : schedule;
  const contacts = [...db.memberContacts]
    .filter((row) => row.member_id === memberId)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  const files = [...db.memberFiles]
    .filter((row) => row.member_id === memberId)
    .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));
  const busStopDirectory = [...db.busStopDirectory]
    .filter((row) => (row.bus_stop_name ?? "").trim().length > 0)
    .sort((a, b) => a.bus_stop_name.localeCompare(b.bus_stop_name, undefined, { sensitivity: "base" }));
  const mhpAllergies = [...db.memberAllergies]
    .filter((row) => row.member_id === memberId)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  const mhp = db.memberHealthProfiles.find((row) => row.member_id === memberId) ?? null;
  const effectiveProfileImage = profile.profile_image_url ?? mhp?.profile_image_url ?? null;

  const assessments = db.assessments.filter((row) => row.member_id === memberId);
  const carePlans = getCarePlansForMember(memberId);
  const carePlanSummary = getMemberCarePlanSummary(memberId);

  return {
    member,
    profile: {
      ...profile,
      profile_image_url: effectiveProfileImage
    },
    schedule: scheduleWithBalance,
    contacts,
    files,
    busStopDirectory,
    mhpAllergies,
    makeupBalance,
    makeupLedger,
    assessmentsCount: assessments.length,
    carePlansCount: carePlans.length,
    carePlanSummary,
    age: calculateAgeYears(member.dob),
    monthsEnrolled: calculateMonthsEnrolled(schedule?.enrollment_date ?? member.enrollment_date)
  };
}

export function prefillMemberCommandCenterFromAssessment(input: {
  memberId: string;
  assessment: {
    id: string;
    assessment_date: string;
    allergies: string;
    code_status: string;
    orientation_city_verified: boolean;
    diet_type: string;
    diet_restrictions_notes: string;
    joy_sparks: string;
    personal_notes: string;
    transport_appropriate: boolean;
  };
  actor: { id: string; fullName: string };
}) {
  const db = getMockDb();
  const member = db.members.find((row) => row.id === input.memberId);
  if (!member) return null;

  const profile = ensureMemberCommandCenterProfile(input.memberId);
  const schedule = ensureMemberAttendanceSchedule(input.memberId);
  const now = toEasternISO();

  const allergiesValue = trimOrNull(input.assessment.allergies);
  const isNka = allergiesValue?.toUpperCase() === "NKA";

  const profilePatch = {
    code_status: profile.code_status ?? trimOrNull(input.assessment.code_status),
    dnr: profile.dnr ?? ((profile.code_status ?? input.assessment.code_status) === "DNR"),
    city: coalesceIfEmpty(profile.city, input.assessment.orientation_city_verified ? member.city : null),
    diet_type: coalesceIfEmpty(profile.diet_type, input.assessment.diet_type),
    dietary_preferences_restrictions: coalesceIfEmpty(
      profile.dietary_preferences_restrictions,
      input.assessment.diet_restrictions_notes
    ),
    no_known_allergies:
      profile.no_known_allergies == null ? (isNka ? true : profile.no_known_allergies) : profile.no_known_allergies,
    medication_allergies:
      profile.medication_allergies ?? (isNka ? null : (allergiesValue ?? null)),
    command_center_notes:
      profile.command_center_notes ?? trimOrNull([input.assessment.joy_sparks, input.assessment.personal_notes].filter(Boolean).join(" | ")),
    source_assessment_id: input.assessment.id,
    source_assessment_at: input.assessment.assessment_date,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName,
    updated_at: now
  };

  updateMockRecord("memberCommandCenters", profile.id, profilePatch);

  if (schedule) {
    const shouldEnableTransportation = Boolean(input.assessment.transport_appropriate);
    const defaultMode = shouldEnableTransportation ? "Door to Door" : null;
    const defaultDoorToDoorAddress = formatMailingAddress(profile);
    const fallbackMode = (current: "Door to Door" | "Bus Stop" | null, dayEnabled: boolean) =>
      shouldEnableTransportation && dayEnabled ? (current ?? defaultMode) : null;

    updateMockRecord("memberAttendanceSchedules", schedule.id, {
      transportation_required:
        schedule.transportation_required == null ? shouldEnableTransportation : schedule.transportation_required,
      transportation_mode:
        schedule.transportation_mode ?? defaultMode,
      transport_bus_number:
        shouldEnableTransportation ? schedule.transport_bus_number : null,
      transportation_bus_stop:
        shouldEnableTransportation ? schedule.transportation_bus_stop : null,
      transport_monday_period:
        shouldEnableTransportation ? schedule.transport_monday_period : null,
      transport_tuesday_period:
        shouldEnableTransportation ? schedule.transport_tuesday_period : null,
      transport_wednesday_period:
        shouldEnableTransportation ? schedule.transport_wednesday_period : null,
      transport_thursday_period:
        shouldEnableTransportation ? schedule.transport_thursday_period : null,
      transport_friday_period:
        shouldEnableTransportation ? schedule.transport_friday_period : null,
      transport_monday_am_mode: fallbackMode(schedule.transport_monday_am_mode, schedule.monday),
      transport_monday_am_door_to_door_address:
        fallbackMode(schedule.transport_monday_am_mode, schedule.monday) === "Door to Door"
          ? (schedule.transport_monday_am_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_monday_am_bus_number:
        fallbackMode(schedule.transport_monday_am_mode, schedule.monday) === "Bus Stop"
          ? schedule.transport_monday_am_bus_number
          : null,
      transport_monday_am_bus_stop:
        fallbackMode(schedule.transport_monday_am_mode, schedule.monday) === "Bus Stop"
          ? schedule.transport_monday_am_bus_stop
          : null,
      transport_monday_pm_mode: fallbackMode(schedule.transport_monday_pm_mode, schedule.monday),
      transport_monday_pm_door_to_door_address:
        fallbackMode(schedule.transport_monday_pm_mode, schedule.monday) === "Door to Door"
          ? (schedule.transport_monday_pm_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_monday_pm_bus_number:
        fallbackMode(schedule.transport_monday_pm_mode, schedule.monday) === "Bus Stop"
          ? schedule.transport_monday_pm_bus_number
          : null,
      transport_monday_pm_bus_stop:
        fallbackMode(schedule.transport_monday_pm_mode, schedule.monday) === "Bus Stop"
          ? schedule.transport_monday_pm_bus_stop
          : null,
      transport_tuesday_am_mode: fallbackMode(schedule.transport_tuesday_am_mode, schedule.tuesday),
      transport_tuesday_am_door_to_door_address:
        fallbackMode(schedule.transport_tuesday_am_mode, schedule.tuesday) === "Door to Door"
          ? (schedule.transport_tuesday_am_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_tuesday_am_bus_number:
        fallbackMode(schedule.transport_tuesday_am_mode, schedule.tuesday) === "Bus Stop"
          ? schedule.transport_tuesday_am_bus_number
          : null,
      transport_tuesday_am_bus_stop:
        fallbackMode(schedule.transport_tuesday_am_mode, schedule.tuesday) === "Bus Stop"
          ? schedule.transport_tuesday_am_bus_stop
          : null,
      transport_tuesday_pm_mode: fallbackMode(schedule.transport_tuesday_pm_mode, schedule.tuesday),
      transport_tuesday_pm_door_to_door_address:
        fallbackMode(schedule.transport_tuesday_pm_mode, schedule.tuesday) === "Door to Door"
          ? (schedule.transport_tuesday_pm_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_tuesday_pm_bus_number:
        fallbackMode(schedule.transport_tuesday_pm_mode, schedule.tuesday) === "Bus Stop"
          ? schedule.transport_tuesday_pm_bus_number
          : null,
      transport_tuesday_pm_bus_stop:
        fallbackMode(schedule.transport_tuesday_pm_mode, schedule.tuesday) === "Bus Stop"
          ? schedule.transport_tuesday_pm_bus_stop
          : null,
      transport_wednesday_am_mode: fallbackMode(schedule.transport_wednesday_am_mode, schedule.wednesday),
      transport_wednesday_am_door_to_door_address:
        fallbackMode(schedule.transport_wednesday_am_mode, schedule.wednesday) === "Door to Door"
          ? (schedule.transport_wednesday_am_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_wednesday_am_bus_number:
        fallbackMode(schedule.transport_wednesday_am_mode, schedule.wednesday) === "Bus Stop"
          ? schedule.transport_wednesday_am_bus_number
          : null,
      transport_wednesday_am_bus_stop:
        fallbackMode(schedule.transport_wednesday_am_mode, schedule.wednesday) === "Bus Stop"
          ? schedule.transport_wednesday_am_bus_stop
          : null,
      transport_wednesday_pm_mode: fallbackMode(schedule.transport_wednesday_pm_mode, schedule.wednesday),
      transport_wednesday_pm_door_to_door_address:
        fallbackMode(schedule.transport_wednesday_pm_mode, schedule.wednesday) === "Door to Door"
          ? (schedule.transport_wednesday_pm_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_wednesday_pm_bus_number:
        fallbackMode(schedule.transport_wednesday_pm_mode, schedule.wednesday) === "Bus Stop"
          ? schedule.transport_wednesday_pm_bus_number
          : null,
      transport_wednesday_pm_bus_stop:
        fallbackMode(schedule.transport_wednesday_pm_mode, schedule.wednesday) === "Bus Stop"
          ? schedule.transport_wednesday_pm_bus_stop
          : null,
      transport_thursday_am_mode: fallbackMode(schedule.transport_thursday_am_mode, schedule.thursday),
      transport_thursday_am_door_to_door_address:
        fallbackMode(schedule.transport_thursday_am_mode, schedule.thursday) === "Door to Door"
          ? (schedule.transport_thursday_am_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_thursday_am_bus_number:
        fallbackMode(schedule.transport_thursday_am_mode, schedule.thursday) === "Bus Stop"
          ? schedule.transport_thursday_am_bus_number
          : null,
      transport_thursday_am_bus_stop:
        fallbackMode(schedule.transport_thursday_am_mode, schedule.thursday) === "Bus Stop"
          ? schedule.transport_thursday_am_bus_stop
          : null,
      transport_thursday_pm_mode: fallbackMode(schedule.transport_thursday_pm_mode, schedule.thursday),
      transport_thursday_pm_door_to_door_address:
        fallbackMode(schedule.transport_thursday_pm_mode, schedule.thursday) === "Door to Door"
          ? (schedule.transport_thursday_pm_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_thursday_pm_bus_number:
        fallbackMode(schedule.transport_thursday_pm_mode, schedule.thursday) === "Bus Stop"
          ? schedule.transport_thursday_pm_bus_number
          : null,
      transport_thursday_pm_bus_stop:
        fallbackMode(schedule.transport_thursday_pm_mode, schedule.thursday) === "Bus Stop"
          ? schedule.transport_thursday_pm_bus_stop
          : null,
      transport_friday_am_mode: fallbackMode(schedule.transport_friday_am_mode, schedule.friday),
      transport_friday_am_door_to_door_address:
        fallbackMode(schedule.transport_friday_am_mode, schedule.friday) === "Door to Door"
          ? (schedule.transport_friday_am_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_friday_am_bus_number:
        fallbackMode(schedule.transport_friday_am_mode, schedule.friday) === "Bus Stop"
          ? schedule.transport_friday_am_bus_number
          : null,
      transport_friday_am_bus_stop:
        fallbackMode(schedule.transport_friday_am_mode, schedule.friday) === "Bus Stop"
          ? schedule.transport_friday_am_bus_stop
          : null,
      transport_friday_pm_mode: fallbackMode(schedule.transport_friday_pm_mode, schedule.friday),
      transport_friday_pm_door_to_door_address:
        fallbackMode(schedule.transport_friday_pm_mode, schedule.friday) === "Door to Door"
          ? (schedule.transport_friday_pm_door_to_door_address ?? defaultDoorToDoorAddress)
          : null,
      transport_friday_pm_bus_number:
        fallbackMode(schedule.transport_friday_pm_mode, schedule.friday) === "Bus Stop"
          ? schedule.transport_friday_pm_bus_number
          : null,
      transport_friday_pm_bus_stop:
        fallbackMode(schedule.transport_friday_pm_mode, schedule.friday) === "Bus Stop"
          ? schedule.transport_friday_pm_bus_stop
          : null,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: now
    });
  }

  return getMemberCommandCenterDetail(input.memberId);
}

export function updateMemberDobFromCommandCenter(memberId: string, dob: string | null) {
  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId);
  if (!member) return null;
  return updateMockRecord("members", memberId, { dob: dob ?? null });
}

export function updateMemberEnrollmentFromSchedule(memberId: string, enrollmentDate: string | null) {
  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId);
  if (!member) return null;
  return updateMockRecord("members", memberId, { enrollment_date: enrollmentDate ?? null });
}
