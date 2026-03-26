import { clean } from "@/lib/services/enrollment-packet-core";
import type { EnrollmentPacketStatus } from "@/lib/services/enrollment-packet-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import type { SendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";

const TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC = "rpc_transition_enrollment_packet_delivery_state";
const ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";

export async function markEnrollmentPacketDeliveryState(input: {
  packetId: string;
  status?: EnrollmentPacketStatus;
  deliveryStatus: SendWorkflowDeliveryStatus;
  deliveryError?: string | null;
  sentAt?: string | null;
  openedAt?: string | null;
  attemptAt: string;
  expectedCurrentStatus?: EnrollmentPacketStatus | null;
}) {
  const admin = createSupabaseAdminClient();
  try {
    type TransitionResultRow = {
      packet_id: string;
      status: string;
      delivery_status: string;
      did_transition: boolean;
    };
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC, {
      p_packet_id: input.packetId,
      p_delivery_status: input.deliveryStatus,
      p_attempt_at: input.attemptAt,
      p_status: input.status ?? null,
      p_sent_at: input.sentAt ?? null,
      p_opened_at: input.openedAt ?? null,
      p_delivery_error: clean(input.deliveryError),
      p_expected_current_status: input.expectedCurrentStatus ?? null
    });
    const row = (Array.isArray(data) ? data[0] : null) as TransitionResultRow | null;
    return {
      packetId: row?.packet_id ?? input.packetId,
      status: row?.status ?? input.status ?? null,
      deliveryStatus: row?.delivery_status ?? input.deliveryStatus,
      didTransition: Boolean(row?.did_transition)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update enrollment packet delivery state.";
    if (message.includes(TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC)) {
      throw new Error(
        `Enrollment packet delivery state RPC is not available yet. Apply Supabase migration ${ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION} first.`
      );
    }
    throw error;
  }
}
