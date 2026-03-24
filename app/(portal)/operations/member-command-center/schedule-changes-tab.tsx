import { Card } from "@/components/ui/card";
import { ScheduleChangesManager } from "@/components/operations/schedule-changes-manager";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { listMemberAttendanceSchedulesForMemberIdsSupabase } from "@/lib/services/member-command-center-write";
import { listScheduleChangesSupabase } from "@/lib/services/schedule-changes-supabase";
import { SCHEDULE_WEEKDAY_KEYS } from "@/lib/services/schedule-changes-shared";
import { toEasternDate } from "@/lib/timezone";

export default async function MemberCommandCenterScheduleChangesTab({
  memberId,
  memberName,
  canEdit
}: {
  memberId: string;
  memberName: string;
  canEdit: boolean;
}) {
  const [memberSchedules, rows] = await Promise.all([
    listMemberAttendanceSchedulesForMemberIdsSupabase([memberId]),
    listScheduleChangesSupabase({ memberId, status: "all", limit: 100 })
  ]);

  const memberSchedulesById = Object.fromEntries(
    memberSchedules.map((schedule) => [
      schedule.member_id,
      SCHEDULE_WEEKDAY_KEYS.filter((day) => Boolean(schedule[day]))
    ])
  );

  return (
    <Card id="schedule-changes">
      <SectionHeading
        title="Schedule Changes"
        lastUpdatedAt={rows[0]?.updated_at ?? null}
        lastUpdatedBy={rows[0]?.entered_by ?? null}
      />
      <p className="mt-2 text-sm text-muted">
        Member-specific schedule exceptions live here so changes stay tied to the MCC attendance context instead of a separate operations module.
      </p>
      <div className="mt-3">
        <ScheduleChangesManager
          members={[{ id: memberId, displayName: memberName }]}
          memberNamesById={{ [memberId]: memberName }}
          rows={rows}
          memberSchedulesById={memberSchedulesById}
          canEdit={canEdit}
          todayDate={toEasternDate()}
        />
      </div>
    </Card>
  );
}
