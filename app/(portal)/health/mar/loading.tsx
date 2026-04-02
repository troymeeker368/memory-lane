import { Card, CardBody, CardTitle } from "@/components/ui/card";

export default function MarLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Loading MAR Workflow</CardTitle>
        <CardBody>
          <p className="text-sm text-muted">Loading medication schedules, report options, and administration history.</p>
        </CardBody>
      </Card>
    </div>
  );
}
