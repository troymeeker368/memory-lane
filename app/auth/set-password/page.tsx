import Link from "next/link";

import { completeSetPasswordAction } from "@/lib/actions/staff-auth";
import { createClient } from "@/lib/supabase/server";
import { PasswordUpdateForm } from "@/components/auth/password-update-form";
import { Card } from "@/components/ui/card";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <Card className="w-full bg-white">
        <h1 className="text-xl font-bold">Set Your Password</h1>
        <p className="mt-1 text-sm text-muted">Town Square Fort Mill Staff Portal</p>
        {!user ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-danger">
              Your set-password session is missing or expired. Use your latest invite email to open a new secure link.
            </p>
            <p className="text-sm text-muted">
              Need help? Contact your administrator or{" "}
              <Link href="/auth/forgot-password" className="font-semibold text-brand">
                request a reset link
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="mt-5">
            <PasswordUpdateForm action={completeSetPasswordAction} submitLabel="Set Password" />
          </div>
        )}
      </Card>
    </main>
  );
}
