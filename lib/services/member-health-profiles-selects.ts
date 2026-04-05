export const MHP_TABS = [
  "overview",
  "medical",
  "functional",
  "cognitive-behavioral",
  "equipment",
  "legal",
  "notes"
] as const;

export const MEMBER_HEALTH_PROFILE_SELECT = [
  "id",
  "member_id",
  "gender",
  "payor",
  "original_referral_source",
  "photo_consent",
  "profile_image_url",
  "primary_caregiver_name",
  "primary_caregiver_phone",
  "responsible_party_name",
  "responsible_party_phone",
  "provider_name",
  "provider_phone",
  "important_alerts",
  "diet_type",
  "dietary_restrictions",
  "swallowing_difficulty",
  "diet_texture",
  "supplements",
  "foods_to_omit",
  "ambulation",
  "transferring",
  "bathing",
  "dressing",
  "eating",
  "bladder_continence",
  "bowel_continence",
  "toileting",
  "toileting_needs",
  "toileting_comments",
  "hearing",
  "vision",
  "dental",
  "speech_verbal_status",
  "speech_comments",
  "personal_appearance_hygiene_grooming",
  "may_self_medicate",
  "medication_manager_name",
  "orientation_dob",
  "orientation_city",
  "orientation_current_year",
  "orientation_former_occupation",
  "memory_impairment",
  "memory_severity",
  "wandering",
  "combative_disruptive",
  "sleep_issues",
  "self_harm_unsafe",
  "impaired_judgement",
  "delirium",
  "disorientation",
  "agitation_resistive",
  "screaming_loud_noises",
  "exhibitionism_disrobing",
  "exit_seeking",
  "cognitive_behavior_comments",
  "code_status",
  "dnr",
  "dni",
  "polst_molst_colst",
  "hospice",
  "advanced_directives_obtained",
  "power_of_attorney",
  "hospital_preference",
  "legal_comments",
  "source_assessment_id",
  "source_assessment_at",
  "updated_by_user_id",
  "updated_by_name",
  "created_at",
  "updated_at"
].join(", ");

export const MEMBER_DIAGNOSIS_SELECT =
  "id, member_id, diagnosis_type, diagnosis_name, diagnosis_code, date_added, comments, created_by_name, updated_at";
export const MEMBER_MEDICATION_SELECT =
  "id, member_id, medication_name, date_started, medication_status, inactivated_at, dose, quantity, form, frequency, route, route_laterality, given_at_center, prn, prn_instructions, scheduled_times, comments, created_by_name, updated_at";
export const MEMBER_ALLERGY_SELECT =
  "id, member_id, allergy_group, allergy_name, severity, comments, created_by_name, updated_at";
export const MEMBER_PROVIDER_SELECT =
  "id, member_id, provider_name, specialty, specialty_other, practice_name, provider_phone, created_by_name, updated_at";
export const PROVIDER_DIRECTORY_SELECT =
  "id, provider_name, specialty, specialty_other, practice_name, provider_phone, updated_at";
export const HOSPITAL_PREFERENCE_DIRECTORY_SELECT = "id, hospital_name, updated_at";
export const MEMBER_EQUIPMENT_SELECT =
  "id, member_id, equipment_type, provider_source, status, comments, created_by_name, updated_at";
export const MEMBER_NOTE_SELECT =
  "id, member_id, note_type, note_text, created_by_name, created_at, updated_at";

export type MhpTab = (typeof MHP_TABS)[number];
