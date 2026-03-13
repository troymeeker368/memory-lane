import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getPublicEnrollmentPacketContext,
  sendEnrollmentPacketRequest,
  submitPublicEnrollmentPacket,
  upsertEnrollmentPacketSenderSignatureProfile
} from "../lib/services/enrollment-packets";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

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
  const marker = "/sign/enrollment-packet/";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return null;
  const token = normalized.slice(markerIndex + marker.length).split(/[?#]/, 1)[0] ?? "";
  const cleaned = token.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseManualUrlFromError(errorMessage: string) {
  const match = /(https?:\/\/\S+\/sign\/enrollment-packet\/[a-z0-9]+)/i.exec(errorMessage);
  if (!match) return null;
  return clean(match[1]);
}

const DEFAULT_SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAABQCAYAAABfGf3FAAAACXBIWXMAAAsSAAALEgHS3X78AAABMElEQVR4nO3TMQ0AAAgDIN8/9K3hHBQJQk9m1gQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAb1mQAAQf0V9IAAAAASUVORK5CYII=";

type ActorRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  active: boolean | null;
};

type MemberCandidateRow = {
  id: string;
  display_name: string | null;
  source_lead_id: string | null;
  updated_at: string | null;
};

type LeadRow = {
  id: string;
  member_name: string | null;
  caregiver_email: string | null;
};

async function main() {
  loadEnvFiles();
  const admin = createSupabaseAdminClient();

  const { data: actorRows, error: actorError } = await admin
    .from("profiles")
    .select("id, full_name, email, role, active")
    .eq("active", true)
    .in("role", ["admin", "sales", "manager", "director"])
    .order("updated_at", { ascending: false })
    .limit(25);
  if (actorError) throw new Error(`Unable to load sender profile for E2E: ${actorError.message}`);
  const actor = ((actorRows ?? []) as ActorRow[]).find((row) => clean(row.full_name) && clean(row.id)) ?? null;
  if (!actor) throw new Error("No active sender profile found for enrollment packet E2E.");

  const senderName = clean(actor.full_name);
  if (!senderName) throw new Error("Selected sender profile has no full_name.");

  await upsertEnrollmentPacketSenderSignatureProfile({
    userId: actor.id,
    signatureName: clean(process.env.ENROLLMENT_E2E_SIGNATURE_NAME) ?? `${senderName} (E2E)`,
    signatureImageDataUrl: clean(process.env.ENROLLMENT_E2E_SIGNATURE_DATA_URL) ?? DEFAULT_SIGNATURE_DATA_URL
  });

  const forcedMemberId = clean(process.env.ENROLLMENT_E2E_MEMBER_ID);
  const forcedLeadId = clean(process.env.ENROLLMENT_E2E_LEAD_ID);
  const forcedCaregiverEmail = clean(process.env.ENROLLMENT_E2E_CAREGIVER_EMAIL);
  const appBaseUrl = clean(process.env.ENROLLMENT_E2E_APP_URL) ?? clean(process.env.NEXT_PUBLIC_APP_URL);
  const senderEmail = clean(process.env.ENROLLMENT_E2E_SENDER_EMAIL) ?? clean(actor.email);

  const { data: candidateRows, error: candidateError } = await admin
    .from("members")
    .select("id, display_name, source_lead_id, updated_at")
    .not("source_lead_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(150);
  if (candidateError) throw new Error(`Unable to load member candidates for E2E: ${candidateError.message}`);
  const memberCandidates = (candidateRows ?? []) as MemberCandidateRow[];
  const leadIds = Array.from(
    new Set(
      memberCandidates.map((row) => clean(row.source_lead_id)).filter((value): value is string => Boolean(value))
    )
  );
  if (leadIds.length === 0) throw new Error("No member candidates with source_lead_id were found.");

  const { data: leadRows, error: leadError } = await admin
    .from("leads")
    .select("id, member_name, caregiver_email")
    .in("id", leadIds);
  if (leadError) throw new Error(`Unable to load lead candidates for E2E: ${leadError.message}`);
  const leadById = new Map(((leadRows ?? []) as LeadRow[]).map((row) => [row.id, row] as const));

  const candidates = memberCandidates
    .map((member) => {
      const leadId = clean(member.source_lead_id);
      if (!leadId) return null;
      const lead = leadById.get(leadId);
      if (!lead) return null;
      return {
        memberId: member.id,
        memberName: clean(member.display_name) ?? clean(lead.member_name) ?? "Enrollment E2E Member",
        leadId,
        lead
      };
    })
    .filter((row): row is { memberId: string; memberName: string; leadId: string; lead: LeadRow } => Boolean(row));
  if (candidates.length === 0) throw new Error("No canonical member+lead candidates were found for E2E.");

  let created:
    | {
        requestId: string;
        requestUrl: string;
        token: string;
        memberId: string;
        memberName: string;
        leadId: string;
        caregiverEmail: string;
      }
    | null = null;
  let lastFailure: string | null = null;

  for (const candidate of candidates) {
    if (forcedMemberId && candidate.memberId !== forcedMemberId) continue;
    if (forcedLeadId && candidate.leadId !== forcedLeadId) continue;

    const caregiverQueue = Array.from(
      new Set(
        [
          forcedCaregiverEmail,
          clean(candidate.lead.caregiver_email),
          clean(actor.email),
          senderEmail
        ].filter((value): value is string => Boolean(value))
      )
    );
    if (caregiverQueue.length === 0) continue;

    const attemptedRecipients = new Set<string>();
    let candidateBlockedByActivePacket = false;

    while (caregiverQueue.length > 0) {
      const caregiverEmail = caregiverQueue.shift();
      if (!caregiverEmail || attemptedRecipients.has(caregiverEmail)) continue;
      attemptedRecipients.add(caregiverEmail);
      try {
        const sent = await sendEnrollmentPacketRequest({
          memberId: candidate.memberId,
          leadId: candidate.leadId,
          senderUserId: actor.id,
          senderFullName: senderName,
          senderEmail,
          caregiverEmail,
          requestedDays: ["Monday", "Wednesday", "Friday"],
          transportation: "Door to Door",
          optionalMessage: `Enrollment packet E2E live run ${new Date().toISOString()}`,
          appBaseUrl
        });
        const token = parseTokenFromRequestUrl(sent.requestUrl);
        if (!token) throw new Error("Unable to parse enrollment packet token from request URL.");
        created = {
          requestId: sent.request.id,
          requestUrl: sent.requestUrl,
          token,
          memberId: candidate.memberId,
          memberName: candidate.memberName,
          leadId: candidate.leadId,
          caregiverEmail
        };
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown enrollment send error";
        lastFailure = message;
        if (message.includes("An active enrollment packet already exists")) {
          candidateBlockedByActivePacket = true;
          break;
        }

        const resendTestingRecipient = parseResendTestingRecipient(message);
        if (resendTestingRecipient && !attemptedRecipients.has(resendTestingRecipient)) {
          caregiverQueue.unshift(resendTestingRecipient);
          continue;
        }

        const manualUrl = parseManualUrlFromError(message);
        const manualToken = parseTokenFromRequestUrl(manualUrl);
        if (manualToken) {
          const context = await getPublicEnrollmentPacketContext(manualToken);
          if (context.state === "ready") {
            created = {
              requestId: context.request.id,
              requestUrl: manualUrl!,
              token: manualToken,
              memberId: context.request.memberId,
              memberName: context.memberName,
              leadId: context.request.leadId ?? candidate.leadId,
              caregiverEmail
            };
            break;
          }
        }
      }
    }

    if (created) break;
    if (candidateBlockedByActivePacket) continue;
  }

  if (!created) {
    throw new Error(lastFailure ?? "Unable to create an enrollment packet request during E2E run.");
  }

  const initialContext = await getPublicEnrollmentPacketContext(created.token, {
    ip: "127.0.0.1",
    userAgent: "enrollment-e2e-live-script/1.0"
  });
  if (initialContext.state !== "ready") {
    throw new Error(`Public enrollment packet page is not ready. Received state: ${initialContext.state}`);
  }

  const caregiverTypedName = clean(process.env.ENROLLMENT_E2E_CAREGIVER_NAME) ?? "Enrollment E2E Caregiver";
  const caregiverSignatureDataUrl =
    clean(process.env.ENROLLMENT_E2E_CAREGIVER_SIGNATURE_DATA_URL) ?? DEFAULT_SIGNATURE_DATA_URL;

  await submitPublicEnrollmentPacket({
    token: created.token,
    caregiverTypedName,
    caregiverSignatureImageDataUrl: caregiverSignatureDataUrl,
    attested: true,
    caregiverIp: "127.0.0.1",
    caregiverUserAgent: "enrollment-e2e-live-script/1.0",
    caregiverName: caregiverTypedName,
    caregiverPhone: "555-0101",
    caregiverEmail: created.caregiverEmail,
    caregiverAddressLine1: "123 Main St",
    caregiverAddressLine2: "Apt 4",
    caregiverCity: "Tampa",
    caregiverState: "FL",
    caregiverZip: "33601",
    secondaryContactName: "Secondary Contact",
    secondaryContactPhone: "555-0102",
    secondaryContactEmail: "secondary.contact@example.com",
    secondaryContactRelationship: "Family",
    notes: "Enrollment E2E completion",
    uploads: [
      {
        fileName: "insurance-e2e.txt",
        contentType: "text/plain",
        bytes: Buffer.from("Insurance placeholder for enrollment packet E2E.", "utf8"),
        category: "insurance"
      },
      {
        fileName: "poa-e2e.txt",
        contentType: "text/plain",
        bytes: Buffer.from("POA placeholder for enrollment packet E2E.", "utf8"),
        category: "poa"
      },
      {
        fileName: "supporting-e2e.txt",
        contentType: "text/plain",
        bytes: Buffer.from("Supporting file placeholder for enrollment packet E2E.", "utf8"),
        category: "supporting"
      }
    ]
  });

  let tokenReuseBlocked = false;
  try {
    await submitPublicEnrollmentPacket({
      token: created.token,
      caregiverTypedName,
      caregiverSignatureImageDataUrl: caregiverSignatureDataUrl,
      attested: true,
      caregiverIp: "127.0.0.1",
      caregiverUserAgent: "enrollment-e2e-live-script/1.0"
    });
  } catch {
    tokenReuseBlocked = true;
  }

  const { data: requestRow, error: requestError } = await admin
    .from("enrollment_packet_requests")
    .select("id, status, completed_at, sent_at, member_id, lead_id, sender_user_id")
    .eq("id", created.requestId)
    .maybeSingle();
  if (requestError) throw new Error(`Unable to validate enrollment request row: ${requestError.message}`);

  const { data: signatureRows, error: signatureError } = await admin
    .from("enrollment_packet_signatures")
    .select("signer_role, signer_name, signed_at")
    .eq("packet_id", created.requestId);
  if (signatureError) throw new Error(`Unable to validate enrollment signatures: ${signatureError.message}`);

  const { data: uploadRows, error: uploadError } = await admin
    .from("enrollment_packet_uploads")
    .select("upload_category, file_type, member_file_id")
    .eq("packet_id", created.requestId);
  if (uploadError) throw new Error(`Unable to validate enrollment uploads: ${uploadError.message}`);

  const { data: memberFileRows, error: memberFileError } = await admin
    .from("member_files")
    .select("id, file_type, document_source")
    .eq("enrollment_packet_request_id", created.requestId);
  if (memberFileError) throw new Error(`Unable to validate member files persistence: ${memberFileError.message}`);

  const { data: leadActivityRows, error: leadActivityError } = await admin
    .from("lead_activities")
    .select("outcome, notes")
    .eq("lead_id", created.leadId)
    .order("activity_at", { ascending: false })
    .limit(30);
  if (leadActivityError) throw new Error(`Unable to validate lead activities: ${leadActivityError.message}`);

  const { data: eventRows, error: eventError } = await admin
    .from("enrollment_packet_events")
    .select("event_type")
    .eq("packet_id", created.requestId);
  if (eventError) throw new Error(`Unable to validate enrollment events: ${eventError.message}`);

  const { data: notificationRows, error: notificationError } = await admin
    .from("user_notifications")
    .select("id, title, message, created_at")
    .eq("recipient_user_id", actor.id)
    .eq("entity_id", created.requestId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (notificationError) throw new Error(`Unable to validate sender notifications: ${notificationError.message}`);

  const { data: scheduleRows, error: scheduleError } = await admin
    .from("member_attendance_schedules")
    .select("id, monday, wednesday, friday, transportation_mode, daily_rate")
    .eq("member_id", created.memberId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (scheduleError) throw new Error(`Unable to validate MCC attendance mapping: ${scheduleError.message}`);

  const { data: contactRows, error: contactError } = await admin
    .from("member_contacts")
    .select("id, category, contact_name, email, cellular_number")
    .eq("member_id", created.memberId)
    .order("updated_at", { ascending: false })
    .limit(15);
  if (contactError) throw new Error(`Unable to validate MCC contact mapping: ${contactError.message}`);

  const signatures = (signatureRows ?? []) as Array<{ signer_role: string | null; signer_name: string | null }>;
  const uploads = (uploadRows ?? []) as Array<{ upload_category: string | null; file_type: string | null; member_file_id: string | null }>;
  const memberFiles = (memberFileRows ?? []) as Array<{ id: string; file_type: string | null; document_source: string | null }>;
  const leadActivities = (leadActivityRows ?? []) as Array<{ outcome: string | null; notes: string | null }>;
  const events = (eventRows ?? []) as Array<{ event_type: string | null }>;
  const notifications = (notificationRows ?? []) as Array<{ id: string; title: string | null; message: string | null; created_at: string | null }>;
  const schedule = ((scheduleRows ?? []) as Array<Record<string, unknown>>)[0] ?? null;
  const contacts = (contactRows ?? []) as Array<Record<string, unknown>>;
  const responsibleContact = contacts.find((row) => String(row.category ?? "").toLowerCase() === "responsible party") ?? null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestId: created.requestId,
        memberId: created.memberId,
        leadId: created.leadId,
        requestUrl: created.requestUrl,
        finalStatus: requestRow?.status ?? null,
        sentAt: requestRow?.sent_at ?? null,
        completedAt: requestRow?.completed_at ?? null,
        tokenReuseBlocked,
        senderSignatureRecorded: signatures.some((row) => row.signer_role === "sender_staff"),
        caregiverSignatureRecorded: signatures.some((row) => row.signer_role === "caregiver"),
        uploadCategories: uploads.map((row) => row.upload_category ?? "unknown"),
        completedPacketDocxStored: uploads.some(
          (row) => row.upload_category === "completed_packet" && row.file_type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        memberFilesStoredCount: memberFiles.length,
        leadActivityOutcomes: leadActivities.map((row) => row.outcome ?? ""),
        leadActivitySentLogged: leadActivities.some((row) => row.outcome === "Enrollment Packet Sent"),
        leadActivityCompletedLogged: leadActivities.some((row) => row.outcome === "Enrollment Packet Completed"),
        eventTypes: events.map((row) => row.event_type ?? ""),
        senderNotificationCount: notifications.length,
        senderNotificationMessage: notifications[0]?.message ?? null,
        scheduleMapped: Boolean(schedule),
        scheduleTransportationMode: schedule ? String(schedule.transportation_mode ?? "") : null,
        responsibleContactEmail: responsibleContact ? String(responsibleContact.email ?? "") : null
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Enrollment packet E2E failed: ${message}`);
  process.exitCode = 1;
});
