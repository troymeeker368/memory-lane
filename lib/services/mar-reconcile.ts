import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { normalizeGenerationWindow } from "@/lib/services/mar-workflow-core";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import { toEasternISO } from "@/lib/timezone";

const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";
const MAR_RPC_MIGRATION = "0056_shared_rpc_orchestration_hardening.sql";

type MarReconcileRpcRow = {
  inserted_schedules: number;
  patched_schedules: number;
  reactivated_schedules: number;
  deactivated_schedules: number;
};

export async function reconcileMarSchedulesForMember(input: {
  memberId: string;
  startDate?: string | null;
  endDate?: string | null;
  serviceRole?: boolean;
  actionLabel?: string;
}) {
  const serviceRole = input.serviceRole ?? true;
  const memberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: input.actionLabel ?? "reconcileMarSchedulesForMember",
    serviceRole
  });
  const { startDate, endDate } = normalizeGenerationWindow(input.startDate, input.endDate);
  const supabase = await createClient({ serviceRole });

  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, MAR_RECONCILE_RPC, {
      p_member_id: memberId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_preferred_physician_order_id: null,
      p_now: toEasternISO()
    });
    const row = (Array.isArray(data) ? data[0] : null) as MarReconcileRpcRow | null;
    return {
      inserted: Number(row?.inserted_schedules ?? 0),
      patched: Number(row?.patched_schedules ?? 0),
      reactivated: Number(row?.reactivated_schedules ?? 0),
      deactivated: Number(row?.deactivated_schedules ?? 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconcile MAR schedules.";
    if (message.includes(MAR_RECONCILE_RPC)) {
      throw new Error(
        `MAR reconciliation RPC is not available. Apply Supabase migration ${MAR_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}
