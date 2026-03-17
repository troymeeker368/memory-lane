import { LoginForm } from "@/components/login-form";
import { DevAuthBootstrapPanel } from "@/components/auth/dev-auth-bootstrap-panel";
import { Card } from "@/components/ui/card";
import { isDevAuthBypassEnabled } from "@/lib/runtime";
import { listDevAuthBootstrapAccounts } from "@/lib/services/dev-auth-bootstrap";
import Link from "next/link";

function getAuthIssueMessage(reason: string | undefined) {
  if (reason === "invalid-credentials") {
    return "Email or password was incorrect. Please try again.";
  }

  if (reason === "no-auth-user") {
    return "No authenticated user session was found. Please sign in.";
  }

  if (reason === "no-linked-profile") {
    return "You are authenticated, but no linked profile row exists in public.profiles for this user.";
  }

  if (reason === "inactive-profile") {
    return "Your linked profile exists but is marked inactive. Contact an administrator.";
  }

  if (reason === "disabled-profile") {
    return "Your login is currently disabled. Contact an administrator.";
  }

  if (reason === "password-setup-required") {
    return "You must complete the set-password step before signing in.";
  }

  if (reason === "profile-check-failed") {
    return "We could not validate your staff profile session. Please sign in again.";
  }

  if (reason === "auth-link-failed") {
    return "The secure auth link is invalid or expired. Request a new link and try again.";
  }

  if (reason === "invalid-auth-link") {
    return "This auth link is missing required verification parameters.";
  }

  return null;
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const params = await searchParams;
  const authIssueMessage = getAuthIssueMessage(params.reason);
  const showDevBootstrap = isDevAuthBypassEnabled();
  const devBootstrapAccounts = showDevBootstrap ? await listDevAuthBootstrapAccounts() : [];
  const nextPath =
    typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//")
      ? params.next
      : "/";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <Card className="w-full bg-white">
        <h1 className="text-xl font-bold">Memory Lane Staff Login</h1>
        <p className="mt-1 text-sm text-muted">Town Square Fort Mill</p>
        {authIssueMessage ? <p className="mt-3 text-sm text-danger">{authIssueMessage}</p> : null}
        <div className="mt-5">
          <LoginForm nextPath={nextPath} />
        </div>
        {showDevBootstrap ? (
          <div className="mt-5 space-y-3 rounded-lg border border-border bg-[#f8fbff] p-3">
            <p className="text-xs font-semibold text-[#0f2943]">Dev Role Switcher</p>
            <DevAuthBootstrapPanel accounts={devBootstrapAccounts} />
            <p className="text-xs text-muted">
              Full bootstrap page:{" "}
              <Link href="/dev/auth" className="font-semibold text-brand">
                /dev/auth
              </Link>
            </p>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
