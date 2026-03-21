export const CARE_PLAN_TRACK_IDS = ["Track 1", "Track 2", "Track 3"] as const;
export type CarePlanTrack = (typeof CARE_PLAN_TRACK_IDS)[number];

export const CARE_PLAN_SECTION_TYPES = [
  "Activities of Daily Living (ADLs) Assistance",
  "Cognitive & Memory Support",
  "Socialization & Emotional Well-Being",
  "Safety & Fall Prevention",
  "Medical & Medication Management"
] as const;
export type CarePlanSectionType = (typeof CARE_PLAN_SECTION_TYPES)[number];

export const CARE_PLAN_SHORT_TERM_LABEL = "Short-Term Goals (within 60 days):";
export const CARE_PLAN_LONG_TERM_LABEL = "Long-Term Goals (within 6 months):";
export const CARE_PLAN_REVIEW_UPDATES_LABEL = "Care Plan Review & Updates";
export const CARE_PLAN_REVIEW_OPTIONS = ["No changes needed", "Modifications required (describe below)"] as const;
export const CARE_PLAN_CARE_TEAM_NOTES_LABEL = "Care Team Notes";
export const CARE_PLAN_SEPARATOR_LINE =
  "___________________________________________________________________________________________________";

export const CARE_PLAN_SIGNATURE_LINE_TEMPLATES = {
  completedBy:
    "Completed By (Nurse Name): ____________________________                                    Date of Completion: ______________",
  responsibleParty:
    "Responsible Party Signature: ____________________________                                                                Date: ______________",
  administratorDesignee:
    "Administrator/Designee Signature: _______________________________                                              Date: ______________"
} as const;
export const CARE_PLAN_SIGNATURE_LABELS = {
  completedBy: "Completed By (Nurse Name):",
  completedByDate: "Date of Completion:",
  responsibleParty: "Responsible Party Signature:",
  responsiblePartyDate: "Date:",
  administratorDesignee: "Administrator/Designee Signature:",
  administratorDesigneeDate: "Date:"
} as const;

export type CarePlanTrackSectionDefinition = {
  sectionType: CarePlanSectionType;
  shortTermGoals: readonly string[];
  longTermGoals: readonly string[];
};

export type CarePlanTrackDefinition = {
  track: CarePlanTrack;
  title: string;
  memberInformationLabel: "Member Information";
  memberNameLabel: "Member Name:";
  enrollmentDateLabel: "Enrollment Date:";
  reviewDateLabel: "Care Plan Review Date:";
  sections: readonly CarePlanTrackSectionDefinition[];
};

