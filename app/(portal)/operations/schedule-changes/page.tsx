import Link from "next/link";

import {
  createScheduleChangeAction,
  setScheduleChangeStatusAction
} from "@/app/(portal)/operations/schedule-changes/actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { listScheduleChangesSupabase, SCHEDULE_WEEKDAY_KEYS } from "@/lib/services/schedule-changes-supabase";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/utils";

const CHANGE_TYPES = [
  "Scheduled Absence",
  "Makeup Day",
  "Day Swap",
  "Temporary Schedule Change",
  "Permanent Schedule Change"
] as const;

const WEEKDAY_LABELS: Record<(typeof SCHEDULE_WEEKDAY_KEYS)[number], string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri"
};

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeType(value: string | undefined) {
  if (CHANGE_TYPES.includes(value as (typeof CHANGE_TYPES)[number])) return value as (typeof CHANGE_TYPES)[number];
  return CHANGE_TYPES[0];
}

function formatDays(days: string[]) {
  if (days.length === 0) return "-";
  return days
    .map((day) => WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS] ?? day)
    .join(", ");
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function OperationsScheduleChangesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireModuleAccess("operations");
  const params = await searchParams;
  const canEdit =
    profile.role === "admin" ||
    profile.role === "manager" ||
    profile.role === "director" ||
    profile.role === "coordinator";
  const selectedType = normalizeType(firstString(params.changeType));
  const requestedMemberId = firstString(params.memberId) ?? "";
  const successMessage = firstString(params.success) ?? "";
  const errorMessage = firstString(params.error) ?? "";

  const supabase = await createClient();
  const { data: membersData, error: membersError } = await supabase
    .from("members")
    .select("id, display_name, status")
    .order("display_name", { ascending: true });
  if (membersError) throw new Error(`Unable to load members for schedule changes: ${membersError.message}`);
  const members = ((membersData ?? []) as Array<{ id: string; display_name: string; status: string }>)
    .filter((row) => row.status === "active")
    .sort((left, right) => left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" }));
  const selectedMemberId = members.some((row) => row.id === requestedMemberId)
    ? requestedMemberId
    : (members[0]?.id ?? "");
  const [{ data: schedulesData, error: schedulesError }, scheduleChanges] = await Promise.all([
    selectedMemberId
      ? supabase.from("member_attendance_schedules").select("*").eq("member_id", selectedMemberId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    listScheduleChangesSupabase({ status: "all", limit: 200 })
  ]);
  if (schedulesError) throw new Error(`Unable to load member attendance schedule: ${schedulesError.message}`);
  const memberById = new Map(
    ((membersData ?? []) as Array<{ id: string; display_name: string; status: string }>).map((row) => [row.id, row] as const)
  );
  const selectedMemberSchedule = schedulesData as Record<string, unknown> | null;
  const selectedMemberDays = selectedMemberSchedule
    ? SCHEDULE_WEEKDAY_KEYS.filter((day) => Boolean(selectedMemberSchedule[day]))
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/operations" forceFallback ariaLabel="Back to operations" />
          <div>
            <CardTitle>Schedule Changes</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Dedicated operations workflow entry for non-destructive member schedule exceptions and overrides.
            </p>
          </div>
        </div>
      </Card>

      {errorMessage ? (
        <Card>
          <p className="text-sm font-semibold text-danger">{errorMessage}</p>
        </Card>
      ) : null}
      {successMessage ? (
        <Card>
          <p className="text-sm font-semibold text-emerald-700">{successMessage}</p>
        </Card>
      ) : null}

      <Card>
        <p className="text-sm font-semibold text-fg">Change Types</p>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3" id="new-change">
          {CHANGE_TYPES.map((type) => (
            <Link
              key={type}
              href={`/operations/schedule-changes?changeType=${encodeURIComponent(type)}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}#new-change`}
              className={`rounded border px-3 py-2 font-semibold ${selectedType === type ? "border-brand bg-[#edf3ff] text-brand" : "border-border hover:border-brand"}`}
            >
              {type}
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>New Schedule Change</CardTitle>
        {canEdit ? (
          <form action={createScheduleChangeAction} className="mt-3 grid gap-2 md:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-muted">Member</span>
              <select name="memberId" defaultValue={selectedMemberId} required className="h-10 w-full rounded-lg border border-border px-3">
                <option value="" disabled>Select member</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-muted">Change Type</span>
              <select name="changeType" defaultValue={selectedType} required className="h-10 w-full rounded-lg border border-border px-3">
                {CHANGE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-muted">Effective Start Date</span>
              <input name="effectiveStartDate" type="date" defaultValue={todayDate()} required className="h-10 w-full rounded-lg border border-border px-3" />
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-muted">Effective End Date</span>
              <input name="effectiveEndDate" type="date" className="h-10 w-full rounded-lg border border-border px-3" />
            </label>

            <div className="rounded-lg border border-border bg-[#f8fbff] p-3 text-xs">
              <p className="font-semibold text-muted">Original Days (Auto from MCC Attendance)</p>
              <p className="mt-1 text-sm font-semibold text-fg">{formatDays(selectedMemberDays)}</p>
            </div>

            <fieldset className="rounded-lg border border-border p-3 text-xs">
              <legend className="px-1 text-xs font-semibold text-muted">New Days</legend>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {SCHEDULE_WEEKDAY_KEYS.map((day) => (
                  <label key={`new-${day}`} className="inline-flex items-center gap-1">
                    <input type="checkbox" name="newDays" value={day} />
                    <span>{WEEKDAY_LABELS[day]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="inline-flex items-center gap-2 text-xs">
              <input type="checkbox" name="suspendBaseSchedule" value="true" />
              <span className="font-semibold text-muted">Suspend normal schedule for effective range</span>
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-semibold text-muted">Reason</span>
              <input name="reason" type="text" required placeholder="Reason for change" className="h-10 w-full rounded-lg border border-border px-3" />
            </label>

            <label className="space-y-1 text-xs md:col-span-2">
              <span className="font-semibold text-muted">Notes</span>
              <textarea name="notes" rows={3} className="w-full rounded-lg border border-border px-3 py-2" />
            </label>

            <div className="md:col-span-2 flex flex-wrap items-center gap-2">
              <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
                Save Schedule Change
              </button>
              <span className="text-xs text-muted">
                Permanent changes update recurring base weekdays and preserve this historical exception record.
              </span>
            </div>
          </form>
        ) : (
          <p className="mt-2 text-sm text-muted">You have view-only access to schedule changes.</p>
        )}

        <div className="mt-3 rounded-lg border border-border bg-[#f8fbff] p-3 text-xs text-muted">
          <p className="font-semibold text-fg">Current Schedule Display</p>
          <p className="mt-1">
            {memberById.get(selectedMemberId)?.display_name ?? "Selected member"}:{" "}
            <span className="font-semibold text-fg">{formatDays(selectedMemberDays)}</span>
          </p>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-fg">Workflow Shortcuts</p>
        <p className="mt-1 text-xs text-muted">
          Schedule changes feed attendance/census, transportation, billing inputs, and member command-center workflows.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <Link href="/operations/member-command-center" className="font-semibold text-brand">
            Open Member Command Center
          </Link>
          <Link href="/operations/attendance" className="font-semibold text-brand">
            Open Attendance / Census
          </Link>
          <Link href="/operations/transportation-station" className="font-semibold text-brand">
            Open Transportation Station
          </Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Schedule Change History ({scheduleChanges.length})</CardTitle>
        {scheduleChanges.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No schedule changes logged yet.</p>
        ) : (
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Type</th>
                <th>Range</th>
                <th>Original Days</th>
                <th>New Days</th>
                <th>Status</th>
                <th>Entered By</th>
                <th>Created</th>
                {canEdit ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {scheduleChanges.map((row) => (
                <tr key={row.id}>
                  <td>{memberById.get(row.member_id)?.display_name ?? "Unknown Member"}</td>
                  <td>{row.change_type}</td>
                  <td>{formatDate(row.effective_start_date)}{row.effective_end_date ? ` - ${formatDate(row.effective_end_date)}` : " - Open"}</td>
                  <td>{formatDays(row.original_days)}</td>
                  <td>{formatDays(row.new_days)}</td>
                  <td className="capitalize">{row.status}</td>
                  <td>{row.entered_by}</td>
                  <td>{formatDateTime(row.created_at)}</td>
                  {canEdit ? (
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {row.status !== "active" ? (
                          <form action={setScheduleChangeStatusAction}>
                            <input type="hidden" name="id" value={row.id} />
                            <input type="hidden" name="status" value="active" />
                            <button type="submit" className="rounded border border-border px-2 py-1 text-xs font-semibold">Reopen</button>
                          </form>
                        ) : null}
                        {row.status !== "completed" ? (
                          <form action={setScheduleChangeStatusAction}>
                            <input type="hidden" name="id" value={row.id} />
                            <input type="hidden" name="status" value="completed" />
                            <button type="submit" className="rounded border border-border px-2 py-1 text-xs font-semibold">Complete</button>
                          </form>
                        ) : null}
                        {row.status !== "cancelled" ? (
                          <form action={setScheduleChangeStatusAction}>
                            <input type="hidden" name="id" value={row.id} />
                            <input type="hidden" name="status" value="cancelled" />
                            <button type="submit" className="rounded border border-danger px-2 py-1 text-xs font-semibold text-danger">Cancel</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <p className="text-sm text-muted">
          Access level:{" "}
          <span className="font-semibold text-fg">
            {canEdit ? "Create/Edit enabled for your role on connected schedule workflows." : "View-only"}
          </span>
        </p>
      </Card>
    </div>
  );
}
