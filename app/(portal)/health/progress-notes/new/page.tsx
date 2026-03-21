import Link from "next/link";
import { redirect } from "next/navigation";

import { ProgressNoteForm } from "@/components/progress-notes/progress-note-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireProgressNoteAuthorizedUser } from "@/lib/services/progress-note-authorization";
import {
  getExistingProgressNoteDraftForMember,
  getProgressNoteDraftContext,
  getProgressNoteMemberOptions
} from "@/lib/services/notes-read";
import { toEasternDate } from "@/lib/timezone";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function NewProgressNotePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireProgressNoteAuthorizedUser();
  const params = await searchParams;
  const memberId = firstString(params.memberId);
  const memberOptions = await getProgressNoteMemberOptions();

  if (!memberId) {
    return (
      <div className="space-y-4">
        <Card>
          <CardTitle>New Progress Note</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Start an off-cycle progress note at any time. Only a signed note resets the 90-day compliance clock.
          </p>
        </Card>

        <Card>
          <form className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="memberId">
                Member
              </label>
              <select id="memberId" name="memberId" required className="h-10 w-full rounded-lg border border-border px-3 text-sm">
                <option value="">Select member</option>
                {memberOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
                Continue
              </button>
              <Link href="/health/progress-notes" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand">
                Back to Tracker
              </Link>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  const existingDraft = await getExistingProgressNoteDraftForMember(memberId);
  if (existingDraft) {
    redirect(`/health/progress-notes/${existingDraft.id}`);
  }

  const memberRow = await getProgressNoteDraftContext(memberId);
  if (!memberRow) {
    redirect("/health/progress-notes/new");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>New Progress Note</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Save a draft or finalize directly. Finalization resets the next 90-day due cycle immediately and returns you to the tracker.
        </p>
      </Card>

      <Card>
        <ProgressNoteForm
          memberId={memberRow.memberId}
          memberName={memberRow.memberName}
          initialNoteDate={toEasternDate()}
          initialNoteBody=""
          initialStatus="draft"
          summary={
            memberRow
          }
          backHref={`/health/progress-notes?memberId=${memberRow.memberId}`}
          afterSignHref={`/health/progress-notes?memberId=${memberRow.memberId}`}
        />
      </Card>
    </div>
  );
}