const TRACK_DEFINITIONS: Record<CarePlanTrack, CarePlanTrackDefinition> = {
  "Track 1": {
    track: "Track 1",
    title: "Member Care Plan: Track 1",
    memberInformationLabel: "Member Information",
    memberNameLabel: "Member Name:",
    enrollmentDateLabel: "Enrollment Date:",
    reviewDateLabel: "Care Plan Review Date:",
    sections: [
      {
        sectionType: "Activities of Daily Living (ADLs) Assistance",
        shortTermGoals: [
          "Member will complete daily self-care tasks (dressing, grooming, toileting) independently with minimal reminders.",
          "Member will participate in light physical activity on most program days to support mobility, as tolerated."
        ],
        longTermGoals: [
          "Member will maintain independence in ADLs with occasional prompts as needed.",
          "Member will follow a consistent daily routine that supports comfort and participation."
        ]
      },
      {
        sectionType: "Cognitive & Memory Support",
        shortTermGoals: [
          "Member will participate in structured memory activities (puzzles, word games) at least once weekly.",
          "Member will use memory aids (calendar, whiteboard, labeled objects) for orientation on program days."
        ],
        longTermGoals: [
          "Member will continue to participate actively in memory and orientation activities.",
          "Member will engage in reminiscence activities (storytelling, group discussions) at least monthly to support identity and confidence."
        ]
      },
      {
        sectionType: "Socialization & Emotional Well-Being",
        shortTermGoals: [
          "Member will attend at least one group activity per week to strengthen social connections.",
          "Member will engage in a preferred hobby or creative activity at least twice per month."
        ],
        longTermGoals: [
          "Member will maintain friendships within the center community and participate in discussions regularly.",
          "Member will demonstrate consistent positive social engagement to prevent isolation."
        ]
      },
      {
        sectionType: "Safety & Fall Prevention",
        shortTermGoals: [
          "Member will use safe mobility practices (assistive devices if applicable) during program attendance.",
          "Staff will maintain an environment free of tripping hazards."
        ],
        longTermGoals: [
          "Member will maintain steady mobility and independence in movement.",
          "Member will continue strength and stability activities regularly to reduce fall risk."
        ]
      },
      {
        sectionType: "Medical & Medication Management",
        shortTermGoals: [
          "Member will demonstrate awareness of medication schedule with minimal reminders as appropriate, with nurse oversight.",
          "Member will attend routine health check-ups as scheduled or as warranted."
        ],
        longTermGoals: [
          "Member will maintain stable health through consistent medication use and wellness monitoring.",
          "Member will demonstrate continued independence in medication management where appropriate."
        ]
      }
    ]
  },
  "Track 2": {
    track: "Track 2",
    title: "Member Care Plan: Track 2",
    memberInformationLabel: "Member Information",
    memberNameLabel: "Member Name:",
    enrollmentDateLabel: "Enrollment Date:",
    reviewDateLabel: "Care Plan Review Date:",
    sections: [
      {
        sectionType: "Activities of Daily Living (ADLs) Assistance",
        shortTermGoals: [
          "Member will complete self-care tasks (dressing, grooming, toileting) with verbal or visual prompts as needed.",
          "Member will participate in structured light physical activity on program days to support mobility."
        ],
        longTermGoals: [
          "Member will maintain independence in personal care tasks with structured assistance.",
          "Member will demonstrate reduced frustration and greater comfort with ADLs through familiar routines."
        ]
      },
      {
        sectionType: "Cognitive & Memory Support",
        shortTermGoals: [
          "Member will engage in simplified memory or cognitive activities at least once weekly with staff support.",
          "Member will use orientation supports (visual aids, daily reminders) during program attendance."
        ],
        longTermGoals: [
          "Member will maintain participation in familiar activities that promote memory and confidence.",
          "Member will respond positively to structured prompts that encourage recall and orientation."
        ]
      },
      {
        sectionType: "Socialization & Emotional Well-Being",
        shortTermGoals: [
          "Member will participate in small group activities with staff guidance at least weekly.",
          "Member will engage in a familiar hobby or simple creative project at least monthly."
        ],
        longTermGoals: [
          "Member will maintain regular socialization through structured, staff-supported interactions.",
          "Member will demonstrate increased comfort and reduced isolation through ongoing engagement."
        ]
      },
      {
        sectionType: "Safety & Fall Prevention",
        shortTermGoals: [
          "Member will use safe mobility practices with staff supervision during transitions.",
          "Member will participate in scheduled walking or movement activities to support stability."
        ],
        longTermGoals: [
          "Member will maintain mobility and safe movement patterns with ongoing staff support.",
          "Member will reduce fall risk by participating in balance and stability activities regularly."
        ]
      },
      {
        sectionType: "Medical & Medication Management",
        shortTermGoals: [
          "Member will adhere to medication schedule with nurse-directed assistance.",
          "Member will be monitored for changes in health status, and concerns will be communicated promptly."
        ],
        longTermGoals: [
          "Member will maintain stable health through consistent medication and wellness tracking.",
          "Member will continue to access appropriate healthcare services and provider follow-up as needed."
        ]
      }
    ]
  },
  "Track 3": {
    track: "Track 3",
    title: "Member Care Plan: Track 3",
    memberInformationLabel: "Member Information",
    memberNameLabel: "Member Name:",
    enrollmentDateLabel: "Enrollment Date:",
    reviewDateLabel: "Care Plan Review Date:",
    sections: [
      {
        sectionType: "Activities of Daily Living (ADLs) Assistance",
        shortTermGoals: [
          "Member will participate in daily self-care routines with frequent verbal prompts and partial assistance as needed.",
          "Member will demonstrate reduced frustration during grooming, dressing, and toileting when steps are simplified."
        ],
        longTermGoals: [
          "Member will continue to engage in basic self-care tasks with structured support.",
          "Member will maintain comfort and dignity through a predictable ADL routine."
        ]
      },
      {
        sectionType: "Cognitive & Memory Support",
        shortTermGoals: [
          "Member will engage in simplified cognitive or sensory activities (music, photos, familiar objects) at least weekly.",
          "Member will respond to orientation cues (gentle reminders, familiar prompts) during program days."
        ],
        longTermGoals: [
          "Member will maintain participation in familiar or sensory-based activities that support confidence and emotional well-being.",
          "Member will demonstrate reduced distress through structured, supportive approaches to recall and engagement."
        ]
      },
      {
        sectionType: "Socialization & Emotional Well-Being",
        shortTermGoals: [
          "Member will participate in one-on-one or small group activities with staff support at least weekly.",
          "Member will demonstrate comfort in social settings through positive engagement (smiling, responding, or joining in)."
        ],
        longTermGoals: [
          "Member will sustain meaningful social interaction with peers or staff through guided participation.",
          "Member will demonstrate improved emotional comfort through ongoing social engagement."
        ]
      },
      {
        sectionType: "Safety & Fall Prevention",
        shortTermGoals: [
          "Member will complete mobility transitions (e.g., sitting to standing) safely with staff supervision.",
          "Member will participate in movement or walking breaks to support stability."
        ],
        longTermGoals: [
          "Member will maintain safe mobility patterns with continued supervision and environmental support.",
          "Member will reduce fall risk through consistent staff assistance and structured movement activities."
        ]
      },
      {
        sectionType: "Medical & Medication Management",
        shortTermGoals: [
          "Member will receive medication with direct staff assistance to ensure accuracy.",
          "Member will be monitored for changes in comfort, pain, or health status during program attendance."
        ],
        longTermGoals: [
          "Member will maintain stable health with ongoing supervision of medications and wellness needs.",
          "Member will prevent unnecessary complications through proactive communication with caregivers and providers."
        ]
      }
    ]
  }
};

