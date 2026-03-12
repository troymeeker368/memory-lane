export type PofMhpOwnership = "POF_AUTHORED_PUSH" | "MHP_AUTHORED" | "BIDIRECTIONAL";

export interface PofMhpFieldMapping {
  key: string;
  pofField: string;
  mhpField: string;
  ownership: PofMhpOwnership;
  notes: string;
}

// Source-of-truth contract:
// - POF_AUTHORED_PUSH: POF writes to MHP when the POF is Signed.
// - MHP_AUTHORED: not pushed from POF.
// - BIDIRECTIONAL: maintained by dedicated bidirectional sync paths outside direct POF write.
export const POF_MHP_FIELD_MAPPINGS: PofMhpFieldMapping[] = [
  {
    key: "member_dob",
    pofField: "memberDobSnapshot",
    mhpField: "members.dob",
    ownership: "POF_AUTHORED_PUSH",
    notes: "POF can seed/update member DOB when collected in physician orders."
  },
  {
    key: "diagnoses",
    pofField: "diagnosisRows",
    mhpField: "memberDiagnoses",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Structured diagnosis table syncs as primary/secondary diagnoses."
  },
  {
    key: "allergies",
    pofField: "allergyRows",
    mhpField: "memberAllergies",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Structured allergy table syncs with group+severity+comments."
  },
  {
    key: "adl_ambulation",
    pofField: "careInformation.adlProfile.ambulation",
    mhpField: "ambulation",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned value uses MHP terminology."
  },
  {
    key: "adl_transferring",
    pofField: "careInformation.adlProfile.transferring",
    mhpField: "transferring",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned value uses MHP terminology."
  },
  {
    key: "adl_bathing",
    pofField: "careInformation.adlProfile.bathing",
    mhpField: "bathing",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned value uses MHP terminology."
  },
  {
    key: "adl_dressing",
    pofField: "careInformation.adlProfile.dressing",
    mhpField: "dressing",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned value uses MHP terminology."
  },
  {
    key: "adl_eating",
    pofField: "careInformation.adlProfile.eating",
    mhpField: "eating",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned value uses MHP terminology."
  },
  {
    key: "adl_bladder_continence",
    pofField: "careInformation.adlProfile.bladderContinence",
    mhpField: "bladder_continence",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned continence status."
  },
  {
    key: "adl_bowel_continence",
    pofField: "careInformation.adlProfile.bowelContinence",
    mhpField: "bowel_continence",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned continence status."
  },
  {
    key: "adl_toileting",
    pofField: "careInformation.adlProfile.toileting",
    mhpField: "toileting",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned toileting status."
  },
  {
    key: "adl_toileting_needs",
    pofField: "careInformation.adlProfile.toiletingNeeds",
    mhpField: "toileting_needs",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned toileting needs details."
  },
  {
    key: "adl_toileting_comments",
    pofField: "careInformation.adlProfile.toiletingComments",
    mhpField: "toileting_comments",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned toileting comments."
  },
  {
    key: "adl_hearing",
    pofField: "careInformation.adlProfile.hearing",
    mhpField: "hearing",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned hearing value."
  },
  {
    key: "adl_vision",
    pofField: "careInformation.adlProfile.vision",
    mhpField: "vision",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned vision value."
  },
  {
    key: "adl_dental",
    pofField: "careInformation.adlProfile.dental",
    mhpField: "dental",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned dental value."
  },
  {
    key: "adl_speech_status",
    pofField: "careInformation.adlProfile.speechVerbalStatus",
    mhpField: "speech_verbal_status",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned speech status."
  },
  {
    key: "adl_speech_comments",
    pofField: "careInformation.adlProfile.speechComments",
    mhpField: "speech_comments",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned speech comments."
  },
  {
    key: "adl_hygiene",
    pofField: "careInformation.adlProfile.hygieneGrooming",
    mhpField: "personal_appearance_hygiene_grooming",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned hygiene/grooming value."
  },
  {
    key: "adl_may_self_medicate",
    pofField: "careInformation.adlProfile.maySelfMedicate",
    mhpField: "may_self_medicate",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned medication self-management value."
  },
  {
    key: "adl_medication_manager",
    pofField: "careInformation.adlProfile.medicationManagerName",
    mhpField: "medication_manager_name",
    ownership: "POF_AUTHORED_PUSH",
    notes: "ADL-aligned medication manager."
  },
  {
    key: "orientation_dob",
    pofField: "careInformation.orientationProfile.orientationDob",
    mhpField: "orientation_dob",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Orientation response copied directly."
  },
  {
    key: "orientation_city",
    pofField: "careInformation.orientationProfile.orientationCity",
    mhpField: "orientation_city",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Orientation response copied directly."
  },
  {
    key: "orientation_current_year",
    pofField: "careInformation.orientationProfile.orientationCurrentYear",
    mhpField: "orientation_current_year",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Orientation response copied directly."
  },
  {
    key: "orientation_former_occupation",
    pofField: "careInformation.orientationProfile.orientationFormerOccupation",
    mhpField: "orientation_former_occupation",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Orientation response copied directly."
  },
  {
    key: "disorientation",
    pofField: "careInformation.orientationProfile.disorientation",
    mhpField: "disorientation",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Behavioral orientation sync."
  },
  {
    key: "memory_impairment",
    pofField: "careInformation.orientationProfile.memoryImpairment",
    mhpField: "memory_impairment",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Behavioral memory sync."
  },
  {
    key: "memory_severity",
    pofField: "careInformation.orientationProfile.memorySeverity",
    mhpField: "memory_severity",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Behavioral memory severity sync."
  },
  {
    key: "cognitive_behavior_comments",
    pofField: "careInformation.orientationProfile.cognitiveBehaviorComments",
    mhpField: "cognitive_behavior_comments",
    ownership: "POF_AUTHORED_PUSH",
    notes: "Behavioral comments sync."
  },
  {
    key: "diet_type",
    pofField: "careInformation.nutritionDiets",
    mhpField: "diet_type",
    ownership: "POF_AUTHORED_PUSH",
    notes: "POF nutrition selection can populate MHP diet type."
  },
  {
    key: "dietary_restrictions",
    pofField: "careInformation.nutritionDietOther",
    mhpField: "dietary_restrictions",
    ownership: "POF_AUTHORED_PUSH",
    notes: "POF nutrition other text can populate dietary restrictions."
  },
  {
    key: "code_status",
    pofField: "dnrSelected",
    mhpField: "code_status",
    ownership: "POF_AUTHORED_PUSH",
    notes: "DNR selection updates MHP legal profile code status."
  }
];
