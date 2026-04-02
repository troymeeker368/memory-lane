import { Card, CardBody, CardTitle } from "@/components/ui/card";

export default function MemberCommandCenterLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Loading Member Command Center</CardTitle>
        <CardBody>
          <p className="text-sm text-muted">Loading member schedules, holds, pricing, and operational records.</p>
        </CardBody>
      </Card>
    </div>
  );
}
