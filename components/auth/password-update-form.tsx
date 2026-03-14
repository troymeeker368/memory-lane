"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PasswordUpdateState = { ok?: boolean; message?: string; error?: string };
type PasswordUpdateAction = (formData: FormData) => Promise<PasswordUpdateState>;

const initialState: PasswordUpdateState = {};

export function PasswordUpdateForm({
  action,
  submitLabel
}: {
  action: PasswordUpdateAction;
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (_: PasswordUpdateState, formData: FormData) => {
    const result = await action(formData);
    if (result.ok) {
      router.push("/");
    }
    return result;
  }, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-semibold">New Password</label>
        <Input name="password" type="password" autoComplete="new-password" required />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-semibold">Confirm Password</label>
        <Input name="confirmPassword" type="password" autoComplete="new-password" required />
      </div>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.message ? <p className="text-sm text-[#0f2943]">{state.message}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
