"use server";

export async function submitPayorAction(formData: FormData) {
  const implementation = await import("./actions-impl");
  return implementation.submitPayorActionImpl(formData);
}

export async function createEnrollmentInvoiceWorkflowAction(input: {
  memberId: string;
  effectiveStartDate: string;
  periodEndDate?: string | null;
  includeTransportation?: boolean;
  includeAncillary?: boolean;
  includeAdjustments?: boolean;
  notes?: string | null;
}) {
  const implementation = await import("./enrollment-workflow-action");
  return implementation.createEnrollmentInvoiceWorkflowAction(input);
}
