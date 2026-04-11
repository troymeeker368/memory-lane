import "server-only";

import type {
  getBillingBatches as getBillingBatchesImpl,
  getBillingBatchReviewRows as getBillingBatchReviewRowsImpl,
  getBillingDashboardSummary as getBillingDashboardSummaryImpl,
  getBillingExports as getBillingExportsImpl,
  getBillingGenerationPreview as getBillingGenerationPreviewImpl,
  getBillingMemberPayorLookups as getBillingMemberPayorLookupsImpl,
  getBillingModuleIndex as getBillingModuleIndexImpl,
  getCustomInvoices as getCustomInvoicesImpl,
  getDraftInvoices as getDraftInvoicesImpl,
  getFinalizedInvoices as getFinalizedInvoicesImpl,
  listAllDraftInvoiceIds as listAllDraftInvoiceIdsImpl,
  getVariableChargesQueue as getVariableChargesQueueImpl,
  listBillingScheduleTemplates as listBillingScheduleTemplatesImpl,
  listCenterClosures as listCenterClosuresImpl,
  listClosureRules as listClosureRulesImpl,
  listMemberBillingSettings as listMemberBillingSettingsImpl,
  listPayors as listPayorsImpl
} from "@/lib/services/billing-read-supabase";
export { CENTER_CLOSURE_TYPE_OPTIONS } from "@/lib/services/billing-read-supabase";

type GetVariableChargesQueueInput = Parameters<typeof getVariableChargesQueueImpl>[0];
type GetCustomInvoicesInput = Parameters<typeof getCustomInvoicesImpl>[0];
type GetDraftInvoicesInput = Parameters<typeof getDraftInvoicesImpl>[0];
type GetFinalizedInvoicesInput = Parameters<typeof getFinalizedInvoicesImpl>[0];
type ListCenterClosuresInput = Parameters<typeof listCenterClosuresImpl>[0];
type GetBillingBatchReviewRowsInput = Parameters<typeof getBillingBatchReviewRowsImpl>[0];
type GetBillingGenerationPreviewInput = Parameters<typeof getBillingGenerationPreviewImpl>[0];

export async function listPayors(): ReturnType<typeof listPayorsImpl> {
  const { listPayors } = await import("@/lib/services/billing-read-supabase");
  return listPayors();
}

export async function listClosureRules(): ReturnType<typeof listClosureRulesImpl> {
  const { listClosureRules } = await import("@/lib/services/billing-read-supabase");
  return listClosureRules();
}

export async function listCenterClosures(input?: ListCenterClosuresInput): ReturnType<typeof listCenterClosuresImpl> {
  const { listCenterClosures } = await import("@/lib/services/billing-read-supabase");
  return listCenterClosures(input);
}

export async function listMemberBillingSettings(): ReturnType<typeof listMemberBillingSettingsImpl> {
  const { listMemberBillingSettings } = await import("@/lib/services/billing-read-supabase");
  return listMemberBillingSettings();
}

export async function listBillingScheduleTemplates(): ReturnType<typeof listBillingScheduleTemplatesImpl> {
  const { listBillingScheduleTemplates } = await import("@/lib/services/billing-read-supabase");
  return listBillingScheduleTemplates();
}

export async function getBillingMemberPayorLookups(): ReturnType<typeof getBillingMemberPayorLookupsImpl> {
  const { getBillingMemberPayorLookups } = await import("@/lib/services/billing-read-supabase");
  return getBillingMemberPayorLookups();
}

export async function getDraftInvoices(input?: GetDraftInvoicesInput): ReturnType<typeof getDraftInvoicesImpl> {
  const { getDraftInvoices } = await import("@/lib/services/billing-read-supabase");
  return getDraftInvoices(input);
}

export async function getFinalizedInvoices(input?: GetFinalizedInvoicesInput): ReturnType<typeof getFinalizedInvoicesImpl> {
  const { getFinalizedInvoices } = await import("@/lib/services/billing-read-supabase");
  return getFinalizedInvoices(input);
}

export async function getCustomInvoices(input?: GetCustomInvoicesInput): ReturnType<typeof getCustomInvoicesImpl> {
  const { getCustomInvoices } = await import("@/lib/services/billing-read-supabase");
  return getCustomInvoices(input);
}

export async function listAllDraftInvoiceIds(): ReturnType<typeof listAllDraftInvoiceIdsImpl> {
  const { listAllDraftInvoiceIds } = await import("@/lib/services/billing-read-supabase");
  return listAllDraftInvoiceIds();
}

export async function getVariableChargesQueue(input: GetVariableChargesQueueInput): ReturnType<typeof getVariableChargesQueueImpl> {
  const { getVariableChargesQueue } = await import("@/lib/services/billing-read-supabase");
  return getVariableChargesQueue(input);
}

export async function getBillingBatches(): ReturnType<typeof getBillingBatchesImpl> {
  const { getBillingBatches } = await import("@/lib/services/billing-read-supabase");
  return getBillingBatches();
}

export async function getBillingBatchReviewRows(
  billingBatchId: GetBillingBatchReviewRowsInput
): ReturnType<typeof getBillingBatchReviewRowsImpl> {
  const { getBillingBatchReviewRows } = await import("@/lib/services/billing-read-supabase");
  return getBillingBatchReviewRows(billingBatchId);
}

export async function getBillingGenerationPreview(
  input: GetBillingGenerationPreviewInput
): ReturnType<typeof getBillingGenerationPreviewImpl> {
  const { getBillingGenerationPreview } = await import("@/lib/services/billing-read-supabase");
  return getBillingGenerationPreview(input);
}

export async function getBillingExports(): ReturnType<typeof getBillingExportsImpl> {
  const { getBillingExports } = await import("@/lib/services/billing-read-supabase");
  return getBillingExports();
}

export async function getBillingDashboardSummary(): ReturnType<typeof getBillingDashboardSummaryImpl> {
  const { getBillingDashboardSummary } = await import("@/lib/services/billing-read-supabase");
  return getBillingDashboardSummary();
}

export async function getBillingModuleIndex(): ReturnType<typeof getBillingModuleIndexImpl> {
  const { getBillingModuleIndex } = await import("@/lib/services/billing-read-supabase");
  return getBillingModuleIndex();
}
