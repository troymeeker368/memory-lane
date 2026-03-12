import type { PhysicianOrderForm } from "@/lib/services/physician-orders-supabase";
import { buildPofDocumentSections } from "@/lib/services/pof-document-content";
import { Card } from "@/components/ui/card";
import { DocumentBrandHeader } from "@/components/documents/document-brand-header";

export function PofDocumentRender({
  form,
  title = "Physician Order Form",
  metaLines = []
}: {
  form: PhysicianOrderForm;
  title?: string;
  metaLines?: string[];
}) {
  const sections = buildPofDocumentSections(form);

  return (
    <Card>
      <DocumentBrandHeader title={title} metaLines={metaLines} />
      <div className="mt-4 space-y-4">
        {sections.map((section) => (
          <section key={section.title} className="rounded-lg border border-border p-3">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            <dl className="mt-2 grid gap-x-3 gap-y-2 md:grid-cols-[240px_1fr]">
              {section.rows.map((row) => (
                <div key={`${section.title}-${row.label}`} className="contents">
                  <dt className="text-xs font-semibold text-muted">{row.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-sm">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Card>
  );
}
