import { Card, CardBody, CardTitle } from "@/components/ui/card";

export default function MemberHealthProfilesLoading() {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Loading Member Health Profiles</CardTitle>
        <CardBody>
          <p className="text-sm text-muted">Loading clinical profile data, related assessments, and supporting records.</p>
        </CardBody>
      </Card>
    </div>
  );
}
