import { Card, CardBody, CardTitle } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Loading Dashboard</CardTitle>
        <CardBody>
          <p className="text-sm text-muted">Loading operational counts, alerts, attendance, and admin summaries.</p>
        </CardBody>
      </Card>
    </div>
  );
}
