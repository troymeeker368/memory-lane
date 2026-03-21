import dynamic from "next/dynamic";
import Link from "next/link";

import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import {
  listMemberNameLookupSupabase
} from "@/lib/services/member-command-center-read";
import {
  listMemberAttendanceSchedulesForMemberIdsSupabase,
} from "@/lib/services/member-command-center-write";
import { listScheduleChangesSupabase } from "@/lib/services/schedule-changes-supabase";
import { SCHEDULE_WEEKDAY_KEYS } from "@/lib/services/schedule-changes-shared";

const ScheduleChangesManager = dynamic(
  () => import("@/components/operations/schedule-changes-manager").then((mod) => mod.ScheduleChangesManager),
  {
    loading: () => <p className="text-sm text-muted">Loading schedule change manager...</p>
  }
);

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function OperationsScheduleChangesPage() {
  const profile = await requireModuleAccess("operations");
  const canEdit =
    profile.role === "admin" ||
    profile.role === "manager" ||
    profile.role === "director" ||
    profile.role === "coordinator";

  const allMembers = await listMemberNameLookupSupabase({ status: "all" });
  const activeMembers = allMembers.filter((member) => member.status === "active");
  const [memberSchedules, scheduleChanges] = await Promise.all([
    listMemberAttendanceSchedulesForMemberIdsSupabase(allMembers.map((member) => member.id)),
    listScheduleChangesSupabase({ status: "all", limit: 200 })
  ]);

  const memberSchedulesById = Object.fromEntries(
    memberSchedules.map((schedule) => [
      schedule.member_id,
      SCHEDULE_WEEKDAY_KEYS.filter((day) => Boolean(schedule[day]))
    ])
  );
  const memberNamesById = Object.fromEntries(
    allMembers.map((member) => [member.id, member.display_name])
  );

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

      <ScheduleChangesManager
        members={activeMembers.map((member) => ({
          id: member.id,
          displayName: member.display_name
        }))}
        memberNamesById={memberNamesById}
        rows={scheduleChanges}
        memberSchedulesById={memberSchedulesById}
        canEdit={canEdit}
        todayDate={todayDate()}
      />

      <Card>
        <p className="text-sm font-semibold text-fg">Workflow Shortcuts</p>
        <p className="mt-1 text-xs text-muted">
          Schedule changes feed attendance, census, transportation, billing inputs, and member command-center workflows.
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
