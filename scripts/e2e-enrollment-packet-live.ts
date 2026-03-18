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

function isExpiredTimestamp(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return true;
  const expiresAtMs = Date.parse(normalized);
  if (Number.isNaN(expiresAtMs)) return true;
  return Date.now() > expiresAtMs;
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

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
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

type ActiveEnrollmentPacketRequestRow = {
  id: string;
  member_id: string;
  lead_id: string | null;
  caregiver_email: string | null;
  status: string | null;
  delivery_status: string | null;
  token: string | null;
  token_expires_at: string | null;
  updated_at: string | null;
};

const ACTIVE_ENROLLMENT_PACKET_STATUSES = ["draft", "prepared", "sent", "opened", "partially_completed", "completed"] as const;

function isReusablePreparedRequest(row: ActiveEnrollmentPacketRequestRow) {
  const status = clean(row.status)?.toLowerCase();
  const deliveryStatus = clean(row.delivery_status)?.toLowerCase();
  return status === "prepared" && (deliveryStatus === "ready_to_send" || deliveryStatus === "send_failed");
}

async function main() {
  loadEnvFiles();
  installServerOnlyShim();

  const {
    getPublicEnrollmentPacketContext,
    sendEnrollmentPacketRequest,
    submitPublicEnrollmentPacket,
    upsertEnrollmentPacketSenderSignatureProfile
  } = await import("../lib/services/enrollment-packets");
  const { createSupabaseAdminClient } = await import("../lib/supabase/admin");

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
  const { data: activePacketRows, error: activePacketError } = await admin
    .from("enrollment_packet_requests")
    .select("id, member_id, lead_id, caregiver_email, status, delivery_status, token, token_expires_at, updated_at")
    .in("status", [...ACTIVE_ENROLLMENT_PACKET_STATUSES]);
  if (activePacketError) throw new Error(`Unable to load active enrollment packet state: ${activePacketError.message}`);
  const activeRequests = (activePacketRows ?? []) as ActiveEnrollmentPacketRequestRow[];
  const blockedMemberIds = new Set(
    activeRequests
      .filter((row) => !isExpiredTimestamp(row.token_expires_at))
      .filter((row) => !isReusablePreparedRequest(row))
      .map((row) => clean(row.member_id))
      .filter((value): value is string => Boolean(value))
  );
  const leadIds = Array.from(
    new Set(
      memberCandidates
        .filter((row) => !blockedMemberIds.has(row.id))
        .map((row) => clean(row.source_lead_id))
        .filter((value): value is string => Boolean(value))
    )
  );
  const leadById = new Map<string, LeadRow>();
  if (leadIds.length > 0) {
    const { data: leadRows, error: leadError } = await admin
      .from("leads")
      .select("id, member_name, caregiver_email")
      .in("id", leadIds);
    if (leadError) throw new Error(`Unable to load lead candidates for E2E: ${leadError.message}`);
    for (const row of (leadRows ?? []) as LeadRow[]) {
      leadById.set(row.id, row);
    }
  }

  const candidates = memberCandidates
    .filter((member) => !blockedMemberIds.has(member.id))
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
  if (candidates.length === 0) {
    throw new Error("No canonical member+lead candidates were found for E2E.");
  }

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
  const signatureDate = todayDateString();
  const primaryContactAddressLine1 = "123 Main St";
  const primaryContactCity = "Tampa";
  const primaryContactState = "FL";
  const primaryContactZip = "33601";
  const secondaryContactAddressLine1 = "456 Oak Ave";
  const secondaryContactCity = "Tampa";
  const secondaryContactState = "FL";
  const secondaryContactZip = "33602";
  const intakePayload = {
    memberGender: "Female",
    primaryContactAddress: primaryContactAddressLine1,
    primaryContactAddressLine1,
    primaryContactCity,
    primaryContactState,
    primaryContactZip,
    secondaryContactAddress: secondaryContactAddressLine1,
    secondaryContactAddressLine1,
    secondaryContactCity,
    secondaryContactState,
    secondaryContactZip,
    pcpName: "E2E Primary Care",
    pcpAddress: "789 Clinic Dr, Tampa, FL 33603",
    pcpPhone: "8135550103",
    pharmacy: "E2E Pharmacy",
    pharmacyAddress: "101 Pharmacy Ln, Tampa, FL 33604",
    pharmacyPhone: "8135550104",
    paymentMethodSelection: "ACH",
    bankName: "Enrollment E2E Credit Union",
    bankAba: "021000021",
    bankAccountNumber: "1234567890",
    fallsHistory: "No",
    membershipMemberSignatureName: created.memberName,
    membershipMemberSignatureDate: signatureDate,
    membershipGuarantorSignatureName: caregiverTypedName,
    membershipGuarantorSignatureDate: signatureDate,
    exhibitAGuarantorSignatureName: caregiverTypedName,
    exhibitAGuarantorSignatureDate: signatureDate,
    guarantorSignatureName: caregiverTypedName,
    guarantorSignatureDate: signatureDate,
    privacyAcknowledgmentSignatureName: caregiverTypedName,
    privacyAcknowledgmentSignatureDate: signatureDate,
    rightsAcknowledgmentSignatureName: caregiverTypedName,
    rightsAcknowledgmentSignatureDate: signatureDate,
    ancillaryChargesAcknowledgmentSignatureName: caregiverTypedName,
    ancillaryChargesAcknowledgmentSignatureDate: signatureDate,
    photoConsentAcknowledgmentName: caregiverTypedName,
    privacyPracticesAcknowledged: "Acknowledged",
    statementOfRightsAcknowledged: "Acknowledged",
    photoConsentAcknowledged: "Acknowledged",
    ancillaryChargesAcknowledged: "Acknowledged",
    photoConsentChoice: "I do permit"
  };

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
    primaryContactAddress: primaryContactAddressLine1,
    primaryContactAddressLine1,
    primaryContactCity,
    primaryContactState,
    primaryContactZip,
    caregiverAddressLine1: primaryContactAddressLine1,
    caregiverAddressLine2: "Apt 4",
    caregiverCity: primaryContactCity,
    caregiverState: primaryContactState,
    caregiverZip: primaryContactZip,
    secondaryContactName: "Secondary Contact",
    secondaryContactPhone: "555-0102",
    secondaryContactEmail: "secondary.contact@example.com",
    secondaryContactRelationship: "Family",
    secondaryContactAddress: secondaryContactAddressLine1,
    secondaryContactAddressLine1,
    secondaryContactCity,
    secondaryContactState,
    secondaryContactZip,
    notes: "Enrollment E2E completion",
    intakePayload,
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
