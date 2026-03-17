"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";

import type { DevAuthBootstrapAccount } from "@/lib/services/staff-auth";
import { devBootstrapSignInAction } from "@/lib/actions/staff-auth";
import { Button } from "@/components/ui/button";

type DevAuthState = { ok?: boolean; message?: string; error?: string };

const initialState: DevAuthState = {};

export function DevAuthBootstrapPanel({ accounts }: { accounts: DevAuthBootstrapAccount[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (_: DevAuthState, formData: FormData) => {
    const result = await devBootstrapSignInAction(formData);
    if (result.ok) {
      router.replace("/");
    }
    return result;
  }, initialState);

  if (accounts.length === 0) {
    return <p className="text-sm text-muted">No bootstrap users are currently configured.</p>;
  }

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-2">
        <label className="block text-xs font-semibold text-muted" htmlFor="dev-auth-bootstrap-email">
          Select account
        </label>
        <select
          id="dev-auth-bootstrap-email"
          name="email"
          defaultValue={accounts[0].email}
          className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-slate-900"
          disabled={pending}
        >
          {accounts.map((account) => (
            <option key={`${account.role}:${account.email}`} value={account.email}>
              {account.label} ({account.email})
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Switching..." : "Switch Role"}
        </Button>
      </form>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.message ? <p className="text-sm text-[#0f2943]">{state.message}</p> : null}
    </div>
  );
}
