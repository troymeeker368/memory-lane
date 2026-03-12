import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatOptionalDate } from "@/lib/utils";

export default async function MembersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("documentation");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const statusFilter = typeof params.status === "string" ? params.status : "all";

  const supabase = await createClient();
  const { data: membersData, error } = await supabase
    .from("members")
    .select("id, display_name, status, enrollment_date, discharge_date, discharge_reason, discharge_disposition")
    .order("display_name", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  const rows = (membersData ?? [])
    .filter((member) => (statusFilter === "all" ? true : member.status === statusFilter))
    .filter((member) => (query ? member.display_name.toLowerCase().includes(query) : true))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <Card className="table-wrap">
      <CardTitle>Members / Participants</CardTitle>
      <form className="mt-3 grid gap-2 sm:grid-cols-4" method="get">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search member"
          className="h-10 rounded-lg border border-border px-3"
        />
        <select name="status" defaultValue={statusFilter} className="h-10 rounded-lg border border-border px-3">
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="h-10 rounded-lg bg-[#1B3E93] px-3 font-semibold text-white">
          Filter
        </button>
        <Link href="/members" className="h-10 rounded-lg border border-border px-3 font-semibold leading-10 text-center">
          Clear Filters
        </Link>
      </form>

      <p className="mt-2 text-xs text-muted">Total: {rows.length}</p>

      <table className="mt-3">
        <thead>
          <tr>
            <th>Member</th>
            <th>Status</th>
            <th>Enrollment Date</th>
            <th>Discharge Date</th>
            <th>Discharge Reason</th>
            <th>Disposition</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.id}>
              <td>{member.display_name}</td>
              <td className="capitalize">{member.status}</td>
              <td>{formatOptionalDate(member.enrollment_date)}</td>
              <td>{formatOptionalDate(member.discharge_date)}</td>
              <td>{member.discharge_reason ?? "-"}</td>
              <td>{member.discharge_disposition ?? "-"}</td>
              <td>
                <Link href={`/members/${member.id}`} className="font-semibold text-brand">
                  Details
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
