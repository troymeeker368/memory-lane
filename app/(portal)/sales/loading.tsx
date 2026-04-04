import { Card, CardBody, CardTitle } from "@/components/ui/card";

export default function SalesLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Loading Sales Workspace</CardTitle>
        <CardBody>
          <p className="text-sm text-muted">Loading leads, referral activity, and pipeline summaries.</p>
        </CardBody>
      </Card>
    </div>
  );
}
