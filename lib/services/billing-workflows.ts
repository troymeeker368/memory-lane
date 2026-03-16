import "server-only";

import type {
  createBillingExport as createBillingExportImpl,
  syncAttendanceBillingForDate as syncAttendanceBillingForDateImpl
} from "@/lib/services/billing-supabase";

type CreateBillingExportInput = Parameters<typeof createBillingExportImpl>[0];
type SyncAttendanceBillingForDateInput = Parameters<typeof syncAttendanceBillingForDateImpl>[0];

export async function createBillingExport(input: CreateBillingExportInput) {
  const { createBillingExport } = await import("@/lib/services/billing-supabase");
  return createBillingExport(input);
}

export async function syncAttendanceBillingForDate(input: SyncAttendanceBillingForDateInput) {
  const { syncAttendanceBillingForDate } = await import("@/lib/services/billing-supabase");
  return syncAttendanceBillingForDate(input);
}
