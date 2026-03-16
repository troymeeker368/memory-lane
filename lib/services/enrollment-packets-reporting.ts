import "server-only";

import type { listCompletedEnrollmentPacketRequests as listCompletedEnrollmentPacketRequestsImpl } from "@/lib/services/enrollment-packets";

type ListCompletedEnrollmentPacketRequestsInput = Parameters<typeof listCompletedEnrollmentPacketRequestsImpl>[0];

export async function listCompletedEnrollmentPacketRequests(input: ListCompletedEnrollmentPacketRequestsInput) {
  const { listCompletedEnrollmentPacketRequests } = await import("@/lib/services/enrollment-packets");
  return listCompletedEnrollmentPacketRequests(input);
}
