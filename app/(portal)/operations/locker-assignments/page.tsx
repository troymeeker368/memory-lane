import dynamic from "next/dynamic";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { assignLockerAction, clearLockerAction } from "@/app/(portal)/operations/locker-assignments/actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { firstSearchParam, parseEnumSearchParam, parsePositivePageParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";
import { formatOptionalDate } from "@/lib/utils";

const LockerAssignModalTrigger = dynamic(
  () => import("@/app/(portal)/operations/locker-assignments/locker-assign-modal-trigger").then((mod) => mod.LockerAssignModalTrigger),
  {
    loading: () => <span className="text-sm font-semibold text-brand">Manage</span>
  }
);

const PAGE_SIZE = 25;
const PDF_REFERENCE_ROWS: Array<{ locker: string; current?: string; previous?: string }> = [
  { locker: "5", current: "Bob Lewis", previous: "Louise Rakoczy" },
  { locker: "11", current: "Ferdie Trandel", previous: "Richard Sinnes" },
  { locker: "27", current: "Don G" },
  { locker: "33", current: "Liliia Velushchak" },
  { locker: "34", current: "Doris Joyce Hollingsworth" }
];

function normalizeLocker(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) {
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  }
  return cleaned.toUpperCase();
}

function lockerSort(a: string, b: string) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum) && /^\d+$/.test(a);
  const bIsNum = Number.isFinite(bNum) && /^\d+$/.test(b);
  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function resolveLockerAssignmentDate(member: {
  enrollment_date: string | null;
  locker_assigned_at?: string | null;
  updated_at?: string | null;
}) {
  const lockerAssignedAt = typeof member.locker_assigned_at === "string" ? member.locker_assigned_at : null;
  if (lockerAssignedAt) return lockerAssignedAt;
  const updatedAt = typeof member.updated_at === "string" ? member.updated_at : null;
  if (updatedAt) return updatedAt;
  return member.enrollment_date;
}

