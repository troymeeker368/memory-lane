import { SalesEnrollmentPacketStandaloneAction } from "@/components/sales/sales-enrollment-packet-standalone-action";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function SendEnrollmentPacketStandalonePage() {
  await requireModuleAccess("sales");
  const supabase = await createClient();
  const [{ data: leadsData, error: leadsError }, { data: membersData, error: membersError }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, member_name, caregiver_email")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("members")
      .select("id, display_name, source_lead_id")
      .order("display_name", { ascending: true })
      .limit(1000)
  ]);
  if (leadsError) throw new Error(leadsError.message);
  if (membersError) throw new Error(membersError.message);

  const members = (membersData ?? []).map((row: any) => ({
    id: String(row.id),
    displayName: String(row.display_name ?? "")
  }));
  const memberIdByLeadId = new Map(
    (membersData ?? [])
      .filter((row: any) => row.source_lead_id)
      .map((row: any) => [String(row.source_lead_id), String(row.id)] as const)
  );
  const leads = (leadsData ?? []).map((row: any) => ({
    id: String(row.id),
    memberName: String(row.member_name ?? ""),
    caregiverEmail: typeof row.caregiver_email === "string" ? row.caregiver_email : null,
    linkedMemberId: memberIdByLeadId.get(String(row.id)) ?? null
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Send Enrollment Packet</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Standalone sales action for sending caregiver enrollment packets from one shared backend service.
        </p>
      </Card>
      <Card>
        <SalesEnrollmentPacketStandaloneAction leads={leads} members={members} />
      </Card>
    </div>
  );
}

