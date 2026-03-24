import { redirect } from "next/navigation";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function LockerAssignmentsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const memberId = firstString(params.memberId);
  const success = firstString(params.success);
  const error = firstString(params.error);

  if (memberId) {
    const query = new URLSearchParams({ tab: "locker-assignments" });
    if (success) query.set("success", success);
    if (error) query.set("error", error);
    redirect(`/operations/member-command-center/${memberId}?${query.toString()}`);
  }

  redirect("/operations/member-command-center");
}
