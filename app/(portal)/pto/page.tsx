import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

const PTO_URL = "https://infhsg-ep.prismhr.com/uex/#/login?lang=en";

export default async function PtoPage() {
  await requireModuleAccess("pto");

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>PTO Request</CardTitle>
        <p className="mt-2 text-sm text-muted">PTO requests are managed in PrismHR.</p>
        <a
          href={PTO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          Open PTO Request Portal
        </a>
      </Card>
    </div>
  );
}
