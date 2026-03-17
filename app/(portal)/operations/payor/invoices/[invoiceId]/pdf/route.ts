import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { buildBillingInvoicePdfBytes, getBillingInvoiceDocumentModel } from "@/lib/services/billing-invoice-document";
import { canAccessNavItem } from "@/lib/permissions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ invoiceId: string }> }
) {
  const profile = await getCurrentProfile();
  if (!canAccessNavItem(profile.role, "/operations/payor", profile.permissions, "canView")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { invoiceId } = await context.params;
  const model = await getBillingInvoiceDocumentModel(invoiceId);
  const bytes = await buildBillingInvoicePdfBytes(model);

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${model.invoiceNumber || invoiceId}.pdf"`
    }
  });
}
