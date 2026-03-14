"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ nextPath = "/" }: { nextPath?: string }) {
  return (
    <form method="post" action="/auth/login" className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />
      <div className="space-y-1">
        <label className="text-sm font-semibold">Email</label>
        <Input name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-semibold">Password</label>
        <Input name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="text-right">
        <Link href="/auth/forgot-password" className="text-xs font-semibold text-brand">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" className="w-full">
        Sign In
      </Button>
    </form>
  );
}
