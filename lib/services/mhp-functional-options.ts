export type FunctionalChoiceOption = {
  label: string;
  value: string;
};

export const MHP_AMBULATION_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Steady", value: "Steady" },
  { label: "Occasionally unsteady", value: "Occasionally unsteady" },
  { label: "Frequent falls", value: "Frequent falls" }
];

export const MHP_TRANSFER_SUPPORT_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Independent", value: "Independent" },
  { label: "Needs help", value: "Needs help" },
  { label: "Cueing/reminders", value: "Cueing/reminders" }
];

export const MHP_DRESSING_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Independent", value: "Independent" },
  { label: "Needs help", value: "Needs help" }
];

export const MHP_BLADDER_CONTINENCE_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Continent", value: "Continent" },
  { label: "Incontinent", value: "Incontinent" },
  { label: "Uses products", value: "Uses products" }
];

export const MHP_BOWEL_CONTINENCE_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Continent", value: "Continent" },
  { label: "Incontinent", value: "Incontinent" },
  { label: "Needs monitoring", value: "Needs monitoring" }
];

export const MHP_TOILETING_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Yes", value: "Yes" },
  { label: "No", value: "No" },
  { label: "Cueing/reminders", value: "Cueing/reminders" }
];

export const MHP_HEARING_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Intact", value: "Intact" },
  { label: "Hard of hearing", value: "Hard of hearing" },
  { label: "Hearing aids", value: "Hearing aids" }
];

export const MHP_VISION_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Intact", value: "Intact" },
  { label: "Glasses", value: "Glasses" },
  { label: "Impaired", value: "Impaired" }
];

export const MHP_DENTAL_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Intact", value: "Intact" },
  { label: "Dentures", value: "Dentures" },
  { label: "Needs follow-up", value: "Needs follow-up" }
];

export const MHP_SPEECH_STATUS_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Clear", value: "Clear" },
  { label: "Limited verbal", value: "Limited verbal" },
  { label: "Non-verbal", value: "Non-verbal" }
];

export const MHP_SELF_MEDICATE_OPTIONS: readonly FunctionalChoiceOption[] = [
  { label: "Yes", value: "true" },
  { label: "No", value: "false" }
];
