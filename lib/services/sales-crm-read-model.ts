import {
  getEnrollmentPacketEligibleLeadQueryStages,
  resolveCanonicalLeadState
} from "@/lib/canonical";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import { getSalesDashboardSummarySupabase, normalizeSalesPipelineStageCounts } from "@/lib/services/sales-workflows";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate } from "@/lib/timezone";

function clean(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isUuid(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
}

function normalizeUuidList(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => clean(value)).filter((value): value is string => Boolean(value) && isUuid(value)))];
}

export interface SalesPartnerRow {
  id: string;
  partner_id: string;
  organization_name: string;
  category: string | null;
  location?: string | null;
  primary_phone?: string | null;
  primary_email?: string | null;
  active: boolean;
  last_touched: string | null;
}

export interface SalesReferralSourceRow {
  id: string;
  referral_source_id: string;
  partner_id: string;
  contact_name: string;
  organization_name: string | null;
  job_title?: string | null;
  primary_phone?: string | null;
  primary_email?: string | null;
  preferred_contact_method?: string | null;
  active: boolean;
  last_touched: string | null;
}

export interface SalesLeadEnrollmentRow {
  id: string;
  stage: string;
  status: string;
  member_name: string | null;
  member_dob: string | null;
  lead_source: string | null;
  member_start_date: string | null;
}

type SalesEnrollmentPacketEligibleLeadFilterRow = {
  id: string;
  member_name: string | null;
  caregiver_email: string | null;
  member_start_date: string | null;
};

export type SalesEnrollmentPacketEligibleLeadRow = SalesEnrollmentPacketEligibleLeadFilterRow;

export interface SalesLeadLookupRow {
  id: string;
  member_name: string | null;
  caregiver_name: string | null;
  stage: string;
  status: string;
  created_at: string;
  partner_id: string | null;
  referral_source_id: string | null;
}

export type SalesLeadPickerRow = Pick<
  SalesLeadLookupRow,
  "id" | "member_name" | "stage" | "partner_id" | "referral_source_id"
>;

export type SalesPartnerPickerRow = Pick<SalesPartnerRow, "id" | "partner_id" | "organization_name">;

export type SalesLeadActivityRow = {
  id: string;
  lead_id: string;
  activity_at: string;
  activity_type: string;
  outcome: string | null;
  lost_reason: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  completed_by_name: string | null;
  notes: string | null;
  member_name: string | null;
};

export type SalesPartnerActivityRow = {
  id: string;
  partner_id: string | null;
  referral_source_id: string | null;
  lead_id: string | null;
  organization_name: string | null;
  contact_name: string | null;
  activity_at: string;
  activity_type: string;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  notes: string | null;
};

export interface SalesRecentActivitySnapshot {
  activities: SalesLeadActivityRow[];
  partnerActivities: SalesPartnerActivityRow[];
}

export interface SalesLeadReadRow extends SalesLeadLookupRow {
  inquiry_date: string | null;
  caregiver_relationship: string | null;
  caregiver_phone: string | null;
  caregiver_email: string | null;
  member_dob: string | null;
  lead_source: string | null;
  lead_source_other: string | null;
  referral_name: string | null;
  likelihood: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  tour_date: string | null;
  tour_completed: boolean | null;
  discovery_date: string | null;
  member_start_date: string | null;
  notes_summary: string | null;
  lost_reason: string | null;
  closed_date: string | null;
  created_by_name: string | null;
}

