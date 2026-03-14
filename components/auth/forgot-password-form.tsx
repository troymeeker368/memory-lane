"use client";

import { useActionState } from "react";

import { requestForgotPasswordAction } from "@/lib/actions/staff-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ForgotPasswordState = { ok?: boolean; message?: string; error?: string };

const initialState: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    async (_: ForgotPasswordState, formData: FormData) => requestForgotPasswordAction(formData),
    initialState
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-semibold">Email</label>
        <Input name="email" type="email" autoComplete="email" required />
      </div>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.message ? <p className="text-sm text-[#0f2943]">{state.message}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending..." : "Send Reset Link"}
      </Button>
    </form>
  );
}
