import Link from "next/link";

import { completeResetPasswordAction } from "@/lib/actions/staff-auth";
import { createClient } from "@/lib/supabase/server";
import { PasswordUpdateForm } from "@/components/auth/password-update-form";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <Card className="w-full bg-white">
        <h1 className="text-xl font-bold">Reset Password</h1>
        <p className="mt-1 text-sm text-muted">Town Square Fort Mill Staff Portal</p>
        {!user ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-danger">
              Your reset session is missing or expired. Request a new password reset link.
            </p>
            <p className="text-sm text-muted">
              <Link href="/auth/forgot-password" className="font-semibold text-brand">
                Send another reset email
              </Link>
            </p>
          </div>
        ) : (
          <div className="mt-5">
            <PasswordUpdateForm action={completeResetPasswordAction} submitLabel="Reset Password" />
          </div>
        )}
      </Card>
    </main>
  );
}