export interface SalesLeadListResult {
  rows: SalesLeadReadRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface SalesLeadFollowUpDashboardResult extends SalesLeadListResult {
  summary: {
    overdue: number;
    dueToday: number;
    upcoming: number;
    missingDate: number;
  };
}

export interface SalesStageCountRow {
  stage: string;
  count: number;
}

export interface SalesSummarySnapshot {
  totalLeadCount: number;
  openLeadCount: number;
  eipLeadCount: number;
  wonLeadCount: number;
  lostLeadCount: number;
  convertedOrEnrolledCount: number;
  recentInquiryActivityCount: number;
  recentInquiries: SalesLeadReadRow[];
  stageCounts: SalesStageCountRow[];
}

const SALES_LEAD_READ_SELECT = [
  "id",
  "stage",
  "status",
  "created_at",
  "inquiry_date",
  "member_name",
  "caregiver_name",
  "caregiver_relationship",
  "caregiver_phone",
  "caregiver_email",
  "member_dob",
  "lead_source",
  "lead_source_other",
  "partner_id",
  "referral_source_id",
  "referral_name",
  "likelihood",
  "next_follow_up_date",
  "next_follow_up_type",
  "tour_date",
  "tour_completed",
  "discovery_date",
  "member_start_date",
  "notes_summary",
  "lost_reason",
  "closed_date",
  "created_by_name"
].join(", ");

const SALES_ENROLLMENT_PACKET_ELIGIBLE_SELECT = [
  "id",
  "member_name",
  "caregiver_email",
  "member_start_date"
].join(", ");
const ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES = [...getEnrollmentPacketEligibleLeadQueryStages()];

const SALES_LEAD_LOOKUP_SELECT = "id, member_name, caregiver_name, stage, status, created_at, partner_id, referral_source_id";
const SALES_PARTNER_LOOKUP_SELECT =
  "id, partner_id, organization_name, category, location, primary_phone, primary_email, active, last_touched";
const SALES_REFERRAL_SOURCE_LOOKUP_SELECT =
  "id, referral_source_id, partner_id, contact_name, organization_name, job_title, primary_phone, primary_email, preferred_contact_method, active, last_touched";
const SALES_LEAD_LOOKUP_DEFAULT_LIMIT = 120;
const SALES_LOOKUP_PARTNER_LIMIT = 250;
const SALES_LOOKUP_REFERRAL_SOURCE_LIMIT = 250;
type SalesListRange = {
  start: number;
  end: number;
};

function applyOpenLeadFilter<T extends { eq: (column: string, value: string) => T }>(query: T) {
  return query.eq("status", "open");
}

function toSalesLeadReadRow(row: Record<string, unknown>): SalesLeadReadRow {
  const resolved = resolveCanonicalLeadState({
    requestedStage: typeof row.stage === "string" ? row.stage : "Inquiry",
    requestedStatus: typeof row.status === "string" ? row.status : "Open"
  });
  return {
    id: String(row.id ?? ""),
    member_name: clean(row.member_name),
    caregiver_name: clean(row.caregiver_name),
    stage: resolved.stage,
    status: resolved.status,
    created_at: String(row.created_at ?? ""),
    partner_id: clean(row.partner_id),
    referral_source_id: clean(row.referral_source_id),
    inquiry_date: clean(row.inquiry_date),
    caregiver_relationship: clean(row.caregiver_relationship),
    caregiver_phone: clean(row.caregiver_phone),
    caregiver_email: clean(row.caregiver_email),
    member_dob: clean(row.member_dob),
    lead_source: clean(row.lead_source),
    lead_source_other: clean(row.lead_source_other),
    referral_name: clean(row.referral_name),
    likelihood: clean(row.likelihood),
    next_follow_up_date: clean(row.next_follow_up_date),
    next_follow_up_type: clean(row.next_follow_up_type),
    tour_date: clean(row.tour_date),
    tour_completed: typeof row.tour_completed === "boolean" ? row.tour_completed : null,
    discovery_date: clean(row.discovery_date),
    member_start_date: clean(row.member_start_date),
    notes_summary: clean(row.notes_summary),
    lost_reason: clean(row.lost_reason),
    closed_date: clean(row.closed_date),
    created_by_name: clean(row.created_by_name)
  };
}

function toEnrollmentPacketEligibleLeadFilterRow(
  row: Record<string, unknown>
): SalesEnrollmentPacketEligibleLeadFilterRow {
  return {
    id: String(row.id ?? ""),
    member_name: clean(row.member_name),
    caregiver_email: clean(row.caregiver_email),
    member_start_date: clean(row.member_start_date)
  };
}

function toSalesLeadLookupRow(row: Record<string, unknown>): SalesLeadLookupRow {
  const resolved = resolveCanonicalLeadState({
    requestedStage: typeof row.stage === "string" ? row.stage : "Inquiry",
    requestedStatus: typeof row.status === "string" ? row.status : "Open"
  });
  return {
    id: String(row.id ?? ""),
    member_name: clean(row.member_name),
    caregiver_name: clean(row.caregiver_name),
    stage: resolved.stage,
    status: resolved.status,
    created_at: String(row.created_at ?? ""),
    partner_id: clean(row.partner_id),
    referral_source_id: clean(row.referral_source_id)
  };
}

function normalizePage(rawPage?: number | null) {
  if (!Number.isFinite(rawPage) || !rawPage || rawPage < 1) return 1;
  return Math.floor(rawPage);
}

function normalizePageSize(rawPageSize?: number | null, fallback = 25) {
  if (!Number.isFinite(rawPageSize) || !rawPageSize || rawPageSize < 1) return fallback;
  return Math.floor(rawPageSize);
}

function normalizeReferralSources(partners: SalesPartnerRow[], referralSources: SalesReferralSourceRow[]) {
  const partnerByInternalId = new Map(partners.map((partner) => [String(partner.id), partner]));
  return referralSources.map((source) => ({
    ...source,
    partner_id: partnerByInternalId.get(String(source.partner_id))?.partner_id ?? source.partner_id
  }));
}

function buildSalesPartnerSearchFilter(q?: string | null) {
  const normalized = clean(q);
  if (!normalized) return null;
  const pattern = buildSupabaseIlikePattern(normalized);
  return [
    `organization_name.ilike.${pattern}`,
    `category.ilike.${pattern}`,
    `location.ilike.${pattern}`,
    `primary_phone.ilike.${pattern}`,
    `primary_email.ilike.${pattern}`
  ].join(",");
}

function buildSalesReferralSourceSearchFilter(q?: string | null) {
  const normalized = clean(q);
  if (!normalized) return null;
  const pattern = buildSupabaseIlikePattern(normalized);
  return [
    `contact_name.ilike.${pattern}`,
    `organization_name.ilike.${pattern}`,
    `job_title.ilike.${pattern}`,
    `primary_phone.ilike.${pattern}`,
    `primary_email.ilike.${pattern}`,
    `preferred_contact_method.ilike.${pattern}`
  ].join(",");
}

function normalizeSalesPartnerRow(row: Record<string, unknown>): SalesPartnerRow {
  return {
    id: String(row.id ?? ""),
    partner_id: String(row.partner_id ?? ""),
    organization_name: clean(row.organization_name) ?? "Unknown Organization",
    category: clean(row.category),
    location: clean(row.location),
    primary_phone: clean(row.primary_phone),
    primary_email: clean(row.primary_email),
    active: row.active === false ? false : true,
    last_touched: clean(row.last_touched)
  };
}

function normalizeSalesReferralSourceRow(row: Record<string, unknown>): SalesReferralSourceRow {
  return {
    id: String(row.id ?? ""),
    referral_source_id: String(row.referral_source_id ?? ""),
    partner_id: String(row.partner_id ?? ""),
    contact_name: clean(row.contact_name) ?? "",
    organization_name: clean(row.organization_name),
    job_title: clean(row.job_title),
    primary_phone: clean(row.primary_phone),
    primary_email: clean(row.primary_email),
    preferred_contact_method: clean(row.preferred_contact_method),
    active: row.active === false ? false : true,
    last_touched: clean(row.last_touched)
  };
}

async function listSalesPartnerRowsSupabase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input?: {
    count?: "exact" | null;
    ids?: Array<string | null | undefined>;
    q?: string | null;
    limit?: number;
    range?: SalesListRange;
  }
) {
  const partnerIds = normalizeUuidList(input?.ids ?? []);
  const searchFilter = buildSalesPartnerSearchFilter(input?.q);

  if (input?.count === "exact") {
    let query = supabase
      .from("community_partner_organizations")
      .select(SALES_PARTNER_LOOKUP_SELECT, { count: "exact" })
      .order("organization_name", { ascending: true });
    if (partnerIds.length > 0) query = query.in("id", partnerIds);
    if (searchFilter) query = query.or(searchFilter);
    if (input?.range) {
      query = query.range(input.range.start, input.range.end);
    } else if (typeof input?.limit === "number") {
      query = query.limit(input.limit);
    }
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: ((data ?? []) as Array<Record<string, unknown> | null>)
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
        .map((row) => normalizeSalesPartnerRow(row)),
      count: count ?? null
    };
  }

  let query = supabase.from("community_partner_organizations").select(SALES_PARTNER_LOOKUP_SELECT).order("organization_name", { ascending: true });
  if (partnerIds.length > 0) query = query.in("id", partnerIds);
  if (searchFilter) query = query.or(searchFilter);
  if (input?.range) {
    query = query.range(input.range.start, input.range.end);
  } else if (typeof input?.limit === "number") {
    query = query.limit(input.limit);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return {
    rows: ((data ?? []) as Array<Record<string, unknown> | null>)
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      .map((row) => normalizeSalesPartnerRow(row)),
    count: null
  };
}

