import { notFound } from "next/navigation";

import { Card } from "@/components/ui/card";
import { DevAuthBootstrapPanel } from "@/components/auth/dev-auth-bootstrap-panel";
import { listDevAuthBootstrapAccounts } from "@/lib/services/staff-auth";
import { isDevAuthBypassEnabled } from "@/lib/runtime";

export default async function DevAuthPage() {
  if (!isDevAuthBypassEnabled()) {
    notFound();
  }

  const accounts = await listDevAuthBootstrapAccounts();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4">
      <Card className="w-full bg-white">
        <h1 className="text-xl font-bold">Dev Auth Bootstrap</h1>
        <p className="mt-1 text-sm text-muted">Non-production only. Signs in with real Supabase sessions.</p>
        <p className="mt-3 text-sm text-muted">
          This page is hard-disabled when <code>NODE_ENV=production</code> or when <code>ENABLE_DEV_AUTH_BYPASS</code> is not enabled.
        </p>
        <div className="mt-5">
          <DevAuthBootstrapPanel accounts={accounts} />
        </div>
      </Card>
    </main>
  );
}
