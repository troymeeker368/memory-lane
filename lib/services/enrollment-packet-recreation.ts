export const ENROLLMENT_PACKET_RECREATION_CATEGORIES = [
  "Social",
  "Cognitive",
  "Physical",
  "Creative",
  "Sensory",
  "Spiritual"
] as const;

export type EnrollmentPacketRecreationCategory =
  (typeof ENROLLMENT_PACKET_RECREATION_CATEGORIES)[number];

export type EnrollmentPacketRecreationInterests = Record<
  EnrollmentPacketRecreationCategory,
  string[]
>;

export const ENROLLMENT_PACKET_RECREATION_OPTIONS: Record<
  EnrollmentPacketRecreationCategory,
  string[]
> = {
  Social: [
    "Current Events",
    "Group Discussions",
    "Name That Tune",
    "Charades",
    "Pictionary",
    "Board Games",
    "Card Games"
  ],
  Cognitive: [
    "Trivia",
    "Word Games",
    "Crosswords",
    "Sudoku",
    "Jigsaw Puzzles",
    "Spelling Bee",
    "Jeopardy"
  ],
  Physical: [
    "Yoga / Tai Chi",
    "Fitness / Exercise",
    "Dancing",
    "Walking Club",
    "Volleyball",
    "Cornhole",
    "Bowling"
  ],
  Creative: [
    "Painting",
    "Drawing",
    "Arts & Crafts",
    "Poetry",
    "Sewing / Knitting",
    "Photography",
    "Flower Arranging",
    "Baking / Cooking"
  ],
  Sensory: [
    "Gardening",
    "Music Listening",
    "Aromatherapy",
    "Hand Massage",
    "Tactile Activities",
    "Nature Sounds / Visuals"
  ],
  Spiritual: [
    "Meditation",
    "Prayer / Devotion",
    "Faith Discussions",
    "Worship Music",
    "Scripture Reading"
  ]
};

const LEGACY_RECREATION_CATEGORY_ALIASES: Record<string, EnrollmentPacketRecreationCategory> =
  {
    social: "Social",
    cognitive: "Cognitive",
    physical: "Physical",
    expressive: "Creative",
    creative: "Creative",
    sensory: "Sensory",
    spiritual: "Spiritual"
  };

const LEGACY_RECREATION_OPTION_ALIASES: Record<
  string,
  { category: EnrollmentPacketRecreationCategory; option: string }