async function listSalesReferralSourceRowsSupabase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input?: {
    count?: "exact" | null;
    ids?: Array<string | null | undefined>;
    partnerId?: string | null;
    partnerIds?: Array<string | null | undefined>;
    q?: string | null;
    limit?: number;
    range?: SalesListRange;
  }
) {
  const referralSourceIds = normalizeUuidList(input?.ids ?? []);
  const partnerIds = normalizeUuidList(input?.partnerIds ?? []);
  const partnerId = clean(input?.partnerId);
  const searchFilter = buildSalesReferralSourceSearchFilter(input?.q);

  if (input?.count === "exact") {
    let query = supabase
      .from("referral_sources")
      .select(SALES_REFERRAL_SOURCE_LOOKUP_SELECT, { count: "exact" })
      .order("organization_name", { ascending: true });
    if (referralSourceIds.length > 0) query = query.in("id", referralSourceIds);
    if (partnerIds.length > 0) {
      query = query.in("partner_id", partnerIds);
    } else if (partnerId) {
      query = query.eq("partner_id", partnerId);
    }
    if (searchFilter) query = query.or(searchFilter);
    if (input?.range) {
      query = query.range(input.range.start, input.range.end);
    } else if (typeof input?.limit === "number") {
      query = query.limit(input.limit);
    }
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: ((data ?? []) as Array<Record<string, unknown> | null>)
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
        .map((row) => normalizeSalesReferralSourceRow(row)),
      count: count ?? null
    };
  }

  let query = supabase.from("referral_sources").select(SALES_REFERRAL_SOURCE_LOOKUP_SELECT).order("organization_name", { ascending: true });
  if (referralSourceIds.length > 0) query = query.in("id", referralSourceIds);
  if (partnerIds.length > 0) {
    query = query.in("partner_id", partnerIds);
  } else if (partnerId) {
    query = query.eq("partner_id", partnerId);
  }
  if (searchFilter) query = query.or(searchFilter);
  if (input?.range) {
    query = query.range(input.range.start, input.range.end);
  } else if (typeof input?.limit === "number") {
    query = query.limit(input.limit);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return {
    rows: ((data ?? []) as Array<Record<string, unknown> | null>)
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      .map((row) => normalizeSalesReferralSourceRow(row)),
    count: null
  };
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function normalizeDashboardRecentInquiries(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => toSalesLeadReadRow(row));
}

