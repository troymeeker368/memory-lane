import { redirect } from "next/navigation";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OperationsAdditionalChargesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const memberId = firstString(params.memberId);

  if (memberId) {
    redirect(`/operations/member-command-center/${memberId}?tab=additional-charges`);
  }

  redirect("/operations/member-command-center");
}
