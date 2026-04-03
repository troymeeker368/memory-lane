import { normalizeRoleKey } from "@/lib/permissions";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

interface AncillaryScope {
  role?: AppRole;
  staffUserId?: string | null;
}

function isAutomatedLatePickupCategoryName(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.includes("late pick-up") || normalized.includes("late pickup");
}

function normalizeMonthKey(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return raw;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.slice(0, 7);
  }
  return "";
}

function monthKeyFromDate(value: string | null | undefined) {
  return normalizeMonthKey(value);
}

function monthKeyLabel(monthKey: string) {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return monthKey;

  const [yearPart, monthPart] = normalized.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return monthKey;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
  return formatter.format(new Date(Date.UTC(year, monthIndex, 1))).replace(" ", "-");
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeCategoryKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function asCents(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
}

function asQuantity(value: number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeLogRow(log: Partial<MemberAncillaryChargeLogRow>): MemberAncillaryChargeLogRow {
  return {
    id: String(log.id ?? ""),
    member_id: log.member_id ?? null,
    member_name: log.member_name ?? "Unknown Member",
    service_date: log.service_date ?? "",
    category_name: log.category_name ?? "Uncategorized",
    category_id: log.category_id ?? null,
    amount_cents: asCents(log.amount_cents),
    quantity: asQuantity(log.quantity),
    notes: log.notes ?? null,
    source_entity: log.source_entity ?? null,
    source_entity_id: log.source_entity_id ?? null,
    reconciliation_status: log.reconciliation_status ?? null,
    reconciled_by: log.reconciled_by ?? null,
    reconciled_at: log.reconciled_at ?? null,
    reconciliation_note: log.reconciliation_note ?? null,
    staff_name: log.staff_name ?? null,
    staff_user_id: log.staff_user_id ?? null,
    late_pickup_time: log.late_pickup_time ?? null,
    created_at: log.created_at ?? ""
  };
}

type AncillaryCategoryRow = {
  id: string;
  name: string;
  price_cents: number | null;
};

export type MemberAncillaryChargeLogRow = {
  id: string;
  member_id: string | null;
  member_name: string;
  service_date: string;
  category_name: string;
  category_id: string | null;
  amount_cents: number;
  quantity: number;
  notes: string | null;
  source_entity: string | null;
  source_entity_id: string | null;
  reconciliation_status: string | null;
  reconciled_by: string | null;
  reconciled_at: string | null;
  reconciliation_note: string | null;
  staff_name: string | null;
  staff_user_id: string | null;
  late_pickup_time: string | null;
  created_at: string;
};

export type AncillaryCategoryColumn = {
  id: string;
  name: string;
  isSynthetic?: boolean;
};

export type MonthlyAncillaryCategoryTotal = {
  categoryId: string;
  categoryName: string;
  totalCount: number;
  totalAmountCents: number;
  isSynthetic?: boolean;
};

export type MonthlyAncillaryMemberRow = {
  memberId: string | null;
  memberName: string;
  entryCount: number;
  subtotalCents: number;
  categoryAmounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  uncategorizedAmountCents: number;
  uncategorizedEntryCount: number;
};

export type MonthlyAncillarySummaryRow = {
  monthKey: string;
  monthLabel: string;
  categoryName: string;
  totalCount: number;
  totalAmountCents: number;
};

export type AncillarySummary = {
  categories: AncillaryCategoryRow[];
  categoryColumns: AncillaryCategoryColumn[];
  logs: MemberAncillaryChargeLogRow[];
  monthly: MonthlyAncillarySummaryRow[];
  availableMonths: string[];
  selectedMonth: string;
  monthlyByMember: MonthlyAncillaryMemberRow[];
  monthlyRows: MonthlyAncillaryMemberRow[];
  monthlyCategoryTotals: MonthlyAncillaryCategoryTotal[];
  monthlyGrandTotalCents: number;
  monthlyEntryCount: number;
};

function buildSummary(logs: MemberAncillaryChargeLogRow[], categories: AncillaryCategoryRow[], requestedMonth?: string): AncillarySummary {
  const filteredCategories = categories.filter((category) => !isAutomatedLatePickupCategoryName(category.name));
  const categoryLookupById = new Map(categories.map((category) => [category.id, category]));
  const categoryLookupByName = new Map(categories.map((category) => [normalizeCategoryKey(category.name), category]));

  const normalizedLogs = logs.map((log) => normalizeLogRow(log));

  const availableMonths = Array.from(
    new Set(
      normalizedLogs
        .map((log) => monthKeyFromDate(log.service_date))
        .filter((monthKey): monthKey is string => Boolean(monthKey))
    )
  ).sort((a, b) => b.localeCompare(a));

  const requestedMonthKey = normalizeMonthKey(requestedMonth);
  const selectedMonth = requestedMonthKey || availableMonths[0] || currentMonthKey();
  const monthSet = new Set(availableMonths);
  monthSet.add(selectedMonth);
  const allMonthOptions = Array.from(monthSet).sort((a, b) => b.localeCompare(a));

  const monthlyLogs = normalizedLogs.filter((log) => monthKeyFromDate(log.service_date) === selectedMonth);

  const categoryColumns: AncillaryCategoryColumn[] = categories.map((category) => ({
    id: category.id,
    name: category.name
  }));

  const memberMap = new Map<string, MonthlyAncillaryMemberRow>();
  const categoryTotalsMap = new Map<string, MonthlyAncillaryCategoryTotal>();
  const monthlySummaryMap = new Map<string, MonthlyAncillarySummaryRow>();
  const uncategorizedKey = "__uncategorized__";
  let uncategorizedRequired = false;

  for (const category of filteredCategories) {
    categoryTotalsMap.set(category.id, {
      categoryId: category.id,
      categoryName: category.name,
      totalCount: 0,
      totalAmountCents: 0
    });
  }

  let monthlyGrandTotalCents = 0;
  let monthlyEntryCount = 0;

  for (const log of monthlyLogs) {
    const monthKey = monthKeyFromDate(log.service_date);
    if (!monthKey) {
      continue;
    }

    const amountCents = asCents(log.amount_cents);
    const categoryMatch =
      (log.category_id && categoryLookupById.get(log.category_id)) ||
      categoryLookupByName.get(normalizeCategoryKey(log.category_name)) ||
      null;
    const categoryId = categoryMatch?.id ?? uncategorizedKey;
    const categoryName = categoryMatch?.name ?? "Uncategorized";

    if (!categoryMatch) {
      uncategorizedRequired = true;
    }

    monthlyGrandTotalCents += amountCents;
    monthlyEntryCount += 1;

    const memberKey = log.member_id ?? log.member_name ?? "unknown-member";
    const memberName = log.member_name ?? "Unknown Member";
    const memberRow = memberMap.get(memberKey) ?? {
      memberId: log.member_id ?? null,
      memberName,
      entryCount: 0,
      subtotalCents: 0,
      categoryAmounts: {},
      categoryCounts: {},
      uncategorizedAmountCents: 0,
      uncategorizedEntryCount: 0
    };

    memberRow.entryCount += 1;
    memberRow.subtotalCents += amountCents;
    if (categoryId === uncategorizedKey) {
      memberRow.uncategorizedAmountCents += amountCents;
      memberRow.uncategorizedEntryCount += 1;
    } else {
      memberRow.categoryAmounts[categoryId] = (memberRow.categoryAmounts[categoryId] ?? 0) + amountCents;
      memberRow.categoryCounts[categoryId] = (memberRow.categoryCounts[categoryId] ?? 0) + 1;
    }
    memberMap.set(memberKey, memberRow);

    const categoryTotal = categoryTotalsMap.get(categoryId);
    if (categoryTotal) {
      categoryTotal.totalCount += 1;
      categoryTotal.totalAmountCents += amountCents;
    } else {
      categoryTotalsMap.set(categoryId, {
        categoryId,
        categoryName,
        totalCount: 1,
        totalAmountCents: amountCents,
        isSynthetic: true
      });
    }

    const monthlySummaryKey = `${monthKey}:${categoryName}`;
    const existingMonthlySummary = monthlySummaryMap.get(monthlySummaryKey) ?? {
      monthKey,
      monthLabel: monthKeyLabel(monthKey),
      categoryName,
      totalCount: 0,
      totalAmountCents: 0
    };
    existingMonthlySummary.totalCount += 1;
    existingMonthlySummary.totalAmountCents += amountCents;
    monthlySummaryMap.set(monthlySummaryKey, existingMonthlySummary);
  }

  if (uncategorizedRequired) {
    categoryColumns.push({
      id: uncategorizedKey,
      name: "Uncategorized",
      isSynthetic: true
    });
    if (!categoryTotalsMap.has(uncategorizedKey)) {
      categoryTotalsMap.set(uncategorizedKey, {
        categoryId: uncategorizedKey,
        categoryName: "Uncategorized",
        totalCount: 0,
        totalAmountCents: 0,
        isSynthetic: true
      });
    }
  }

  const monthlyByMember = Array.from(memberMap.values()).sort((a, b) => {
    const nameCompare = a.memberName.localeCompare(b.memberName);
    if (nameCompare !== 0) return nameCompare;
    return b.subtotalCents - a.subtotalCents;
  });

  const monthlyCategoryTotals = categoryColumns.map((category) => {
    const total = categoryTotalsMap.get(category.id);
    return (
      total ?? {
        categoryId: category.id,
        categoryName: category.name,
        totalCount: 0,
        totalAmountCents: 0,
        isSynthetic: category.isSynthetic
      }
    );
  });

  const monthly = Array.from(monthlySummaryMap.values()).sort((a, b) => {
    const monthCompare = b.monthKey.localeCompare(a.monthKey);
    if (monthCompare !== 0) return monthCompare;
    return a.categoryName.localeCompare(b.categoryName);
  });

  return {
    categories: filteredCategories,
    categoryColumns,
    logs: normalizedLogs,
    monthly,
    availableMonths: allMonthOptions,
    selectedMonth,
    monthlyByMember,
    monthlyRows: monthlyByMember,
    monthlyCategoryTotals,
    monthlyGrandTotalCents,
    monthlyEntryCount
  };
}

export async function getAncillarySummary(monthKey?: string, scope?: AncillaryScope): Promise<AncillarySummary> {
  const supabase = await createClient();

  let logsQuery = supabase
    .from("v_ancillary_charge_logs_detailed")
    .select(
      "id, member_id, member_name, service_date, category_id, category_name, amount_cents, quantity, notes, source_entity, source_entity_id, reconciliation_status, reconciled_by, reconciled_at, reconciliation_note, staff_name, staff_user_id, late_pickup_time, created_at"
    )
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (scope?.role && normalizeRoleKey(scope.role) === "program-assistant") {
    if (!scope.staffUserId) {
      throw new Error("Program assistant users must include staffUserId for ancillary summary access.");
    }
    logsQuery = logsQuery.eq("staff_user_id", scope.staffUserId);
  }

  const { data: logsData, error: logsError } = await logsQuery;
  if (logsError) {
    if (isMissingSchemaObjectError(logsError)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "v_ancillary_charge_logs_detailed",
          migration: "0018_runtime_mock_dependency_cleanup.sql"
        })
      );
    }
    throw new Error(logsError.message);
  }

  const { data: categories, error: categoriesError } = await supabase
    .from("ancillary_charge_categories")
    .select("id, name, price_cents")
    .order("name");
  if (categoriesError) {
    if (isMissingSchemaObjectError(categoriesError)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "ancillary_charge_categories",
          migration: "0001_initial_schema.sql"
        })
      );
    }
    throw new Error(categoriesError.message);
  }

  return buildSummary((logsData ?? []) as MemberAncillaryChargeLogRow[], (categories ?? []) as AncillaryCategoryRow[], monthKey);
}