export async function getSalesLeadByIdSupabase(leadId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(SALES_LEAD_READ_SELECT)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSalesLeadReadRow(data as unknown as Record<string, unknown>) : null;
}

async function fetchPartnerByIdSupabase(partnerId: string) {
  const partner = await getSalesPartnerByIdOrCodeSupabase(partnerId);
  return partner
    ? {
        ...partner,
        location: partner.location ?? null,
        primary_phone: partner.primary_phone ?? null,
        primary_email: partner.primary_email ?? null
      }
    : null;
}

async function fetchReferralSourceByIdSupabase(sourceId: string) {
  const source = await getSalesReferralSourceByIdOrCodeSupabase(sourceId);
  return source
    ? {
        ...source,
        job_title: source.job_title ?? null,
        primary_phone: source.primary_phone ?? null,
        primary_email: source.primary_email ?? null,
        preferred_contact_method: source.preferred_contact_method ?? null
      }
    : null;
}

export async function getSalesPartnerByIdOrCodeSupabase(rawPartnerId: string) {
  const partnerId = clean(rawPartnerId);
  if (!partnerId) return null;

  const supabase = await createClient();
  const filters = [isUuid(partnerId) ? `id.eq.${partnerId}` : null, `partner_id.eq.${partnerId}`].filter(Boolean);

  const { data, error } = await supabase
    .from("community_partner_organizations")
    .select("id, partner_id, organization_name, category, active, last_touched")
    .or(filters.join(","))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SalesPartnerRow | null) ?? null;
}

export async function getSalesReferralSourceByIdOrCodeSupabase(rawSourceId: string) {
  const sourceId = clean(rawSourceId);
  if (!sourceId) return null;

  const supabase = await createClient();
  const filters = [isUuid(sourceId) ? `id.eq.${sourceId}` : null, `referral_source_id.eq.${sourceId}`].filter(Boolean);

  const { data, error } = await supabase
    .from("referral_sources")
    .select("id, referral_source_id, partner_id, contact_name, organization_name, active, last_touched")
    .or(filters.join(","))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SalesReferralSourceRow | null) ?? null;
}

export async function resolveSalesPartnerAndReferralSupabase(input: {
  partnerId?: string | null;
  referralSourceId?: string | null;
}) {
  const requestedPartnerId = clean(input.partnerId);
  const requestedReferralSourceId = clean(input.referralSourceId);

  const [partner, referralSource] = await Promise.all([
    requestedPartnerId ? getSalesPartnerByIdOrCodeSupabase(requestedPartnerId) : Promise.resolve(null),
    requestedReferralSourceId ? getSalesReferralSourceByIdOrCodeSupabase(requestedReferralSourceId) : Promise.resolve(null)
  ]);

  if (requestedPartnerId && !partner) throw new Error("Community partner organization not found.");
  if (requestedReferralSourceId && !referralSource) throw new Error("Referral source not found.");
  if (partner && referralSource && referralSource.partner_id !== partner.id) {
    throw new Error("Referral Source must belong to the selected Community Partner Organization.");
  }

  return { partner, referralSource };
}

export async function getSalesLeadForEnrollmentSupabase(leadId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, stage, status, member_name, member_dob, lead_source, member_start_date")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SalesLeadEnrollmentRow | null) ?? null;
}

