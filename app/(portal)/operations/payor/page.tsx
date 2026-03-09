import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

export default async function OperationsPayorPage() {
  await requireModuleAccess("operations");

  return (
    <Card>
      <CardTitle>Payor</CardTitle>
      <p className="mt-1 text-sm text-muted">Reserved placeholder for future payor maintenance and billing alignment.</p>
    </Card>
  );
}
