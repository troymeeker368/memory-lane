import type { PhysicianOrderForm } from "@/lib/services/physician-order-model";
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
        {sections.length === 0 ? (
          <p className="text-sm text-muted">No clinically meaningful values are available for this document.</p>
        ) : (
          sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-border p-3">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              {section.layout === "table" ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        {section.columns.map((column) => (
                          <th key={`${section.title}-${column.key}`} className="border border-border bg-slate-50 px-2 py-1 text-left text-xs font-semibold text-muted">
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row) => (
                        <tr key={`${section.title}-${row.id}`}>
                          {section.columns.map((column) => (
                            <td key={`${row.id}-${column.key}`} className="border border-border px-2 py-1 align-top whitespace-pre-wrap break-words">
                              {row.cells[column.key] ?? "-"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <dl className="mt-2 grid gap-x-3 gap-y-2 md:grid-cols-[240px_1fr]">
                  {section.rows.map((row) => (
                    <div key={`${section.title}-${row.label}`} className="contents">
                      <dt className="text-xs font-semibold text-muted">{row.label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))
        )}
      </div>
    </Card>
  );
}