export function isCarePlanTrack(value: string | null | undefined): value is CarePlanTrack {
  if (!value) return false;
  return CARE_PLAN_TRACK_IDS.includes(value as CarePlanTrack);
}

export function getCarePlanTracks(): CarePlanTrack[] {
  return [...CARE_PLAN_TRACK_IDS];
}

export function getCarePlanTrackDefinition(track: CarePlanTrack): CarePlanTrackDefinition {
  return TRACK_DEFINITIONS[track];
}

export function getCarePlanDocumentBlueprint(track: CarePlanTrack) {
  return {
    definition: getCarePlanTrackDefinition(track),
    labels: {
      shortTerm: CARE_PLAN_SHORT_TERM_LABEL,
      longTerm: CARE_PLAN_LONG_TERM_LABEL,
      reviewUpdates: CARE_PLAN_REVIEW_UPDATES_LABEL,
      reviewOptions: [...CARE_PLAN_REVIEW_OPTIONS],
      careTeamNotes: CARE_PLAN_CARE_TEAM_NOTES_LABEL,
      separatorLine: CARE_PLAN_SEPARATOR_LINE,
      signatureLabels: CARE_PLAN_SIGNATURE_LABELS,
      signatures: CARE_PLAN_SIGNATURE_LINE_TEMPLATES
    }
  };
}

export function getAllCarePlanTrackDefinitions(): CarePlanTrackDefinition[] {
  return CARE_PLAN_TRACK_IDS.map((track) => TRACK_DEFINITIONS[track]);
}

export function getCanonicalTrackSections(track: CarePlanTrack) {
  const definition = getCarePlanTrackDefinition(track);
  return definition.sections.map((section, index) => ({
    sectionType: section.sectionType,
    shortTermGoals: section.shortTermGoals.join("\n"),
    longTermGoals: section.longTermGoals.join("\n"),
    displayOrder: index + 1
  }));
}

export function getGoalListItems(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(\d+[.):-]|[-*])\s*/, "").trim())
    .filter(Boolean);
}
