import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Card } from "@/components/ui/card";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <Card className="w-full bg-white">
        <h1 className="text-xl font-bold">Forgot Password</h1>
        <p className="mt-1 text-sm text-muted">Town Square Fort Mill Staff Portal</p>
        <p className="mt-4 text-sm text-muted">
          Enter your staff email and we&apos;ll send a secure password reset link.
        </p>
        <div className="mt-5">
          <ForgotPasswordForm />
        </div>
        <p className="mt-4 text-sm text-muted">
          Remembered your password?{" "}
          <Link href="/login" className="font-semibold text-brand">
            Back to login
          </Link>
        </p>
      </Card>
    </main>
  );
}