export async function listMemberAncillaryChargeLogs(
  input: {
    memberId: string;
    limit?: number;
  },
  scope?: AncillaryScope
) {
  const supabase = await createClient();
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "listMemberAncillaryChargeLogs"
  });

  let query = supabase
    .from("v_ancillary_charge_logs_detailed")
    .select("id, member_id, member_name, service_date, category_name, amount_cents, quantity, notes, source_entity, source_entity_id, reconciliation_status, reconciled_by, reconciled_at, reconciliation_note, staff_name, late_pickup_time, created_at")
    .eq("member_id", canonicalMemberId)
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (scope?.role && normalizeRoleKey(scope.role) === "program-assistant") {
    if (!scope.staffUserId) {
      throw new Error("Program assistant users must include staffUserId for ancillary member log access.");
    }
    query = query.eq("staff_user_id", scope.staffUserId);
  }
  if (typeof input.limit === "number" && input.limit > 0) {
    query = query.limit(input.limit);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "v_ancillary_charge_logs_detailed",
          migration: "0018_runtime_mock_dependency_cleanup.sql"
        })
      );
    }
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => normalizeLogRow(row));
}

export async function getAncillaryEntryCountLastDays(days = 30) {
  const supabase = await createClient();
  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
  const since = new Date();
  since.setDate(since.getDate() - (safeDays - 1));
  const sinceDate = since.toISOString().slice(0, 10);

  const { count, error } = await supabase
    .from("v_ancillary_charge_logs_detailed")
    .select("id", { head: true, count: "exact" })
    .gte("service_date", sinceDate);
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "v_ancillary_charge_logs_detailed",
          migration: "0018_runtime_mock_dependency_cleanup.sql"
        })
      );
    }
    throw new Error(error.message);
  }

  return count ?? 0;
}
