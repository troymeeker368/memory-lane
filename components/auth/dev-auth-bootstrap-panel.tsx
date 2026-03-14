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
      router.refresh();
    }
    return result;
  }, initialState);

  if (accounts.length === 0) {
    return <p className="text-sm text-muted">No bootstrap users are currently configured.</p>;
  }

  return (
    <div className="space-y-3">
      {accounts.map((account) => (
        <form action={formAction} key={`${account.role}:${account.email}`}>
          <input type="hidden" name="email" value={account.email} />
          <Button type="submit" disabled={pending} className="w-full justify-between">
            <span>{account.label}</span>
            <span className="text-xs font-medium text-white/80">{account.email}</span>
          </Button>
        </form>
      ))}
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.message ? <p className="text-sm text-[#0f2943]">{state.message}</p> : null}
    </div>
  );
}
