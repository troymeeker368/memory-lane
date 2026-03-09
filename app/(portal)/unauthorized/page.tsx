import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function UnauthorizedPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const module = firstParam(params.module);
  const action = firstParam(params.action);

  return (
    <Card>
      <CardTitle>Unauthorized</CardTitle>
      <p className="mt-2 text-sm text-muted">
        Your account does not have permission to access this area.
        {module ? ` Module: ${module}.` : ""}
        {action ? ` Required action: ${action}.` : ""}
      </p>
      <div className="mt-3 flex gap-2">
        <Link href="/" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
          Return Home
        </Link>
      </div>
    </Card>
  );
}

