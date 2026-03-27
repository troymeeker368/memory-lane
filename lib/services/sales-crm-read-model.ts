import { isEnrollmentPacketEligibleLeadState, resolveCanonicalLeadState } from "@/lib/canonical";
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

const SALES_LEAD_LOOKUP_SELECT = "id, member_name, caregiver_name, stage, status, created_at, partner_id, referral_source_id";
const SALES_PARTNER_LOOKUP_SELECT =
  "id, partner_id, organization_name, category, location, primary_phone, primary_email, active, last_touched";
const SALES_REFERRAL_SOURCE_LOOKUP_SELECT =
  "id, referral_source_id, partner_id, contact_name, organization_name, job_title, primary_phone, primary_email, preferred_contact_method, active, last_touched";
const SALES_LEAD_LOOKUP_DEFAULT_LIMIT = 120;
const SALES_LOOKUP_PARTNER_LIMIT = 250;
const SALES_LOOKUP_REFERRAL_SOURCE_LIMIT = 250;
const ENROLLMENT_PACKET_ELIGIBLE_QUERY_STAGES = ["Tour", "Enrollment in Progress", "EIP", "Nurture"] as const;

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

export async function listEnrollmentPacketEligibleLeadsSupabase(input?: {
  limit?: number;
}) {
  const limit = normalizePageSize(input?.limit ?? 500, 500);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(SALES_LEAD_READ_SELECT)
    .eq("status", "open")
    .in("stage", [...ENROLLMENT_PACKET_ELIGIBLE_QUERY_STAGES])
    .order("inquiry_date", { ascending: false, nullsFirst: false })
    .order("member_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map((row) => toSalesLeadReadRow(row))
    .filter((row) =>
      isEnrollmentPacketEligibleLeadState({
        requestedStage: row.stage,
        requestedStatus: row.status
      })
    );
}

export async function getSalesFormLookupsSupabase(options?: {
  includeLeads?: boolean;
  leadLimit?: number;
  includeLeadId?: string | null;
  includePartnerId?: string | null;
  includeReferralSourceId?: string | null;
}) {
  const leadLimit = normalizePageSize(options?.leadLimit ?? SALES_LEAD_LOOKUP_DEFAULT_LIMIT, SALES_LEAD_LOOKUP_DEFAULT_LIMIT);
  const shouldLoadLeads = options?.includeLeads !== false || Boolean(options?.includeLeadId);
  const supabase = await createClient();
  const [leadResult, { data: partners, error: partnersError }, { data: referralSources, error: referralSourcesError }] = await Promise.all([
    shouldLoadLeads
      ? supabase.from("leads").select(SALES_LEAD_LOOKUP_SELECT).order("created_at", { ascending: false }).limit(leadLimit)
      : Promise.resolve({ data: [] as SalesLeadLookupRow[], error: null }),
    supabase
      .from("community_partner_organizations")
      .select(SALES_PARTNER_LOOKUP_SELECT)
      .order("organization_name", { ascending: true })
      .limit(SALES_LOOKUP_PARTNER_LIMIT),
    supabase
      .from("referral_sources")
      .select(SALES_REFERRAL_SOURCE_LOOKUP_SELECT)
      .order("organization_name", { ascending: true })
      .limit(SALES_LOOKUP_REFERRAL_SOURCE_LIMIT)
  ]);
  if (leadResult.error) throw new Error(leadResult.error.message);
  if (partnersError) throw new Error(partnersError.message);
  if (referralSourcesError) throw new Error(referralSourcesError.message);

  const leadRows = [...((leadResult.data ?? []) as SalesLeadLookupRow[])];
  const partnerRows = [...(partners as SalesPartnerRow[])];
  const referralRows = [...(referralSources as SalesReferralSourceRow[])];

  const [extraLead, extraPartner, extraReferralSource] = await Promise.all([
    options?.includeLeadId && !leadRows.some((row) => row.id === options.includeLeadId)
      ? getSalesLeadByIdSupabase(options.includeLeadId)
      : Promise.resolve(null),
    options?.includePartnerId && !partnerRows.some((row) => row.id === options.includePartnerId)
      ? fetchPartnerByIdSupabase(options.includePartnerId)
      : Promise.resolve(null),
    options?.includeReferralSourceId && !referralRows.some((row) => row.id === options.includeReferralSourceId)
      ? fetchReferralSourceByIdSupabase(options.includeReferralSourceId)
      : Promise.resolve(null)
  ]);

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
    partnerIds.length > 0
      ? supabase
          .from("community_partner_organizations")
          .select(SALES_PARTNER_LOOKUP_SELECT)
          .in("id", partnerIds)
      : Promise.resolve({ data: [] as SalesPartnerRow[], error: null } as const),
    referralSourceIds.length > 0
      ? supabase.from("referral_sources").select(SALES_REFERRAL_SOURCE_LOOKUP_SELECT).in("id", referralSourceIds)
      : Promise.resolve({ data: [] as SalesReferralSourceRow[], error: null } as const)
  ]);
  if (leadResult.error) throw new Error(leadResult.error.message);
  if (partnerResult.error) throw new Error(partnerResult.error.message);
  if (referralResult.error) throw new Error(referralResult.error.message);

  const leads = ((leadResult.data ?? []) as SalesLeadLookupRow[]).map((row) => ({
    ...row,
    member_name: row.member_name ?? "Unnamed Lead"
  }));
  const partners = ((partnerResult.data ?? []) as SalesPartnerRow[]).map((partner) => ({
    ...partner,
    organization_name: partner.organization_name ?? "Unknown Organization"
  }));
  const referralSources = normalizeReferralSources(partners, (referralResult.data ?? []) as SalesReferralSourceRow[]).map(
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

async function countOpenLeadsByFollowUpBucket(input: {
  today: string;
  bucket: "overdue" | "due_today" | "upcoming" | "missing_date";
}) {
  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");

  if (input.bucket === "overdue") {
    query = query.lt("next_follow_up_date", input.today);
  } else if (input.bucket === "due_today") {
    query = query.eq("next_follow_up_date", input.today);
  } else if (input.bucket === "upcoming") {
    query = query.gt("next_follow_up_date", input.today);
  } else {
    query = query.is("next_follow_up_date", null);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

export async function getSalesLeadFollowUpDashboardSupabase(input?: {
  page?: number;
  pageSize?: number;
}): Promise<SalesLeadFollowUpDashboardResult> {
  const today = toEasternDate();
  const [pageResult, overdue, dueToday, upcoming, missingDate] = await Promise.all([
    getSalesLeadListSupabase({
      status: "open",
      sort: "next_follow_up",
      dir: "asc",
      page: input?.page,
      pageSize: input?.pageSize
    }),
    countOpenLeadsByFollowUpBucket({ today, bucket: "overdue" }),
    countOpenLeadsByFollowUpBucket({ today, bucket: "due_today" }),
    countOpenLeadsByFollowUpBucket({ today, bucket: "upcoming" }),
    countOpenLeadsByFollowUpBucket({ today, bucket: "missing_date" })
  ]);

  return {
    ...pageResult,
    summary: {
      overdue,
      dueToday,
      upcoming,
      missingDate
    }
  };
}

export async function getSalesRecentActivitySnapshotSupabase(options?: { leadId?: string | null }) {
  const supabase = await createClient();
  let leadActivitiesQuery = supabase
    .from("lead_activities")
    .select("id, lead_id, activity_at, activity_type, outcome, lost_reason, next_follow_up_date, next_follow_up_type, completed_by_name, notes, member_name")
    .order("activity_at", { ascending: false })
    .limit(100);
  if (options?.leadId) {
    leadActivitiesQuery = leadActivitiesQuery.eq("lead_id", options.leadId);
  }
  const [leadActivitiesResult, partnerActivitiesResult] = await Promise.all([
    leadActivitiesQuery,
    supabase
      .from("partner_activities")
      .select("id, partner_id, referral_source_id, lead_id, organization_name, contact_name, activity_at, activity_type, next_follow_up_date, next_follow_up_type, completed_by, completed_by_name, notes")
      .order("activity_at", { ascending: false })
      .limit(100)
  ]);
  if (leadActivitiesResult.error) throw new Error(leadActivitiesResult.error.message);
  if (partnerActivitiesResult.error) throw new Error(partnerActivitiesResult.error.message);

  return {
    activities: leadActivitiesResult.data ?? [],
    partnerActivities: (partnerActivitiesResult.data ?? []).map((activity) => ({
      ...activity,
      completed_by: activity.completed_by ?? activity.completed_by_name ?? null
    }))
  };
}

export async function getSalesPartnerDirectoryPageSupabase(input?: { q?: string; page?: number; pageSize?: number }) {
  const supabase = await createClient();
  const page = normalizePage(input?.page);
  const pageSize = normalizePageSize(input?.pageSize ?? 25, 25);
  let query = supabase
    .from("community_partner_organizations")
    .select(SALES_PARTNER_LOOKUP_SELECT, { count: "exact" })
    .order("organization_name", { ascending: true });
  const q = clean(input?.q);
  if (q) {
    const pattern = buildSupabaseIlikePattern(q);
    query = query.or(
      `organization_name.ilike.${pattern},category.ilike.${pattern},location.ilike.${pattern},primary_phone.ilike.${pattern},primary_email.ilike.${pattern}`
    );
  }
  query = query.range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return {
    rows: (data ?? []) as SalesPartnerRow[],
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
  let query = supabase
    .from("referral_sources")
    .select(SALES_REFERRAL_SOURCE_LOOKUP_SELECT, { count: "exact" })
    .order("organization_name", { ascending: true });
  const q = clean(input?.q);
  if (q) {
    const pattern = buildSupabaseIlikePattern(q);
    query = query.or(
      `contact_name.ilike.${pattern},organization_name.ilike.${pattern},job_title.ilike.${pattern},primary_phone.ilike.${pattern},primary_email.ilike.${pattern},preferred_contact_method.ilike.${pattern}`
    );
  }
  query = query.range((page - 1) * pageSize, page * pageSize - 1);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const referralSources = (data ?? []) as SalesReferralSourceRow[];
  const partnerIds = Array.from(new Set(referralSources.map((row) => row.partner_id).filter(Boolean)));
  let partners: SalesPartnerRow[] = [];
  if (partnerIds.length > 0) {
    const { data: partnerData, error: partnersError } = await supabase
      .from("community_partner_organizations")
      .select(SALES_PARTNER_LOOKUP_SELECT)
      .in("id", partnerIds);
    if (partnersError) throw new Error(partnersError.message);
    partners = (partnerData ?? []) as SalesPartnerRow[];
  }
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
  const [{ data: partners, error: partnersError }, { data: referralSources, error: referralSourcesError }] = await Promise.all([
    supabase
      .from("community_partner_organizations")
      .select("id, partner_id, organization_name, category, location, primary_phone, primary_email, active, last_touched")
      .in("id", partnerIds),
    supabase
      .from("referral_sources")
      .select(SALES_REFERRAL_SOURCE_LOOKUP_SELECT)
      .in("partner_id", partnerIds)
      .order("organization_name", { ascending: true })
  ]);
  if (partnersError) throw new Error(partnersError.message);
  if (referralSourcesError) throw new Error(referralSourcesError.message);
  return normalizeReferralSources((partners ?? []) as SalesPartnerRow[], (referralSources ?? []) as SalesReferralSourceRow[]);
}
