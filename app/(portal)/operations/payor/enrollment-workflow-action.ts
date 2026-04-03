"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { canAccessNavItem } from "@/lib/permissions";
import { buildQuickBooksCsvForInvoiceIds } from "@/lib/services/billing-exports";
import { buildBillingInvoicePdfBytes, getBillingInvoiceDocumentModel } from "@/lib/services/billing-invoice-document";
import { createEnrollmentProratedInvoice, finalizeInvoice } from "@/lib/services/billing-supabase";
import {
  buildGeneratedMemberFilePersistenceState,
  saveGeneratedMemberPdfToFiles
} from "@/lib/services/member-files";

function revalidateEnrollmentInvoicePaths() {
  revalidatePath("/operations/payor");
  revalidatePath("/operations/payor/custom-invoices");
  revalidatePath("/operations/payor/invoices/draft");
  revalidatePath("/operations/payor/invoices/finalized");
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
  const profile = await getCurrentProfile();
  if (!canAccessNavItem(profile.role, "/operations/payor", profile.permissions, "canEdit")) {
    return { ok: false as const, error: "You do not have access to billing workflows." };
  }

  const created = await createEnrollmentProratedInvoice({
    memberId: String(input.memberId ?? "").trim(),
    effectiveStartDate: String(input.effectiveStartDate ?? "").trim(),
    periodEndDate: String(input.periodEndDate ?? "").trim() || null,
    includeTransportation: Boolean(input.includeTransportation),
    includeAncillary: Boolean(input.includeAncillary),
    includeAdjustments: Boolean(input.includeAdjustments),
    notes: String(input.notes ?? "").trim() || null,
    runByUser: profile.id,
    runByName: profile.full_name
  });
  if (!created.ok) {
    return created;
  }

  const finalized = await finalizeInvoice({
    invoiceId: created.invoiceId,
    finalizedBy: profile.full_name
  });
  if (!finalized.ok) {
    return {
      ok: false as const,
      error: finalized.error
    };
  }

  const [csvExport, invoiceModel] = await Promise.all([
    buildQuickBooksCsvForInvoiceIds({
      invoiceIds: [created.invoiceId],
      detailLevel: "Summary",
      fileNamePrefix: "quickbooks-enrollment"
    }),
    getBillingInvoiceDocumentModel(created.invoiceId)
  ]);

  const pdfBytes = await buildBillingInvoicePdfBytes(invoiceModel);
  const savedPdf = await saveGeneratedMemberPdfToFiles({
    memberId: invoiceModel.memberId,
    memberName: invoiceModel.memberName,
    documentLabel: `Billing Invoice ${invoiceModel.invoiceNumber || created.invoiceId}`,
    fileNameOverride: `${invoiceModel.invoiceNumber || created.invoiceId}.pdf`,
    documentSource: `billing_invoice:${created.invoiceId}`,
    category: "Billing",
    bytes: pdfBytes,
    contentType: "application/pdf",
    uploadedBy: {
      id: profile.id,
      name: profile.full_name
    },
    replaceExistingByDocumentSource: true
  });
  const memberFileState = buildGeneratedMemberFilePersistenceState({
    documentLabel: `Billing Invoice ${invoiceModel.invoiceNumber || created.invoiceId}`,
    verifiedPersisted: savedPdf.verifiedPersisted
  });

  revalidateEnrollmentInvoicePaths();

  return {
    ok: true as const,
    invoiceId: created.invoiceId,
    invoiceNumber: invoiceModel.invoiceNumber || created.invoiceId,
    csvFileName: csvExport.fileName,
    csvContent: csvExport.csv,
    pdfFileName: savedPdf.fileName,
    memberFilesStatus: memberFileState.memberFilesStatus,
    memberFilesMessage: memberFileState.memberFilesMessage
  };
}
