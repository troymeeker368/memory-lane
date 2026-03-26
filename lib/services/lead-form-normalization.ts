import {
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  resolveCanonicalLeadState
} from "@/lib/canonical";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function hasOption<T extends string>(options: readonly T[], value: string): value is T {
  return options.includes(value as T);
}

export function normalizeLeadFormStage(value: string | null | undefined) {
  const resolved = resolveCanonicalLeadState({
    requestedStage: clean(value) ?? "Inquiry",
    requestedStatus: "Open"
  });
  return resolved.stage;
}

export function normalizeLeadFormStatus(stage: string | null | undefined, value: string | null | undefined) {
  const resolved = resolveCanonicalLeadState({
    requestedStage: clean(stage) ?? "Inquiry",
    requestedStatus: clean(value) ?? "Open"
  });
  return resolved.status;
}

export function normalizeLeadFormLeadSource(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return "Other";
  return hasOption(LEAD_SOURCE_OPTIONS, normalized) ? normalized : "Other";
}

export function normalizeLeadFormLikelihood(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return "Warm";
  return hasOption(LEAD_LIKELIHOOD_OPTIONS, normalized) ? normalized : "Warm";
}

export function normalizeLeadFormFollowUpType(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return "Call";
  return hasOption(LEAD_FOLLOW_UP_TYPES, normalized) ? normalized : "Call";
}

export function splitLeadFormLostReason(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) {
    return { lostReason: "", lostReasonOther: "" };
  }

  if (hasOption(LEAD_LOST_REASON_OPTIONS, normalized)) {
    return { lostReason: normalized, lostReasonOther: "" };
  }

  return { lostReason: "Other", lostReasonOther: normalized };
}

export function normalizeLeadFormTourCompleted(value: boolean | null | undefined): "yes" | "no" | "" {
  if (typeof value !== "boolean") return "";
  return value ? "yes" : "no";
}

export function normalizeLeadFormInquiryDate(value: string | null | undefined, fallback: string) {
  return clean(value) ?? fallback;
}

export function normalizeLeadFormClosedDate(value: string | null | undefined) {
  return clean(value) ?? "";
}

export type LeadFormSummary = {
  stage: ReturnType<typeof normalizeLeadFormStage>;
  status: ReturnType<typeof normalizeLeadFormStatus>;
  leadSource: ReturnType<typeof normalizeLeadFormLeadSource>;
  leadSourceOther: string;
  likelihood: ReturnType<typeof normalizeLeadFormLikelihood>;
  nextFollowUpType: ReturnType<typeof normalizeLeadFormFollowUpType>;
  tourCompleted: ReturnType<typeof normalizeLeadFormTourCompleted>;
  lostReason: string;
  lostReasonOther: string;
  closedDate: string;
};

export function normalizeLeadFormSummary(input?: {
  stage?: string | null;
  status?: string | null;
  leadSource?: string | null;
  leadSourceOther?: string | null;
  likelihood?: string | null;
  nextFollowUpType?: string | null;
  tourCompleted?: boolean | null;
  lostReason?: string | null;
  closedDate?: string | null;
} | null) {
  const stage = normalizeLeadFormStage(input?.stage);
  const status = normalizeLeadFormStatus(stage, input?.status);
  const lostReason = splitLeadFormLostReason(input?.lostReason);

  return {
    stage,
    status,
    leadSource: normalizeLeadFormLeadSource(input?.leadSource),
    leadSourceOther: clean(input?.leadSourceOther) ?? "",
    likelihood: normalizeLeadFormLikelihood(input?.likelihood),
    nextFollowUpType: normalizeLeadFormFollowUpType(input?.nextFollowUpType),
    tourCompleted: normalizeLeadFormTourCompleted(input?.tourCompleted),
    ...lostReason,
    closedDate: normalizeLeadFormClosedDate(input?.closedDate)
  } satisfies LeadFormSummary;
}
