"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";

import { signInAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LoginState = { error?: string; ok?: boolean };

const initialState: LoginState = {};

export function LoginForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (_: LoginState, formData: FormData) => {
    const result = await signInAction(formData);
    if (result.ok) {
      router.push("/");
    }
    return result;
  }, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-semibold">Email</label>
        <Input name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-semibold">Password</label>
        <Input name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}
