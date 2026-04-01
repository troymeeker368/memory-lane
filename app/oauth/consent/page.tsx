import Link from "next/link";
import { redirect } from "next/navigation";

import { OAuthConsentForm } from "@/components/auth/oauth-consent-form";
import { Card } from "@/components/ui/card";
import { getOAuthConsentRequest } from "@/lib/services/oauth-consent";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function buildConsentPath(authorizationId: string) {
  const params = new URLSearchParams({ authorization_id: authorizationId });
  return `/oauth/consent?${params.toString()}`;
}

function formatHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function getFriendlyConsentError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unable to load this authorization request. It may be invalid or expired.";
  }

  const normalizedMessage = error.message.trim();
  if (!normalizedMessage) {
    return "Unable to load this authorization request. It may be invalid or expired.";
  }

  return normalizedMessage;
}

export default async function OAuthConsentPage({
  searchParams
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const params = await searchParams;
  const authorizationId = String(params.authorization_id ?? "").trim();

  if (!authorizationId) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4">
        <Card className="w-full bg-white">
          <h1 className="text-xl font-bold">Authorization Request Missing</h1>
          <p className="mt-3 text-sm text-muted">
            This page needs an <code>authorization_id</code> query parameter from Supabase Auth.
          </p>
        </Card>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(buildConsentPath(authorizationId))}`);
  }

  try {
    const result = await getOAuthConsentRequest(authorizationId);
    if (result.kind === "redirect") {
      redirect(result.redirectUrl);
    }

    const request = result.request;

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-8">
        <Card className="w-full bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Supabase OAuth</p>
          <h1 className="mt-3 text-2xl font-bold text-fg">Allow {request.client.name} to access Memory Lane?</h1>
          <p className="mt-3 text-sm text-muted">
            You are signed in as <span className="font-semibold text-fg">{request.user.email}</span>. Review the
            request below before approving access.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Application</p>
              <p className="mt-2 text-base font-semibold text-fg">{request.client.name}</p>
              <p className="mt-1 break-all text-sm text-muted">{request.client.uri}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Destination</p>
              <p className="mt-2 break-all text-sm text-fg">{request.redirectUri}</p>
            </div>
            <div className="rounded-xl border border-border bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">What this means</p>
              <p className="mt-2 text-sm text-fg">
                If you approve, <span className="font-semibold">{request.client.name}</span> will receive an OAuth code
                and continue at <span className="font-semibold">{formatHost(request.redirectUri)}</span>.
              </p>
              <p className="mt-3 text-sm text-muted">
                Only approve if you trust this app and expect it to connect to your Supabase project.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Requested Scopes</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {request.scopes.length > 0 ? (
                request.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-full border border-border bg-slate-50 px-3 py-1 text-xs font-semibold text-fg"
                  >
                    {scope}
                  </span>
                ))
              ) : (
                <p className="text-sm text-muted">No scopes were provided in this authorization request.</p>
              )}
            </div>
          </div>

          <OAuthConsentForm authorizationId={request.authorizationId} />

          <p className="mt-4 text-xs text-muted">
            Need to sign in with a different account?{" "}
            <Link href="/auth/signout" className="font-semibold text-brand">
              Sign out first
            </Link>
            .
          </p>
        </Card>
      </main>
    );
  } catch (error) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4">
        <Card className="w-full bg-white">
          <h1 className="text-xl font-bold">Authorization Request Unavailable</h1>
          <p className="mt-3 text-sm text-danger">{getFriendlyConsentError(error)}</p>
          <p className="mt-3 text-sm text-muted">
            Open the OAuth flow again from the app that requested access, or contact an administrator if this keeps
            happening.
          </p>
        </Card>
      </main>
    );
  }
}
