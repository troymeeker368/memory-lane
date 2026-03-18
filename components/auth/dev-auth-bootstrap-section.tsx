import { DevAuthBootstrapPanel } from "@/components/auth/dev-auth-bootstrap-panel";
import { listDevAuthBootstrapAccounts } from "@/lib/services/dev-auth-bootstrap";

export async function DevAuthBootstrapSection() {
  const accounts = await listDevAuthBootstrapAccounts();

  return (
    <section className="space-y-2 rounded-lg border border-border bg-white px-3 py-3">
      <p className="text-xs font-semibold text-muted">Dev Role Switcher</p>
      <DevAuthBootstrapPanel accounts={accounts} />
    </section>
  );
}
