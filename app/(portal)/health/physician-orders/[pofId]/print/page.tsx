import Link from "next/link";
import { notFound } from "next/navigation";

import { PofDocumentRender } from "@/components/physician-orders/pof-document-render";
import { PhysicianOrderPdfActions } from "@/components/physician-orders/pof-pdf-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { requireRoles } from "@/lib/auth";
import { getPhysicianOrderById } from "@/lib/services/physician-orders-supabase";
import { toEasternISO } from "@/lib/timezone";
import { formatDateTime } from "@/lib/utils";

export default async function PhysicianOrderPrintPage({
  params
}: {
  params: Promise<{ pofId: string }>;
}) {
  await requireRoles(["admin", "nurse"]);
  const { pofId } = await params;
  const form = await getPhysicianOrderById(pofId);
  if (!form) notFound();

  const generatedAt = toEasternISO();

  return (
    <div className="space-y-4">
      <div className="print-hide flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackArrowButton
            fallbackHref={`/health/physician-orders/${form.id}`}
            forceFallback
            ariaLabel="Back to physician order detail"
          />
          <Link href={`/health/physician-orders/${form.id}`} className="text-sm font-semibold text-brand">
            Back to Physician Order
          </Link>
        </div>
        <PhysicianOrderPdfActions pofId={form.id} />
      </div>

      <PofDocumentRender
        form={form}
        title="Physician Order & Physical Exam Form"
        metaLines={[`Generated: ${formatDateTime(generatedAt)} (ET)`]}
      />
    </div>
  );
}