export default async function LockerAssignmentsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const profile = await requireModuleAccess("operations");
  const canEdit = profile.role === "admin" || profile.role === "manager";
  const params = await searchParams;
  const rawQuery = (firstSearchParam(params.q) ?? "").trim();
  const normalizedQuery = rawQuery.toLowerCase();
  const status = parseEnumSearchParam(firstSearchParam(params.status), ["all", "assigned", "open"] as const, "all");
  const requestedPage = parsePositivePageParam(firstSearchParam(params.page));
  const selectedLocker = normalizeLocker(firstSearchParam(params.locker)) ?? "";
  const selectedMemberId = (firstSearchParam(params.memberId) ?? "").trim();
  const errorMessage = firstSearchParam(params.error) ?? "";
  const successMessage = firstSearchParam(params.success) ?? "";

  const supabase = await createClient();
  const { data: membersData, error } = await supabase
    .from("members")
    .select("id, display_name, status, locker_number, enrollment_date, discharge_date, updated_at")
    .order("display_name", { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  const { data: lockerHistoryData, error: lockerHistoryError } = await supabase
    .from("locker_assignment_history")
    .select("locker_number, previous_member_assigned, updated_at")
    .order("updated_at", { ascending: false });
  if (lockerHistoryError) {
    throw new Error(lockerHistoryError.message);
  }
  const allMembers = (membersData ?? []) as Array<{
    id: string;
    display_name: string;
    status: "active" | "inactive";
    locker_number: string | null;
    enrollment_date: string | null;
    discharge_date: string | null;
    updated_at: string | null;
    locker_assigned_at?: string | null;
  }>;
  const lockerHistory = (lockerHistoryData ?? []) as Array<{
    locker_number: string | null;
    previous_member_assigned: string | null;
    updated_at: string | null;
  }>;
  const activeMembers = Array.from(
    new Map(
      allMembers
        .filter((member) => member.status === "active")
        .map((member) => [member.id, member] as const)
    ).values()
  ).sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }));
  const inactiveMembers = Array.from(
    new Map(
      allMembers
        .filter((member) => member.status === "inactive")
        .map((member) => [member.id, member] as const)
    ).values()
  ).sort((a, b) => {
      const aDate = a.discharge_date ?? "";
      const bDate = b.discharge_date ?? "";
      if (aDate === bDate) return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" });
      return aDate < bDate ? 1 : -1;
    });

  const currentByLocker = new Map<string, (typeof activeMembers)[number]>();
  activeMembers.forEach((member) => {
    const locker = normalizeLocker(member.locker_number);
    if (!locker || currentByLocker.has(locker)) return;
    currentByLocker.set(locker, member);
  });

  const previousByLocker = new Map<string, string>();
  lockerHistory.forEach((row) => {
    const locker = normalizeLocker(row.locker_number);
    const previousMemberAssigned = String(row.previous_member_assigned ?? "").trim();
    if (!locker || !previousMemberAssigned || previousByLocker.has(locker)) return;
    previousByLocker.set(locker, previousMemberAssigned);
  });

  const referencePreviousByLocker = new Map(
    PDF_REFERENCE_ROWS.filter((row) => row.previous).map((row) => [row.locker, row.previous as string] as const)
  );

  const lockerPool = new Set<string>();
  for (let locker = 1; locker <= 72; locker += 1) {
    lockerPool.add(String(locker));
  }
  PDF_REFERENCE_ROWS.forEach((row) => lockerPool.add(row.locker));
  activeMembers.forEach((member) => {
    const locker = normalizeLocker(member.locker_number);
    if (locker) lockerPool.add(locker);
  });
  inactiveMembers.forEach((member) => {
    const locker = normalizeLocker(member.locker_number);
    if (locker) lockerPool.add(locker);
  });
  lockerHistory.forEach((row) => {
    const locker = normalizeLocker(row.locker_number);
    if (locker) lockerPool.add(locker);
  });

  const rows = [...lockerPool]
    .sort(lockerSort)
    .map((locker) => {
      const currentMember = currentByLocker.get(locker) ?? null;
      const previousMember = previousByLocker.get(locker) ?? referencePreviousByLocker.get(locker) ?? null;
      return {
        locker,
        currentMember,
        previousMember,
        status: currentMember ? "Assigned" : "Open"
      };
    })
    .filter((row) => (status === "all" ? true : status === "assigned" ? Boolean(row.currentMember) : !row.currentMember))
    .filter((row) => {
      if (!normalizedQuery) return true;
      return (
        row.locker.toLowerCase().includes(normalizedQuery) ||
        (row.currentMember?.display_name ?? "").toLowerCase().includes(normalizedQuery) ||
        (row.previousMember ?? "").toLowerCase().includes(normalizedQuery)
      );
    });

  const selectedMember = activeMembers.find((member) => member.id === selectedMemberId) ?? null;
  const selectedMemberCurrentLocker = normalizeLocker(selectedMember?.locker_number ?? null);
  const availableLockerOptions = [...lockerPool]
    .filter((locker) => !currentByLocker.has(locker) || locker === selectedMemberCurrentLocker)
    .sort(lockerSort);
  const activeMemberOptions = activeMembers.map((member) => ({
    id: member.id,
    displayName: member.display_name,
    lockerNumber: normalizeLocker(member.locker_number)
  }));

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(startIndex, startIndex + PAGE_SIZE);

  const pageHref = (page: number) => {
    const qs = new URLSearchParams();
    if (rawQuery) qs.set("q", rawQuery);
    if (status !== "all") qs.set("status", status);
    if (selectedLocker) qs.set("locker", selectedLocker);
    if (selectedMemberId) qs.set("memberId", selectedMemberId);
    qs.set("page", String(page));
    return `/operations/locker-assignments?${qs.toString()}`;
  };
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/operations" forceFallback ariaLabel="Back to operations" />
          <div>
            <CardTitle>Locker Assignments</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Central locker roster management with active-member uniqueness and member-linked assignment controls.
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

      {canEdit ? (
        <Card id="assignment-form">
          <CardTitle>Assign / Reassign Locker</CardTitle>
          <form
            key={`assign-form-${selectedLocker}-${selectedMemberId}`}
            action={assignLockerAction}
            className="mt-3 grid gap-2 md:grid-cols-4"
          >
            <input type="hidden" name="q" value={rawQuery} />
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="page" value={String(currentPage)} />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Locker #</span>
              <select
                key={`locker-select-${selectedLocker}-${selectedMemberId}`}
                name="lockerNumber"
                defaultValue={selectedLocker}
                required
                className="h-10 w-full rounded-lg border border-border px-3"
              >
                <option value="">Select locker</option>
                {availableLockerOptions.map((locker) => (
                  <option key={locker} value={locker}>
                    {locker}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-xs font-semibold text-muted">Member</span>
              <select
                key={`member-select-${selectedLocker}-${selectedMemberId}`}
                name="memberId"
                defaultValue={selectedMemberId}
                required
                className="h-10 w-full rounded-lg border border-border px-3"
              >
                <option value="">Select active member</option>
                {activeMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                    {member.locker_number ? ` (current locker ${member.locker_number})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="self-end">
              <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
                Save Assignment
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="table-wrap">
        <form method="get" className="grid gap-2 md:grid-cols-4">
          <input
            name="q"
            defaultValue={rawQuery}
            placeholder="Search locker or member"
            className="h-10 rounded-lg border border-border px-3"
          />
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3">
            <option value="all">All</option>
            <option value="assigned">Assigned</option>
            <option value="open">Open</option>
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
          <Link href="/operations/locker-assignments" className="h-10 rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10">
            Clear
          </Link>
        </form>

        <p className="mt-2 text-xs text-muted">
          Showing {totalRows === 0 ? 0 : startIndex + 1} - {Math.min(startIndex + pageRows.length, totalRows)} of {totalRows} lockers (25 per page).
        </p>

        <table className="mt-3">
          <thead>
            <tr>
              <th>Locker #</th>
              <th>Current Member Assigned</th>
              <th>Previous Member Assigned</th>
              <th>Status</th>
              <th>Assignment Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">No locker rows match this filter.</td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.locker}>
                  <td className="font-semibold">{row.locker}</td>
                  <td>
                    {row.currentMember ? (
                      <Link href={`/operations/member-command-center/${row.currentMember.id}`} className="font-semibold text-brand">
                        {row.currentMember.display_name}
                      </Link>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td>{row.previousMember ?? "-"}</td>
                  <td>{row.status}</td>
                  <td>{row.currentMember ? formatOptionalDate(resolveLockerAssignmentDate(row.currentMember)) : "-"}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-2">
                      {canEdit ? (
                        <LockerAssignModalTrigger
                          assignAction={assignLockerAction}
                          defaultLocker={row.locker}
                          defaultMemberId={row.currentMember?.id}
                          activeMembers={activeMemberOptions}
                          availableLockerOptions={availableLockerOptions}
                          rawQuery={rawQuery}
                          status={status}
                          currentPage={currentPage}
                        />
                      ) : null}
                      {canEdit && row.currentMember ? (
                        <form action={clearLockerAction}>
                          <input type="hidden" name="memberId" value={row.currentMember.id} />
                          <input type="hidden" name="q" value={rawQuery} />
                          <input type="hidden" name="status" value={status} />
                          <input type="hidden" name="page" value={String(currentPage)} />
                          <input type="hidden" name="locker" value={row.locker} />
                          <button type="submit" className="text-sm font-semibold text-danger">Clear</button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {currentPage > 1 ? (
            <Link
              href={pageHref(currentPage - 1)}
              className="rounded border border-border px-3 py-1 font-semibold text-brand"
            >
              Previous
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded border border-border px-3 py-1 font-semibold text-muted">
              Previous
            </span>
          )}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <Link
              key={page}
              href={pageHref(page)}
              className={`rounded border px-3 py-1 ${page === currentPage ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
            >
              {page}
            </Link>
          ))}
          {currentPage < totalPages ? (
            <Link
              href={pageHref(currentPage + 1)}
              className="rounded border border-border px-3 py-1 font-semibold text-brand"
            >
              Next
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded border border-border px-3 py-1 font-semibold text-muted">
              Next
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

