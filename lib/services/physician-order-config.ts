export const POF_CENTER_ADDRESS = "368 Fort Mill Parkway, Suite 106, Fort Mill, SC";
export const POF_CENTER_PHONE = "803-591-9898";
export const POF_CENTER_LOGO_PUBLIC_PATH = "/TS logo_Innovative Adult Day-BLUE (2).png";

export const POF_LEVEL_OF_CARE_OPTIONS = ["Home", "SNF", "MCU", "ALF", "ILF"] as const;
export const POF_NUTRITION_OPTIONS = [
  "Regular",
  "Soft",
  "Cardiac",
  "Diabetic",
  "Low sodium",
  "Renal",
  "Bland",
  "Puree",
  "Low residue",
  "Consistent Carb",
  "Other"
] as const;

export const POF_MEDICATION_ROUTE_OPTIONS = ["PO", "SQ", "IM", "TD", "INH", "Topical", "Ophthalmic", "Otic"] as const;
export const POF_MEDICATION_FORM_OPTIONS = [
  "Tablet",
  "Capsule",
  "Liquid",
  "Injection",
  "Patch",
  "Cream/Ointment",
  "Drops",
  "Inhaler",
  "Powder",
  "Other"
] as const;
export const POF_DEFAULT_MEDICATION_ROUTE = "PO";
export const POF_DEFAULT_MEDICATION_FORM = "Tablet";
export const POF_DEFAULT_MEDICATION_QUANTITY = "1";

export const POF_ALLERGY_GROUP_OPTIONS = ["food", "medication", "environmental", "other"] as const;
export const POF_ALLERGY_SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe", "Anaphylaxis"] as const;

export const POF_STANDING_ORDER_OPTIONS = [
  "Tylenol 650mg by mouth every 4 hrs for pain/fever",
  "Ibuprofen 200mg by mouth every 8 hrs for pain",
  "Mylanta 10mL by mouth every 4 hrs for indigestion",
  "Benadryl 25mg by mouth every 6 hrs for itching"
] as const;

export interface PhysicianOrderRuleSettings {
  renewalIntervalYears: number;
  renewalDueSoonDays: number;
}

export const DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS: PhysicianOrderRuleSettings = {
  renewalIntervalYears: 2,
  renewalDueSoonDays: 60
};

export const OPHTHALMIC_LATERALITY_OPTIONS = ["OD", "OS", "OU"] as const;
export const OTIC_LATERALITY_OPTIONS = ["AD", "AS", "AU"] as const;
