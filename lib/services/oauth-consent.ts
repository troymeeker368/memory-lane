import "server-only";

import { createClient } from "@/lib/supabase/server";

export type OAuthConsentDecision = "approve" | "deny";

export type OAuthConsentRequest = {
  authorizationId: string;
  client: {
    id: string;
    name: string;
    uri: string;
    logoUri: string;
  };
  user: {
    id: string;
    email: string;
  };
  redirectUri: string;
  scopes: string[];
};

export type OAuthConsentLookupResult =
  | {
      kind: "redirect";
      redirectUrl: string;
    }
  | {
      kind: "consent";
      request: OAuthConsentRequest;
    };

function normalizeAuthorizationId(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function splitScopes(scope: string) {
  return scope
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getOAuthErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") return fallback;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0 ? message : fallback;
}

export async function getOAuthConsentRequest(
  authorizationId: string
): Promise<OAuthConsentLookupResult> {
  const normalizedAuthorizationId = normalizeAuthorizationId(authorizationId);
  if (!normalizedAuthorizationId) {
    throw new Error("Missing authorization request id.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(normalizedAuthorizationId);

  if (error) {
    throw new Error(
      getOAuthErrorMessage(error, "Unable to load the OAuth consent request. It may be invalid or expired.")
    );
  }

  if (!data) {
    throw new Error("Supabase returned an empty OAuth consent response.");
  }

  if ("redirect_url" in data) {
    return {
      kind: "redirect",
      redirectUrl: data.redirect_url
    };
  }

  return {
    kind: "consent",
    request: {
      authorizationId: data.authorization_id,
      client: {
        id: data.client.id,
        name: data.client.name,
        uri: data.client.uri,
        logoUri: data.client.logo_uri
      },
      user: {
        id: data.user.id,
        email: data.user.email
      },
      redirectUri: data.redirect_uri,
      scopes: splitScopes(data.scope)
    }
  };
}

export async function submitOAuthConsentDecision(input: {
  authorizationId: string;
  decision: OAuthConsentDecision;
}) {
  const normalizedAuthorizationId = normalizeAuthorizationId(input.authorizationId);
  if (!normalizedAuthorizationId) {
    throw new Error("Missing authorization request id.");
  }

  const supabase = await createClient();
  const response =
    input.decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(normalizedAuthorizationId, {
          skipBrowserRedirect: true
        })
      : await supabase.auth.oauth.denyAuthorization(normalizedAuthorizationId, {
          skipBrowserRedirect: true
        });

  if (response.error) {
    throw new Error(
      getOAuthErrorMessage(
        response.error,
        `Unable to ${input.decision} the OAuth request. Please try again.`
      )
    );
  }

  if (!response.data?.redirect_url) {
    throw new Error("Supabase did not return a redirect URL after the OAuth decision.");
  }

  return response.data.redirect_url;
}