export async function listEnrollmentPacketEligibleLeadPickerSupabase(input?: {
  q?: string;
  selectedId?: string | null;
  limit?: number;
  minQueryLength?: number;
}): Promise<SalesEnrollmentPacketEligibleLeadRow[]> {
  const q = clean(input?.q);
  const limit = normalizePageSize(input?.limit ?? 25, 25);
  const minQueryLength =
    Number.isFinite(input?.minQueryLength) && Number(input?.minQueryLength) > 0
      ? Math.floor(Number(input?.minQueryLength))
      : 2;
  const selectedId = clean(input?.selectedId);
  const supabase = await createClient();
  const selectedLeadPromise = selectedId
    ? supabase
        .from("leads")
        .select(SALES_ENROLLMENT_PACKET_ELIGIBLE_SELECT)
        .eq("id", selectedId)
        .eq("status", "open")
        .in("stage", ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null } as const);
  const matchesPromise =
    q && q.length >= minQueryLength
      ? (() => {
          const pattern = buildSupabaseIlikePattern(q);
          return supabase
            .from("leads")
            .select(SALES_ENROLLMENT_PACKET_ELIGIBLE_SELECT)
            .eq("status", "open")
            .in("stage", ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES)
            .or(
              [
                `member_name.ilike.${pattern}`,
                `caregiver_name.ilike.${pattern}`,
                `caregiver_email.ilike.${pattern}`
              ].join(",")
            )
            .order("inquiry_date", { ascending: false, nullsFirst: false })
            .order("member_name", { ascending: true })
            .limit(limit);
        })()
      : Promise.resolve({ data: [] as SalesEnrollmentPacketEligibleLeadFilterRow[], error: null } as const);

  const [selectedLeadResult, matchesResult] = await Promise.all([selectedLeadPromise, matchesPromise]);
  if (selectedLeadResult.error) throw new Error(selectedLeadResult.error.message);
  if (matchesResult.error) throw new Error(matchesResult.error.message);

  const rows = [selectedLeadResult.data, ...((matchesResult.data ?? []) as Array<Record<string, unknown> | null>)]
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => toEnrollmentPacketEligibleLeadFilterRow(row));

  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
}

export async function listSalesLeadPickerOptionsSupabase(input?: {
  q?: string;
  selectedId?: string | null;
  limit?: number;
  minQueryLength?: number;
}): Promise<SalesLeadPickerRow[]> {
  const q = clean(input?.q);
  const limit = normalizePageSize(input?.limit ?? 25, 25);
  const minQueryLength =
    Number.isFinite(input?.minQueryLength) && Number(input?.minQueryLength) > 0
      ? Math.floor(Number(input?.minQueryLength))
      : 2;
  const selectedId = clean(input?.selectedId);
  const supabase = await createClient();
  const selectedLeadPromise = selectedId
    ? supabase.from("leads").select(SALES_LEAD_LOOKUP_SELECT).eq("id", selectedId).maybeSingle()
    : Promise.resolve({ data: null, error: null } as const);
  const matchesPromise =
    q && q.length >= minQueryLength
      ? supabase
          .from("leads")
          .select(SALES_LEAD_LOOKUP_SELECT)
          .or(
            [`member_name.ilike.${buildSupabaseIlikePattern(q)}`, `caregiver_name.ilike.${buildSupabaseIlikePattern(q)}`].join(",")
          )
          .order("created_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] as SalesLeadLookupRow[], error: null } as const);

  const [selectedLeadResult, matchesResult] = await Promise.all([selectedLeadPromise, matchesPromise]);
  if (selectedLeadResult.error) throw new Error(selectedLeadResult.error.message);
  if (matchesResult.error) throw new Error(matchesResult.error.message);

  const seen = new Set<string>();
  return [selectedLeadResult.data, ...((matchesResult.data ?? []) as Array<Record<string, unknown> | null>)]
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => toSalesLeadLookupRow(row))
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => ({
      id: row.id,
      member_name: row.member_name,
      stage: row.stage,
      partner_id: row.partner_id,
      referral_source_id: row.referral_source_id
    }));
}

