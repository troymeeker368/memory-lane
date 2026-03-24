import { redirect } from "next/navigation";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OperationsHoldsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const memberId = firstString(params.memberId);
  const date = firstString(params.date);

  if (memberId) {
    const query = new URLSearchParams({ tab: "holds" });
    if (date) query.set("date", date);
    redirect(`/operations/member-command-center/${memberId}?${query.toString()}`);
  }

  redirect("/operations/member-command-center");
}
