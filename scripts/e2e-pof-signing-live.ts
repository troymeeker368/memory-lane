import { existsSync, readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

function loadEnvFiles() {
  const parseEnvValue = (raw: string) => {
    const trimmed = raw.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  for (const fileName of [".env.local", ".env"]) {
    const fullPath = join(process.cwd(), fileName);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = parseEnvValue(trimmed.slice(eqIndex + 1));
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseResendTestingRecipient(errorMessage: string) {
  const match = /own email address \(([^)]+)\)/i.exec(errorMessage);
  if (!match) return null;
  return clean(match[1]);
}

function parseTokenFromRequestUrl(url: string | null | undefined) {
  const normalized = clean(url);
  if (!normalized) return null;
  const marker = "/sign/pof/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return null;
  const token = normalized.slice(markerIndex + marker.length).split(/[?#]/, 1)[0] ?? "";
  const cleaned = token.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function addDays(dateOnly: string, days: number) {
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function installServerOnlyShim() {
  type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  const moduleShim = Module as typeof Module & { _load: ModuleLoad };
  const originalLoad = moduleShim._load;

  moduleShim._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (
      request === "server-only" ||
      request.endsWith("\\server-only\\index.js") ||
      request.endsWith("/server-only/index.js")
    ) {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

const DEFAULT_SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAABQCAYAAABfGf3FAAAACXBIWXMAAAsSAAALEgHS3X78AAABMElEQVR4nO3TMQ0AAAgDIN8/9K3hHBQJQk9m1gQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAb1mQAAQf0V9IAAAAASUVORK5CYII=";

type ActorRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

type PhysicianOrderRow = {
  id: string;
  member_id: string;
  status: string;
  updated_at: string;
};

type ActivePofRequestRow = {
  id: string;
  physician_order_id: string;
  member_id: string;
  provider_name: string | null;
  provider_email: string | null;
  signature_request_url: string | null;
  status: string;
  updated_at: string;
};

async function main() {
  loadEnvFiles();
  installServerOnlyShim();

  const {
    getConfiguredClinicalSenderEmail,
    getPublicPofSigningContext,
    sendNewPofSignatureRequest,
    submitPublicPofSignature
  } = await import("../lib/services/pof-esign");
  const { createSupabaseAdminClient } = await import("../lib/supabase/admin");
  const { toEasternDate } = await import("../lib/timezone");

  const admin = createSupabaseAdminClient();
  const senderEmail = getConfiguredClinicalSenderEmail();
  if (!senderEmail) {
    throw new Error("Missing clinical sender email. Set CLINICAL_SENDER_EMAIL.");
  }

  const { data: actorRows, error: actorError } = await admin
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", ["admin", "nurse"])
    .order("updated_at", { ascending: false })
    .limit(10);
  if (actorError) throw new Error(`Unable to load actor profile: ${actorError.message}`);
  const actor = ((actorRows ?? []) as ActorRow[]).find((row) => clean(row.full_name)) ?? null;
  if (!actor) {
    throw new Error("No admin/nurse profile found for E2E run.");
  }
  const actorName = clean(actor.full_name)!;

  const forcedOrderId = clean(process.env.POF_E2E_POF_ID);
  const forcedMemberId = clean(process.env.POF_E2E_MEMBER_ID);
  const appBaseUrl = clean(process.env.POF_E2E_APP_URL) ?? clean(process.env.NEXT_PUBLIC_APP_URL);
  const providerName = clean(process.env.POF_E2E_PROVIDER_NAME) ?? "POF E2E Provider";
  const providerEmailCandidates = Array.from(
    new Set([clean(process.env.POF_E2E_PROVIDER_EMAIL), senderEmail, clean(actor.email)].filter((value): value is string => Boolean(value)))
  );
  if (providerEmailCandidates.length === 0) throw new Error("No provider email is available for E2E.");

  const { data: candidateOrders, error: orderError } = await admin
    .from("physician_orders")
    .select("id, member_id, status, updated_at")
    .neq("status", "superseded")
    .neq("status", "expired")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (orderError) throw new Error(`Unable to load physician orders: ${orderError.message}`);

  const orders = (candidateOrders ?? []) as PhysicianOrderRow[];
  const scopedOrders = orders.filter((row) => {
    if (forcedOrderId && row.id !== forcedOrderId) return false;
    if (forcedMemberId && row.member_id !== forcedMemberId) return false;
    return true;
  });
  const orderCandidates = scopedOrders;

  const expiresOnDate = addDays(toEasternDate(), 7);
  const optionalMessage = `POF E2E live test run at ${new Date().toISOString()}`;

  let createdRequest:
    | {
        id: string;
        physicianOrderId: string;
        memberId: string;
        providerEmail: string;
        signatureRequestUrl: string;
      }
    | null = null;
  let sendFailure: string | null = null;
  const { data: activeRequestRows, error: activeRequestError } = await admin
    .from("pof_requests")
    .select("id, physician_order_id, member_id, provider_name, provider_email, signature_request_url, status, updated_at")
    .in("status", ["sent", "opened"])
    .order("updated_at", { ascending: false })
    .limit(50);
  if (activeRequestError) throw new Error(`Unable to load active POF requests for E2E: ${activeRequestError.message}`);

  for (const row of (activeRequestRows ?? []) as ActivePofRequestRow[]) {
    if (forcedOrderId && row.physician_order_id !== forcedOrderId) continue;
    if (forcedMemberId && row.member_id !== forcedMemberId) continue;
    const token = parseTokenFromRequestUrl(row.signature_request_url);
    if (!token) continue;
    const context = await getPublicPofSigningContext(token, {
      ip: "127.0.0.1",
      userAgent: "pof-e2e-live-script/1.0"
    });
    if (context.state !== "ready") continue;
    createdRequest = {
      id: row.id,
      physicianOrderId: row.physician_order_id,
      memberId: row.member_id,
      providerEmail: clean(row.provider_email) ?? providerEmailCandidates[0],
      signatureRequestUrl: row.signature_request_url ?? `${clean(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3001"}/sign/pof/${token}`
    };
    break;
  }

  if (!createdRequest && orderCandidates.length === 0) {
    throw new Error("No physician order candidates found for E2E run.");
  }

  for (const order of createdRequest ? [] : orderCandidates) {
    let orderBlockedByActiveRequest = false;
    let orderFailure: string | null = null;
    const providerQueue = [...providerEmailCandidates];
    const attemptedProviders = new Set<string>();

    while (providerQueue.length > 0) {
      const providerEmail = providerQueue.shift();
      if (!providerEmail || attemptedProviders.has(providerEmail)) continue;
      attemptedProviders.add(providerEmail);
      try {
        const request = await sendNewPofSignatureRequest({
          physicianOrderId: order.id,
          memberId: order.member_id,
          providerName,
          providerEmail,
          nurseName: actorName,
          fromEmail: senderEmail,
          appBaseUrl,
          optionalMessage,
          expiresOnDate,
          actor: {
            id: actor.id,
            fullName: actorName
          }
        });
        createdRequest = {
          id: request.id,
          physicianOrderId: request.physicianOrderId,
          memberId: request.memberId,
          providerEmail,
          signatureRequestUrl: request.signatureRequestUrl
        };
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown send error";
        orderFailure = message;
        sendFailure = message;
        if (message.includes("An active signature request already exists")) {
          orderBlockedByActiveRequest = true;
          break;
        }
        const resendTestingRecipient = parseResendTestingRecipient(message);
        if (resendTestingRecipient && !attemptedProviders.has(resendTestingRecipient)) {
          providerQueue.unshift(resendTestingRecipient);
          continue;
        }
      }
    }

    if (createdRequest) break;
    if (orderBlockedByActiveRequest) continue;
    if (orderFailure) continue;
  }

  if (!createdRequest) {
    throw new Error(sendFailure ?? "Unable to create an E2E signature request.");
  }

  const token = clean(createdRequest.signatureRequestUrl.split("/sign/pof/")[1]);
  if (!token) throw new Error("E2E token parse failed.");

  const context = await getPublicPofSigningContext(token, {
    ip: "127.0.0.1",
    userAgent: "pof-e2e-live-script/1.0"
  });
  if (context.state !== "ready") {
    throw new Error(`Signing page is not ready. Received state: ${context.state}`);
  }

  const signatureImageDataUrl = clean(process.env.POF_E2E_SIGNATURE_DATA_URL) ?? DEFAULT_SIGNATURE_DATA_URL;
  const submitResult = await submitPublicPofSignature({
    token,
    providerTypedName: providerName,
    signatureImageDataUrl,
    attested: true,
    providerIp: "127.0.0.1",
    providerUserAgent: "pof-e2e-live-script/1.0"
  });

  let tokenReuseBlocked = false;
  try {
    await submitPublicPofSignature({
      token,
      providerTypedName: providerName,
      signatureImageDataUrl,
      attested: true,
      providerIp: "127.0.0.1",
      providerUserAgent: "pof-e2e-live-script/1.0"
    });
  } catch {
    tokenReuseBlocked = true;
  }

  const { data: requestRow, error: requestError } = await admin
    .from("pof_requests")
    .select("id, status, signed_at, member_file_id, signed_pdf_url, physician_order_id")
    .eq("id", createdRequest.id)
    .maybeSingle();
  if (requestError) throw new Error(`Unable to validate signed request: ${requestError.message}`);

  const { data: signatureRow, error: signatureError } = await admin
    .from("pof_signatures")
    .select("id, pof_request_id, provider_typed_name, signed_at")
    .eq("pof_request_id", createdRequest.id)
    .maybeSingle();
  if (signatureError) throw new Error(`Unable to validate signature row: ${signatureError.message}`);

  const { data: eventRows, error: eventsError } = await admin
    .from("document_events")
    .select("event_type")
    .eq("document_id", createdRequest.id);
  if (eventsError) throw new Error(`Unable to validate document events: ${eventsError.message}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestId: createdRequest.id,
        physicianOrderId: createdRequest.physicianOrderId,
        memberId: createdRequest.memberId,
        requestStatus: requestRow?.status ?? null,
        providerEmail: createdRequest.providerEmail,
        signedAt: requestRow?.signed_at ?? null,
        memberFileId: requestRow?.member_file_id ?? null,
        signedPdfStored: Boolean(requestRow?.signed_pdf_url),
        signatureRecorded: Boolean(signatureRow?.id),
        tokenReuseBlocked,
        eventTypes: (eventRows ?? []).map((row) => row.event_type),
        signedPdfUrl: submitResult.signedPdfUrl
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`POF E2E failed: ${message}`);
  process.exitCode = 1;
});