export async function listSalesPartnerPickerOptionsSupabase(input?: {
  q?: string;
  selectedId?: string | null;
  limit?: number;
  minQueryLength?: number;
}): Promise<SalesPartnerPickerRow[]> {
  const q = clean(input?.q);
  const limit = normalizePageSize(input?.limit ?? 25, 25);
  const minQueryLength =
    Number.isFinite(input?.minQueryLength) && Number(input?.minQueryLength) > 0
      ? Math.floor(Number(input?.minQueryLength))
      : 2;
  const selectedId = clean(input?.selectedId);
  const supabase = await createClient();
  const selectedPartnerPromise = selectedId ? fetchPartnerByIdSupabase(selectedId) : Promise.resolve(null);
  const matchesPromise =
    q && q.length >= minQueryLength ? listSalesPartnerRowsSupabase(supabase, { q, limit }) : Promise.resolve({ rows: [] as SalesPartnerRow[], count: null });

  const [selectedPartner, matchesResult] = await Promise.all([selectedPartnerPromise, matchesPromise]);

  const seen = new Set<string>();
  return [selectedPartner, ...matchesResult.rows]
    .filter((row): row is SalesPartnerRow => Boolean(row))
    .map((row) => ({
      id: row.id,
      partner_id: row.partner_id,
      organization_name: row.organization_name
    }))
    .filter((row) => {
      if (!row.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
}

export async function getSalesFormLookupsSupabase(options?: {
  includeLeads?: boolean;
  includePartners?: boolean;
  includeReferralSources?: boolean;
  prefetchPartnerOptions?: boolean;
  leadLimit?: number;
  includeLeadId?: string | null;
  includePartnerId?: string | null;
  includeReferralSourceId?: string | null;
  referralPartnerId?: string | null;
}) {
  const leadLimit = normalizePageSize(options?.leadLimit ?? SALES_LEAD_LOOKUP_DEFAULT_LIMIT, SALES_LEAD_LOOKUP_DEFAULT_LIMIT);
  const shouldLoadLeads = options?.includeLeads !== false;
  const requestedPartnerId = clean(options?.includePartnerId);
  const shouldLoadPartners = options?.includePartners === true && options?.prefetchPartnerOptions === true;
  const shouldLoadReferralSources = options?.includeReferralSources !== false;
  const requestedReferralSourceId = clean(options?.includeReferralSourceId);
  const referralPartner = shouldLoadReferralSources && options?.referralPartnerId
    ? await getSalesPartnerByIdOrCodeSupabase(options.referralPartnerId)
    : null;
  const shouldPrefetchReferralSources = shouldLoadReferralSources && Boolean(referralPartner?.id);
  const supabase = await createClient();
  const [leadResult, partnersResult, referralSourcesResult] = await Promise.all([
    shouldLoadLeads
      ? supabase.from("leads").select(SALES_LEAD_LOOKUP_SELECT).order("created_at", { ascending: false }).limit(leadLimit)
      : Promise.resolve({ data: [] as SalesLeadLookupRow[], error: null }),
    shouldLoadPartners
      ? listSalesPartnerRowsSupabase(supabase, { limit: SALES_LOOKUP_PARTNER_LIMIT })
      : Promise.resolve({ rows: [] as SalesPartnerRow[], count: null }),
    shouldPrefetchReferralSources
      ? listSalesReferralSourceRowsSupabase(supabase, {
          partnerId: referralPartner?.id ?? null,
          limit: SALES_LOOKUP_REFERRAL_SOURCE_LIMIT
        })
      : Promise.resolve({ rows: [] as SalesReferralSourceRow[], count: null })
  ]);
  if (leadResult.error) throw new Error(leadResult.error.message);

  const leadRows = [...((leadResult.data ?? []) as SalesLeadLookupRow[])];
  const partnerRows = [...partnersResult.rows];
  const referralRows = [...referralSourcesResult.rows];

  const [extraLead, extraPartner, extraReferralSource] = await Promise.all([
    options?.includeLeadId && !leadRows.some((row) => row.id === options.includeLeadId)
      ? getSalesLeadByIdSupabase(options.includeLeadId)
      : Promise.resolve(null),
    requestedPartnerId && !partnerRows.some((row) => row.id === requestedPartnerId || row.partner_id === requestedPartnerId)
      ? fetchPartnerByIdSupabase(requestedPartnerId)
      : Promise.resolve(null),
    requestedReferralSourceId && !referralRows.some((row) => row.id === requestedReferralSourceId)
      ? fetchReferralSourceByIdSupabase(requestedReferralSourceId)
      : Promise.resolve(null)
  ]);
  const selectedReferralPartnerId = clean(extraReferralSource?.partner_id);
  const hasSelectedReferralPartner =
    Boolean(selectedReferralPartnerId) &&
    partnerRows.some((row) => row.id === selectedReferralPartnerId || row.partner_id === selectedReferralPartnerId);
  const selectedReferralPartner =
    selectedReferralPartnerId && !hasSelectedReferralPartner ? await fetchPartnerByIdSupabase(selectedReferralPartnerId) : null;

  if (extraLead) {
    leadRows.unshift({
      id: extraLead.id,
      member_name: extraLead.member_name,
      caregiver_name: extraLead.caregiver_name,
      stage: extraLead.stage,
      status: extraLead.status,
      created_at: extraLead.created_at,
      partner_id: extraLead.partner_id,
      referral_source_id: extraLead.referral_source_id
    });
  }
  if (extraPartner) partnerRows.unshift(extraPartner);
  if (selectedReferralPartner && !partnerRows.some((row) => row.id === selectedReferralPartner.id)) {
    partnerRows.unshift(selectedReferralPartner);
  }
  if (extraReferralSource) referralRows.unshift(extraReferralSource);

  return {
    leads: leadRows.map((row) => ({
      ...row,
      member_name: row.member_name ?? "Unnamed Lead"
    })),
    partners: partnerRows,
    referralSources: normalizeReferralSources(partnerRows, referralRows).map((row) => ({
      ...row,
      organization_name: row.organization_name ?? "Unknown Organization"
    }))
  };
}

export async function getSalesActivityContextLookupsSupabase(input?: { leadIds?: string[]; partnerIds?: string[]; referralSourceIds?: string[] }) {
  const leadIds = normalizeUuidList(input?.leadIds ?? []);
  const partnerIds = normalizeUuidList(input?.partnerIds ?? []);
  const referralSourceIds = normalizeUuidList(input?.referralSourceIds ?? []);
  const supabase = await createClient();
  const [leadResult, partnerResult, referralResult] = await Promise.all([
    leadIds.length > 0
      ? supabase.from("leads").select("id, member_name").in("id", leadIds)
      : Promise.resolve({ data: [] as SalesLeadLookupRow[], error: null } as const),
    partnerIds.length > 0 ? listSalesPartnerRowsSupabase(supabase, { ids: partnerIds }) : Promise.resolve({ rows: [] as SalesPartnerRow[], count: null }),
    referralSourceIds.length > 0
      ? listSalesReferralSourceRowsSupabase(supabase, { ids: referralSourceIds })
      : Promise.resolve({ rows: [] as SalesReferralSourceRow[], count: null })
  ]);
  if (leadResult.error) throw new Error(leadResult.error.message);

  const leads = ((leadResult.data ?? []) as SalesLeadLookupRow[]).map((row) => ({
    ...row,
    member_name: row.member_name ?? "Unnamed Lead"
  }));
  const partners = partnerResult.rows;
  const referralSources = normalizeReferralSources(partners, referralResult.rows).map(
    (row) => ({
      ...row,
      organization_name: row.organization_name ?? "Unknown Organization"
    })
  );
  return { leads, partners, referralSources };
}

export async function getSalesHomeSnapshotSupabase() {
  const summary = await getSalesDashboardSummarySupabase();
  if (!summary) throw new Error("Sales dashboard summary RPC returned no rows.");

  return {
    openLeadCount: toNumber(summary.open_lead_count),
    leadActivityCount: toNumber(summary.lead_activity_count),
    partnerCount: toNumber(summary.partner_count),
    referralSourceCount: toNumber(summary.referral_source_count),
    partnerActivityCount: toNumber(summary.partner_activity_count)
  };
}

export async function getSalesSummarySnapshotSupabase(): Promise<SalesSummarySnapshot> {
  const thirtyDaysAgo = toEasternDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const dashboardSummary = await getSalesDashboardSummarySupabase({ recentInquiryStartDate: thirtyDaysAgo });
  if (!dashboardSummary) throw new Error("Sales dashboard summary RPC returned no rows.");

  return {
    totalLeadCount: toNumber(dashboardSummary.total_lead_count),
    openLeadCount: toNumber(dashboardSummary.open_lead_count),
    eipLeadCount: toNumber(dashboardSummary.eip_lead_count),
    wonLeadCount: toNumber(dashboardSummary.won_lead_count),
    lostLeadCount: toNumber(dashboardSummary.lost_lead_count),
    convertedOrEnrolledCount: toNumber(dashboardSummary.converted_or_enrolled_count),
    recentInquiryActivityCount: toNumber(dashboardSummary.recent_inquiry_activity_count),
    recentInquiries: normalizeDashboardRecentInquiries(dashboardSummary.recent_inquiries),
    stageCounts: normalizeSalesPipelineStageCounts(dashboardSummary.stage_counts)
  };
}

export async function getSalesLeadListSupabase(input?: {
  status?: "open" | "won" | "lost";
  stage?: "Inquiry" | "Tour" | "Enrollment in Progress" | "Nurture";
  referralOnly?: boolean;
  q?: string;
  leadSource?: string;
  likelihood?: string;
  sort?: "member_name" | "stage" | "status" | "inquiry_date" | "caregiver_name" | "caregiver_relationship" | "lead_source" | "referral_name" | "likelihood" | "next_follow_up";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  limit?: number;
}): Promise<SalesLeadListResult> {
  const supabase = await createClient();
  const page = normalizePage(input?.page);
  const hasPagination = Boolean(input?.pageSize || input?.limit);
  const pageSize = hasPagination ? normalizePageSize(input?.pageSize ?? input?.limit ?? 25, input?.limit ?? 25) : 0;
  let query = hasPagination ? supabase.from("leads").select(SALES_LEAD_READ_SELECT, { count: "exact" }) : supabase.from("leads").select(SALES_LEAD_READ_SELECT);

  if (input?.status) {
    query = input.status === "open" ? applyOpenLeadFilter(query) : query.eq("status", input.status);
  }
  if (input?.stage === "Enrollment in Progress") {
    query = query.in("stage", ["Enrollment in Progress", "EIP"]);
  } else if (input?.stage) {
    query = query.eq("stage", input.stage);
  }
  if (input?.referralOnly) query = query.ilike("lead_source", "%referral%");
  if (input?.leadSource) query = query.eq("lead_source", input.leadSource);
  if (input?.likelihood) query = query.eq("likelihood", input.likelihood);
  const q = clean(input?.q);
  if (q) {
    const pattern = buildSupabaseIlikePattern(q);
    query = query.or(`member_name.ilike.${pattern},caregiver_name.ilike.${pattern}`);
  }

  const sortColumn = input?.sort === "next_follow_up" ? "next_follow_up_date" : input?.sort || "inquiry_date";
  const ascending = input?.dir === "asc";
  query = query.order(sortColumn, { ascending, nullsFirst: false });
  if (sortColumn !== "member_name") query = query.order("member_name", { ascending: true });
  if (hasPagination) query = query.range((page - 1) * pageSize, page * pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => toSalesLeadReadRow(row));
  const totalRows = hasPagination ? count ?? rows.length : rows.length;
  const effectivePageSize = hasPagination ? pageSize : Math.max(rows.length, 1);
  return {
    rows,
    page: hasPagination ? page : 1,
    pageSize: effectivePageSize,
    totalRows,
    totalPages: hasPagination ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1
  };
}

export async function getSalesLeadFollowUpDashboardSupabase(input?: {
  page?: number;
  pageSize?: number;
}): Promise<SalesLeadFollowUpDashboardResult> {
  const today = toEasternDate();
  const [pageResult, summary] = await Promise.all([
    getSalesLeadListSupabase({
      status: "open",
      sort: "next_follow_up",
      dir: "asc",
      page: input?.page,
      pageSize: input?.pageSize
    }),
    getSalesDashboardSummarySupabase({ followUpAsOfDate: today })
  ]);
  if (!summary) throw new Error("Sales dashboard summary RPC returned no rows.");

  return {
    ...pageResult,
    summary: {
      overdue: toNumber(summary.follow_up_overdue_count),
      dueToday: toNumber(summary.follow_up_due_today_count),
      upcoming: toNumber(summary.follow_up_upcoming_count),
      missingDate: toNumber(summary.follow_up_missing_date_count)
    }
  };
}

export async function getSalesRecentActivitySnapshotSupabase(options?: {
  leadId?: string | null;
  includeLeadActivities?: boolean;
  includePartnerActivities?: boolean;
}): Promise<SalesRecentActivitySnapshot> {
  const supabase = await createClient();
  const includeLeadActivities = options?.includeLeadActivities !== false;
  const includePartnerActivities = options?.includePartnerActivities !== false;
  let leadActivitiesQuery = supabase
    .from("lead_activities")
    .select("id, lead_id, activity_at, activity_type, outcome, lost_reason, next_follow_up_date, next_follow_up_type, completed_by_name, notes, member_name")
    .order("activity_at", { ascending: false })
    .limit(100);
  if (options?.leadId) {
    leadActivitiesQuery = leadActivitiesQuery.eq("lead_id", options.leadId);
  }
  const [leadActivitiesResult, partnerActivitiesResult] = await Promise.all([
    includeLeadActivities
      ? leadActivitiesQuery
      : Promise.resolve({ data: [] as SalesLeadActivityRow[], error: null } as const),
    includePartnerActivities
      ? supabase
          .from("partner_activities")
          .select("id, partner_id, referral_source_id, lead_id, organization_name, contact_name, activity_at, activity_type, next_follow_up_date, next_follow_up_type, completed_by, completed_by_name, notes")
          .order("activity_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] as SalesPartnerActivityRow[], error: null } as const)
  ]);
  if (leadActivitiesResult.error) throw new Error(leadActivitiesResult.error.message);
  if (partnerActivitiesResult.error) throw new Error(partnerActivitiesResult.error.message);

  return {
    activities: (leadActivitiesResult.data ?? []) as SalesLeadActivityRow[],
    partnerActivities: ((partnerActivitiesResult.data ?? []) as SalesPartnerActivityRow[]).map((activity) => ({
      ...activity,
      completed_by: activity.completed_by ?? activity.completed_by_name ?? null
    }))
  };
}

export async function getSalesPartnerDirectoryPageSupabase(input?: { q?: string; page?: number; pageSize?: number }) {
  const supabase = await createClient();
  const page = normalizePage(input?.page);
  const pageSize = normalizePageSize(input?.pageSize ?? 25, 25);
  const { rows, count } = await listSalesPartnerRowsSupabase(supabase, {
    count: "exact",
    q: input?.q,
    range: {
      start: (page - 1) * pageSize,
      end: page * pageSize - 1
    }
  });
  return {
    rows,
    page,
    pageSize,
    totalRows: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize))
  };
}

export async function getSalesReferralSourceDirectoryPageSupabase(input?: { q?: string; page?: number; pageSize?: number }) {
  const supabase = await createClient();
  const page = normalizePage(input?.page);
  const pageSize = normalizePageSize(input?.pageSize ?? 25, 25);
  const { rows: referralSources, count } = await listSalesReferralSourceRowsSupabase(supabase, {
    count: "exact",
    q: input?.q,
    range: {
      start: (page - 1) * pageSize,
      end: page * pageSize - 1
    }
  });
  const partnerIds = Array.from(new Set(referralSources.map((row) => row.partner_id).filter(Boolean)));
  const partners = partnerIds.length > 0 ? (await listSalesPartnerRowsSupabase(supabase, { ids: partnerIds })).rows : [];
  return {
    rows: normalizeReferralSources(partners, referralSources),
    page,
    pageSize,
    totalRows: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize))
  };
}

export async function getSalesReferralSourcesForPartnerIdsSupabase(partnerIds: string[]) {
  if (partnerIds.length === 0) return [] as SalesReferralSourceRow[];
  const supabase = await createClient();
  const [partnersResult, referralSourcesResult] = await Promise.all([
    listSalesPartnerRowsSupabase(supabase, { ids: partnerIds }),
    listSalesReferralSourceRowsSupabase(supabase, { partnerIds })
  ]);
  return normalizeReferralSources(partnersResult.rows, referralSourcesResult.rows);
}