> = {
  "social - current events": { category: "Social", option: "Current Events" },
  "social - pictionary": { category: "Social", option: "Pictionary" },
  "social - charades": { category: "Social", option: "Charades" },
  "social - name that tune": { category: "Social", option: "Name That Tune" },
  "social - group discussions": { category: "Social", option: "Group Discussions" },
  "social - board games": { category: "Social", option: "Board Games" },
  "social - card games": { category: "Social", option: "Card Games" },
  "social - chess / checkers": { category: "Social", option: "Board Games" },
  "cognitive - trivia": { category: "Cognitive", option: "Trivia" },
  "cognitive - spelling bee": { category: "Cognitive", option: "Spelling Bee" },
  "cognitive - jeopardy": { category: "Cognitive", option: "Jeopardy" },
  "cognitive - word games": { category: "Cognitive", option: "Word Games" },
  "cognitive - crosswords": { category: "Cognitive", option: "Crosswords" },
  "cognitive - sudoku": { category: "Cognitive", option: "Sudoku" },
  "cognitive - jigsaw puzzles": { category: "Cognitive", option: "Jigsaw Puzzles" },
  "physical - yoga / tai chi": { category: "Physical", option: "Yoga / Tai Chi" },
  "physical - fitness / exercise": { category: "Physical", option: "Fitness / Exercise" },
  "physical - dancing": { category: "Physical", option: "Dancing" },
  "physical - walking club": { category: "Physical", option: "Walking Club" },
  "physical - volleyball": { category: "Physical", option: "Volleyball" },
  "physical - cornhole": { category: "Physical", option: "Cornhole" },
  "physical - bowling": { category: "Physical", option: "Bowling" },
  "physical - playing pool": { category: "Physical", option: "Board Games" },
  "physical - mini golf": { category: "Physical", option: "Fitness / Exercise" },
  "physical - frisbee toss": { category: "Physical", option: "Fitness / Exercise" },
  "expressive - painting": { category: "Creative", option: "Painting" },
  "expressive - drawing": { category: "Creative", option: "Drawing" },
  "expressive - arts & crafts": { category: "Creative", option: "Arts & Crafts" },
  "expressive - poetry": { category: "Creative", option: "Poetry" },
  "expressive - sewing / knitting": { category: "Creative", option: "Sewing / Knitting" },
  "expressive - woodworking": { category: "Creative", option: "Arts & Crafts" },
  "expressive - drama club": { category: "Creative", option: "Arts & Crafts" },
  "expressive - photography": { category: "Creative", option: "Photography" },
  "expressive - baking / cooking": { category: "Creative", option: "Baking / Cooking" },
  "expressive - singing": { category: "Sensory", option: "Music Listening" },
  "expressive - gardening": { category: "Sensory", option: "Gardening" },
  "expressive - meditation": { category: "Spiritual", option: "Meditation" },
  "expressive - flower arranging": { category: "Creative", option: "Flower Arranging" }
};

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionLabel(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function createEmptyInterests(): EnrollmentPacketRecreationInterests {
  return {
    Social: [],
    Cognitive: [],
    Physical: [],
    Creative: [],
    Sensory: [],
    Spiritual: []
  };
}

function parseLegacySelection(
  rawValue: string
): { category: EnrollmentPacketRecreationCategory; option: string } | null {
  const normalized = normalizeOptionLabel(rawValue);
  const aliased = LEGACY_RECREATION_OPTION_ALIASES[normalized];
  if (aliased) return aliased;

  const categoryMatch = normalized.match(/^([^:-]+)\s*[-:]\s*(.+)$/);
  if (categoryMatch) {
    const category = LEGACY_RECREATION_CATEGORY_ALIASES[categoryMatch[1]?.trim() ?? ""];
    const optionText = categoryMatch[2]?.trim() ?? "";
    if (!category || !optionText) return null;
    const matchedOption = ENROLLMENT_PACKET_RECREATION_OPTIONS[category].find(
      (option) => normalizeOptionLabel(option) === normalizeOptionLabel(optionText)
    );
    if (matchedOption) return { category, option: matchedOption };
  }

  for (const category of ENROLLMENT_PACKET_RECREATION_CATEGORIES) {
    const matchedOption = ENROLLMENT_PACKET_RECREATION_OPTIONS[category].find(
      (option) => normalizeOptionLabel(option) === normalized
    );
    if (matchedOption) return { category, option: matchedOption };
  }

  return null;
}

function dedupeAndOrder(options: string[], category: EnrollmentPacketRecreationCategory) {
  const allowed = ENROLLMENT_PACKET_RECREATION_OPTIONS[category];
  const normalizedSet = new Set(
    options
      .map((option) => clean(option))
      .filter((option): option is string => Boolean(option))
      .map((option) => normalizeOptionLabel(option))
  );
  return allowed.filter((option) => normalizedSet.has(normalizeOptionLabel(option)));
}

export function getDefaultEnrollmentPacketRecreationInterests() {
  return createEmptyInterests();
}

export function hasEnrollmentPacketRecreationSelections(
  interests: EnrollmentPacketRecreationInterests | null | undefined
) {
  if (!interests) return false;
  return ENROLLMENT_PACKET_RECREATION_CATEGORIES.some((category) => interests[category].length > 0);
}

export function flattenEnrollmentPacketRecreationInterests(
  interests: EnrollmentPacketRecreationInterests | null | undefined
) {
  if (!interests) return [];
  return ENROLLMENT_PACKET_RECREATION_CATEGORIES.flatMap((category) =>
    interests[category].map((option) => `${category}: ${option}`)
  );
}

export function formatEnrollmentPacketRecreationInterests(
  interests: EnrollmentPacketRecreationInterests | null | undefined
) {
  if (!interests || !hasEnrollmentPacketRecreationSelections(interests)) return "-";
  return ENROLLMENT_PACKET_RECREATION_CATEGORIES.filter((category) => interests[category].length > 0)
    .map((category) => `${category}: ${interests[category].join(", ")}`)
    .join(" | ");
}

export function normalizeEnrollmentPacketRecreationInterests(
  value: unknown
): EnrollmentPacketRecreationInterests {
  const normalized = createEmptyInterests();

  if (Array.isArray(value)) {
    value
      .map((entry) => clean(entry))
      .filter((entry): entry is string => Boolean(entry))
      .forEach((entry) => {
        const parsed = parseLegacySelection(entry);
        if (!parsed) return;
        normalized[parsed.category].push(parsed.option);
      });
  } else if (typeof value === "string") {
    return normalizeEnrollmentPacketRecreationInterests(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
  } else if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    ENROLLMENT_PACKET_RECREATION_CATEGORIES.forEach((category) => {
      normalized[category] = Array.isArray(source[category])
        ? (source[category] as unknown[])
            .map((entry) => clean(entry))
            .filter((entry): entry is string => Boolean(entry))
        : [];
    });

    if (
      !hasEnrollmentPacketRecreationSelections(normalized) &&
      Array.isArray(source.recreationalInterests)
    ) {
      return normalizeEnrollmentPacketRecreationInterests(source.recreationalInterests);
    }
  }

  ENROLLMENT_PACKET_RECREATION_CATEGORIES.forEach((category) => {
    normalized[category] = dedupeAndOrder(normalized[category], category);
  });

  return normalized;
}
