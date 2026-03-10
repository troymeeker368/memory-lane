import type { MockDb } from "@/lib/mock/types";

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function normalizePhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

function normalizeDob(value: string | null | undefined) {
  const dob = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : "";
}

function hasValue(value: string | null | undefined) {
  return (value ?? "").trim().length > 0;
}

function stageRank(stage: string | null | undefined) {
  const normalized = (stage ?? "").trim().toLowerCase();
  if (normalized === "inquiry") return 1;
  if (normalized === "tour") return 2;
  if (normalized === "enrollment in progress" || normalized === "eip") return 3;
  if (normalized === "nurture") return 4;
  if (normalized === "closed - won") return 5;
  if (normalized === "closed - lost") return 5;
  return 0;
}

export interface LeadDuplicateSearchInput {
  leadId?: string | null;
  memberName: string;
  caregiverName: string;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  memberDob?: string | null;
}

export interface LeadDuplicateMatch {
  leadId: string;
  leadDisplayId: string;
  memberName: string;
  caregiverName: string;
  caregiverPhone: string | null;
  caregiverEmail: string | null;
  memberDob: string | null;
  stage: string;
  status: string;
  inquiryDate: string;
  score: number;
  reasons: string[];
}

function scoreLeadDuplicate(
  input: LeadDuplicateSearchInput,
  lead: MockDb["leads"][number]
): LeadDuplicateMatch | null {
  const inputMemberName = normalizeName(input.memberName);
  const inputCaregiverName = normalizeName(input.caregiverName);
  const inputPhone = normalizePhone(input.caregiverPhone);
  const inputEmail = normalizeEmail(input.caregiverEmail);
  const inputDob = normalizeDob(input.memberDob);

  const leadMemberName = normalizeName(lead.member_name);
  const leadCaregiverName = normalizeName(lead.caregiver_name);
  const leadPhone = normalizePhone(lead.caregiver_phone);
  const leadEmail = normalizeEmail(lead.caregiver_email);
  const leadDob = normalizeDob(lead.member_dob);

  const sameMemberName = hasValue(inputMemberName) && inputMemberName === leadMemberName;
  const sameCaregiverName = hasValue(inputCaregiverName) && inputCaregiverName === leadCaregiverName;
  const samePhone = hasValue(inputPhone) && inputPhone === leadPhone;
  const sameEmail = hasValue(inputEmail) && inputEmail === leadEmail;
  const sameDob = hasValue(inputDob) && hasValue(leadDob) && inputDob === leadDob;

  const reasons: string[] = [];
  let score = 0;

  if (sameMemberName) {
    score += 4;
    reasons.push(`Prospect name matches (${lead.member_name}).`);
  }
  if (sameCaregiverName) {
    score += 2;
    reasons.push(`Caregiver name matches (${lead.caregiver_name}).`);
  }
  if (samePhone) {
    score += 3;
    reasons.push(`Phone number matches (${lead.caregiver_phone}).`);
  }
  if (sameEmail) {
    score += 3;
    reasons.push(`Email matches (${lead.caregiver_email}).`);
  }
  if (sameDob) {
    score += 2;
    reasons.push(`Date of birth matches (${lead.member_dob}).`);
  }

  const isLikelyDuplicate =
    samePhone ||
    sameEmail ||
    (sameMemberName && sameCaregiverName) ||
    (sameMemberName && sameDob) ||
    score >= 5;

  if (!isLikelyDuplicate) return null;

  return {
    leadId: lead.id,
    leadDisplayId: lead.lead_id,
    memberName: lead.member_name,
    caregiverName: lead.caregiver_name,
    caregiverPhone: lead.caregiver_phone || null,
    caregiverEmail: lead.caregiver_email || null,
    memberDob: lead.member_dob || null,
    stage: lead.stage,
    status: lead.status,
    inquiryDate: lead.inquiry_date,
    score,
    reasons
  };
}

export function findLikelyLeadDuplicates(
  db: Pick<MockDb, "leads">,
  input: LeadDuplicateSearchInput
): LeadDuplicateMatch[] {
  const currentLeadId = (input.leadId ?? "").trim();

  return db.leads
    .filter((lead) => lead.id !== currentLeadId)
    .map((lead) => scoreLeadDuplicate(input, lead))
    .filter((row): row is LeadDuplicateMatch => Boolean(row))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const rightRank = stageRank(right.stage);
      const leftRank = stageRank(left.stage);
      if (leftRank !== rightRank) return rightRank - leftRank;
      return right.inquiryDate.localeCompare(left.inquiryDate);
    })
    .slice(0, 8);
}

export interface LeadDuplicateQueueItem {
  leadAId: string;
  leadADisplayId: string;
  leadAMemberName: string;
  leadAStage: string;
  leadAStatus: string;
  leadBId: string;
  leadBDisplayId: string;
  leadBMemberName: string;
  leadBStage: string;
  leadBStatus: string;
  reasons: string[];
  score: number;
}

export function buildLeadDuplicateReviewQueue(
  db: Pick<MockDb, "leads">
): LeadDuplicateQueueItem[] {
  const queue: LeadDuplicateQueueItem[] = [];

  for (let leftIdx = 0; leftIdx < db.leads.length; leftIdx += 1) {
    const left = db.leads[leftIdx]!;
    for (let rightIdx = leftIdx + 1; rightIdx < db.leads.length; rightIdx += 1) {
      const right = db.leads[rightIdx]!;
      const duplicate = scoreLeadDuplicate(
        {
          memberName: left.member_name,
          caregiverName: left.caregiver_name,
          caregiverPhone: left.caregiver_phone,
          caregiverEmail: left.caregiver_email,
          memberDob: left.member_dob
        },
        right
      );

      if (!duplicate) continue;

      queue.push({
        leadAId: left.id,
        leadADisplayId: left.lead_id,
        leadAMemberName: left.member_name,
        leadAStage: left.stage,
        leadAStatus: left.status,
        leadBId: right.id,
        leadBDisplayId: right.lead_id,
        leadBMemberName: right.member_name,
        leadBStage: right.stage,
        leadBStatus: right.status,
        reasons: duplicate.reasons,
        score: duplicate.score
      });
    }
  }

  return queue.sort((left, right) => right.score - left.score);
}
