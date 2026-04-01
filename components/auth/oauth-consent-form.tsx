"use client";

import { useActionState } from "react";

import { submitOAuthConsentAction, type OAuthConsentActionState } from "@/lib/actions/oauth-consent";
import { Button } from "@/components/ui/button";

const initialState: OAuthConsentActionState = {};

export function OAuthConsentForm({ authorizationId }: { authorizationId: string }) {
  const [state, formAction, pending] = useActionState(submitOAuthConsentAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="authorizationId" value={authorizationId} />
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className="w-full sm:flex-1"
        >
          {pending ? "Processing..." : "Approve Access"}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="deny"
          disabled={pending}
          className="w-full border border-border bg-white text-fg hover:bg-slate-50 sm:flex-1"
        >
          {pending ? "Processing..." : "Deny Access"}
        </Button>
      </div>
    </form>
  );
}
