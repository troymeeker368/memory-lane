import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getCanonicalTrackSections } from "../lib/services/care-plan-track-definitions";
import { buildSeededMockDb } from "../lib/mock/seed";
import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "../lib/supabase/rpc";

type SeedModule = "sales" | "intake" | "attendance";

const VALID_MODULES: SeedModule[] = ["sales", "intake", "attendance"];
const SITE_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_SIZE = 250;
const TARGET_MEMBER_COUNT = 30;
const TARGET_LEAD_COUNT = 20;
const WEEKDAY_OPTIONS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const LEGACY_DEPENDENCY_TABLES = new Set(["pay_periods", "time_punches"]);
const FINALIZE_INTAKE_SIGNATURE_RPC = "rpc_finalize_intake_assessment_signature";
const PREPARE_ENROLLMENT_PACKET_REQUEST_RPC = "rpc_prepare_enrollment_packet_request";
const TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC = "rpc_transition_enrollment_packet_delivery_state";
const PREPARE_POF_REQUEST_DELIVERY_RPC = "rpc_prepare_pof_request_delivery";
const TRANSITION_POF_REQUEST_DELIVERY_STATE_RPC = "rpc_transition_pof_request_delivery_state";
const SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE_RPC = "rpc_sync_signed_pof_to_member_clinical_profile";
const SYNC_MHP_TO_COMMAND_CENTER_RPC = "rpc_sync_member_health_profile_to_command_center";
const SYNC_COMMAND_CENTER_TO_MHP_RPC = "rpc_sync_command_center_to_member_health_profile";
const MAR_MEDICATION_SYNC_RPC = "rpc_sync_mar_medications_from_member_profile";
const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";

type SeededDb = ReturnType<typeof buildSeededMockDb>;

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

function parseArgs(argv: string[]) {
  let reset = false;
  let legacyOnly = false;
  let skipRpcPass = false;
  const modules = new Set<SeedModule>();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--reset") reset = true;
    if (argv[i] === "--legacy-only") legacyOnly = true;
    if (argv[i] === "--skip-rpc-pass") skipRpcPass = true;
    if (argv[i] === "--module" && argv[i + 1]) {
      const mod = argv[i + 1] as SeedModule;
      if (!VALID_MODULES.includes(mod)) throw new Error(`Invalid module: ${argv[i + 1]}`);
      modules.add(mod);
      i += 1;
    }
    if (argv[i].startsWith("--module=")) {
      const mod = argv[i].split("=")[1] as SeedModule;
      if (!VALID_MODULES.includes(mod)) throw new Error(`Invalid module: ${mod}`);
      modules.add(mod);
    }
  }
  return { reset, legacyOnly, skipRpcPass, modules: modules.size > 0 ? [...modules] : [...VALID_MODULES] };
}

function assertSafeEnvironment(resetRequested = false) {
  const env = process.env.NODE_ENV ?? "development";
  const appEnv = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "").toLowerCase();
  const isDevLike = env === "development" || env === "test" || appEnv === "development" || appEnv === "preview" || appEnv === "local";

  if (env === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error("Refusing production seed. Set ALLOW_PRODUCTION_SEED=true to override.");
  }
  if (resetRequested && !isDevLike && process.env.ALLOW_NON_DEV_RESEED !== "true") {
    throw new Error("Reset/reseed is restricted to development-style environments. Set ALLOW_NON_DEV_RESEED=true to override.");
  }
}

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function parseLatLng(value: string | null | undefined) {
  if (!value) return { lat: null, lng: null };
  const [a, b] = value.split(",").map((v) => Number(v.trim()));
  if (Number.isNaN(a) || Number.isNaN(b)) return { lat: null, lng: null };
  return { lat: a, lng: b };
}

function asDateOnly(value: string | null | undefined, fallback: string | null = null) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIsoAt(date: string, hours = 12, minutes = 0) {
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00.000Z`;
}

function toTimeOnly(value: string | null | undefined) {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) return null;
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const mm = String(parsed.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ensureUuid(value: string | null | undefined, fallbackKey: string) {
  if (isUuid(value)) return value as string;
  return stableUuid(fallbackKey);
}

function isMissingTableError(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined, table: string) {
  if (!error) return false;
  if (error.code === "PGRST205") return true;
  const blob = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return blob.includes(table.toLowerCase()) && (blob.includes("does not exist") || blob.includes("not found") || blob.includes("schema cache"));
}

async function discoverExistingTables(supabase: ReturnType<typeof createSupabaseAdminClient>, tables: string[]) {
  const entries = await Promise.all(
    [...new Set(tables)].map(async (table) => {
      const { error } = await supabase.from(table).select("*", { count: "exact", head: true }).limit(1);
      if (!error) return [table, true] as const;
      if (isMissingTableError(error, table)) return [table, false] as const;
      throw new Error(`Unable to inspect table ${table}: ${error.message}`);
    })
  );
  return new Map(entries);
}

async function upsertRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: Record<string, unknown>[],
  existingTables?: Map<string, boolean>
) {
  if (existingTables?.get(table) === false) {
    console.log(`Skipping ${table}: table not found in current schema.`);
    return 0;
  }
  if (rows.length === 0) return 0;
  const dedupedById = new Map<string, Record<string, unknown>>();
  const withoutId: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = row.id;
    if (typeof id === "string" && id.trim().length > 0) {
      dedupedById.set(id, row);
    } else {
      withoutId.push(row);
    }
  }
  const normalizedRows = [...dedupedById.values(), ...withoutId];
  const conflictTargetByTable: Record<string, string> = {
    physician_orders: "member_id,version_number",
    enrollment_packet_sender_signatures: "user_id",
    intake_assessment_signatures: "assessment_id",
    pof_signatures: "pof_request_id",
    pof_medications: "physician_order_id,source_medication_id",
    member_health_profiles: "member_id"
  };
  const conflictTarget = conflictTargetByTable[table] ?? "id";
  let inserted = 0;
  for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
    const batch = normalizedRows.slice(i, i + BATCH_SIZE);
    let { error } = await supabase.from(table).upsert(batch, { onConflict: conflictTarget });
    const onConflictMessage = error?.message?.toLowerCase() ?? "";
    if (
      onConflictMessage.includes("no unique or exclusion constraint matching the on conflict specification") ||
      onConflictMessage.includes("column \"id\" does not exist") ||
      onConflictMessage.includes("id does not exist")
    ) {
      const retry = await supabase.from(table).upsert(batch);
      error = retry.error;
      if (error?.message?.toLowerCase().includes("no unique or exclusion constraint matching the on conflict specification")) {
        const fallbackInsert = await supabase.from(table).insert(batch);
        error = fallbackInsert.error;
      }
    }
    if (error) {
      if (isMissingTableError(error as { code?: string | null; message?: string | null; details?: string | null }, table)) {
        console.log(`Skipping ${table}: table not found in current schema.`);
        return 0;
      }
      throw new Error(`Upsert ${table} failed: ${error.message}`);
    }
    inserted += Math.min(BATCH_SIZE, normalizedRows.length - i);
  }
  return inserted;
}

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = [
    (error as { message?: string }).message,
    (error as { details?: string }).details,
    (error as { hint?: string }).hint
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

function normalizeEnrollmentPacketTransportation(value: unknown) {
  const normalized = cleanText(value)?.toLowerCase();
  if (!normalized || normalized === "none" || normalized === "family transport") return "None";
  if (normalized === "door to door" || normalized === "door-to-door") return "Door to Door";
  if (normalized === "bus stop") return "Bus Stop";
  if (normalized === "mixed") return "Mixed";
  return "None";
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((entry) => cleanText(entry)).filter((entry): entry is string => Boolean(entry));
}

function toObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function resolveEnrollmentPacketSeedDeliveryState(status: string | null | undefined) {
  const normalized = cleanText(status)?.toLowerCase() ?? "draft";
  if (normalized === "prepared") {
    return { status: "prepared", deliveryStatus: "ready_to_send", sentAt: null };
  }
  if (
    normalized === "sent" ||
    normalized === "opened" ||
    normalized === "partially_completed" ||
    normalized === "completed" ||
    normalized === "filed"
  ) {
    return { status: normalized, deliveryStatus: "sent", sentAt: true };
  }
  return { status: "draft", deliveryStatus: "pending_preparation", sentAt: null };
}

function resolvePofSeedDeliveryState(status: string | null | undefined) {
  const normalized = cleanText(status)?.toLowerCase() ?? "draft";
  if (normalized === "sent" || normalized === "opened" || normalized === "signed") {
    return { status: normalized, deliveryStatus: "sent", sentAt: true, updatePhysicianOrderSent: true };
  }
  if (normalized === "declined" || normalized === "expired") {
    return { status: normalized, deliveryStatus: "sent", sentAt: true, updatePhysicianOrderSent: false };
  }
  return { status: "draft", deliveryStatus: "pending_preparation", sentAt: null, updatePhysicianOrderSent: false };
}

async function applySeedRpcPass(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  rows: ReturnType<typeof buildRows>,
  staffMap: Map<string, string>,
  options: {
    modules: SeedModule[];
    legacyOnly: boolean;
  }
) {
  if (options.legacyOnly) {
    console.log("rpc_seed_pass: skipped=legacy_only");
    return;
  }

  const actorUserId = [...staffMap.values()][0] ?? null;
  if (!actorUserId) {
    throw new Error("Seed RPC pass is missing mapped profile ids.");
  }
  const actorName = "Seed RPC";
  const counts = new Map<string, number>();
  const increment = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
  const now = new Date().toISOString();
  const today = asDateOnly(now, "2026-03-01") as string;
  const marEndDate = addDays(today, 45);

  if (options.modules.includes("sales")) {
    const enrollmentFieldsByPacketId = new Map(
      rows.enrollmentPacketFields
        .map((row) => [cleanText((row as { packet_id?: unknown }).packet_id), row] as const)
        .filter((entry): entry is [string, (typeof rows.enrollmentPacketFields)[number]] => Boolean(entry[0]))
    );
    const enrollmentSenderSignatureByUserId = new Map(
      rows.enrollmentPacketSenderSignatures
        .map((row) => [cleanText((row as { user_id?: unknown }).user_id), row] as const)
        .filter((entry): entry is [string, (typeof rows.enrollmentPacketSenderSignatures)[number]] => Boolean(entry[0]))
    );

    for (const request of rows.enrollmentPacketRequests) {
      const packetId = cleanText((request as { id?: unknown }).id);
      const senderUserId = cleanText((request as { sender_user_id?: unknown }).sender_user_id);
      const caregiverEmail = cleanText((request as { caregiver_email?: unknown }).caregiver_email);
      if (!packetId || !senderUserId || !caregiverEmail) continue;
      const fields = enrollmentFieldsByPacketId.get(packetId);
      const senderSignature = enrollmentSenderSignatureByUserId.get(senderUserId);
      if (!fields || !senderSignature) continue;

      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, PREPARE_ENROLLMENT_PACKET_REQUEST_RPC, {
          p_packet_id: packetId,
          p_member_id: cleanText((request as { member_id?: unknown }).member_id),
          p_lead_id: cleanText((request as { lead_id?: unknown }).lead_id),
          p_sender_user_id: senderUserId,
          p_caregiver_email: caregiverEmail,
          p_token: cleanText((request as { token?: unknown }).token),
          p_token_expires_at: cleanText((request as { token_expires_at?: unknown }).token_expires_at),
          p_requested_days: toStringArray((fields as { requested_days?: unknown }).requested_days),
          p_transportation: normalizeEnrollmentPacketTransportation((fields as { transportation?: unknown }).transportation),
          p_community_fee: Number((fields as { community_fee?: unknown }).community_fee ?? 0),
          p_daily_rate: Number((fields as { daily_rate?: unknown }).daily_rate ?? 0),
          p_pricing_community_fee_id: cleanText((fields as { pricing_community_fee_id?: unknown }).pricing_community_fee_id),
          p_pricing_daily_rate_id: cleanText((fields as { pricing_daily_rate_id?: unknown }).pricing_daily_rate_id),
          p_pricing_snapshot: toObject((fields as { pricing_snapshot?: unknown }).pricing_snapshot),
          p_caregiver_name: cleanText((fields as { caregiver_name?: unknown }).caregiver_name),
          p_caregiver_phone: cleanText((fields as { caregiver_phone?: unknown }).caregiver_phone),
          p_intake_payload: toObject((fields as { intake_payload?: unknown }).intake_payload),
          p_signature_name: cleanText((senderSignature as { signature_name?: unknown }).signature_name),
          p_signature_blob: cleanText((senderSignature as { signature_blob?: unknown }).signature_blob),
          p_sender_email: "sales@memorylane.local",
          p_prepared_at: cleanText((request as { created_at?: unknown }).created_at) ?? now
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, PREPARE_ENROLLMENT_PACKET_REQUEST_RPC)) {
          throw new Error(
            "Enrollment packet request preparation RPC is not available. Apply Supabase migrations 0073_delivery_and_member_file_rpc_hardening.sql and 0076_rpc_returns_table_ambiguity_hardening.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_prepare_enrollment_packet_request");

      const delivery = resolveEnrollmentPacketSeedDeliveryState(cleanText((request as { status?: unknown }).status));
      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC, {
          p_packet_id: packetId,
          p_delivery_status: delivery.deliveryStatus,
          p_attempt_at:
            cleanText((request as { updated_at?: unknown }).updated_at) ??
            cleanText((request as { created_at?: unknown }).created_at) ??
            now,
          p_status: delivery.status,
          p_sent_at:
            delivery.sentAt === true
              ? cleanText((request as { sent_at?: unknown }).sent_at) ??
                cleanText((request as { updated_at?: unknown }).updated_at) ??
                cleanText((request as { created_at?: unknown }).created_at) ??
                now
              : null,
          p_delivery_error: null,
          p_expected_current_status: null
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC)) {
          throw new Error(
            "Enrollment packet delivery-state RPC is not available. Apply Supabase migrations 0073_delivery_and_member_file_rpc_hardening.sql and 0076_rpc_returns_table_ambiguity_hardening.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_transition_enrollment_packet_delivery_state");
    }

    for (const request of rows.pofRequests) {
      const requestId = cleanText((request as { id?: unknown }).id);
      const physicianOrderId = cleanText((request as { physician_order_id?: unknown }).physician_order_id);
      const memberId = cleanText((request as { member_id?: unknown }).member_id);
      const providerEmail = cleanText((request as { provider_email?: unknown }).provider_email);
      const nurseName = cleanText((request as { nurse_name?: unknown }).nurse_name) ?? actorName;
      const actorId = cleanText((request as { sent_by_user_id?: unknown }).sent_by_user_id) ?? actorUserId;
      if (!requestId || !physicianOrderId || !memberId || !providerEmail) continue;

      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, PREPARE_POF_REQUEST_DELIVERY_RPC, {
          p_request_id: requestId,
          p_physician_order_id: physicianOrderId,
          p_member_id: memberId,
          p_provider_name: cleanText((request as { provider_name?: unknown }).provider_name),
          p_provider_email: providerEmail,
          p_nurse_name: nurseName,
          p_from_email: cleanText((request as { from_email?: unknown }).from_email) ?? "clinical@memorylane.local",
          p_sent_by_user_id: actorId,
          p_optional_message: cleanText((request as { optional_message?: unknown }).optional_message),
          p_expires_at: cleanText((request as { expires_at?: unknown }).expires_at),
          p_signature_request_token: cleanText((request as { signature_request_token?: unknown }).signature_request_token),
          p_signature_request_url: cleanText((request as { signature_request_url?: unknown }).signature_request_url),
          p_unsigned_pdf_url: cleanText((request as { unsigned_pdf_url?: unknown }).unsigned_pdf_url),
          p_pof_payload_json: toObject((request as { pof_payload_json?: unknown }).pof_payload_json),
          p_actor_user_id: actorId,
          p_actor_name: nurseName,
          p_now:
            cleanText((request as { updated_at?: unknown }).updated_at) ??
            cleanText((request as { created_at?: unknown }).created_at) ??
            now
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, PREPARE_POF_REQUEST_DELIVERY_RPC)) {
          throw new Error(
            "POF request preparation RPC is not available. Apply Supabase migrations 0073_delivery_and_member_file_rpc_hardening.sql and 0080_pof_request_delivery_rpc_insert_alignment.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_prepare_pof_request_delivery");

      const delivery = resolvePofSeedDeliveryState(cleanText((request as { status?: unknown }).status));
      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, TRANSITION_POF_REQUEST_DELIVERY_STATE_RPC, {
          p_request_id: requestId,
          p_actor_user_id: actorId,
          p_actor_name: nurseName,
          p_delivery_status: delivery.deliveryStatus,
          p_attempt_at:
            cleanText((request as { updated_at?: unknown }).updated_at) ??
            cleanText((request as { created_at?: unknown }).created_at) ??
            now,
          p_status: delivery.status,
          p_sent_at:
            delivery.sentAt === true
              ? cleanText((request as { sent_at?: unknown }).sent_at) ??
                cleanText((request as { updated_at?: unknown }).updated_at) ??
                cleanText((request as { created_at?: unknown }).created_at) ??
                now
              : null,
          p_opened_at: cleanText((request as { opened_at?: unknown }).opened_at),
          p_signed_at: cleanText((request as { signed_at?: unknown }).signed_at),
          p_delivery_error: null,
          p_provider_name: cleanText((request as { provider_name?: unknown }).provider_name),
          p_update_physician_order_sent: delivery.updatePhysicianOrderSent
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, TRANSITION_POF_REQUEST_DELIVERY_STATE_RPC)) {
          throw new Error(
            "POF delivery-state RPC is not available. Apply Supabase migration 0073_delivery_and_member_file_rpc_hardening.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_transition_pof_request_delivery_state");
    }
  }

  if (options.modules.includes("intake")) {
    for (const signature of rows.intakeAssessmentSignatures) {
      const assessmentId = cleanText((signature as { assessment_id?: unknown }).assessment_id);
      const memberId = cleanText((signature as { member_id?: unknown }).member_id);
      if (!assessmentId || !memberId) continue;
      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, FINALIZE_INTAKE_SIGNATURE_RPC, {
          p_assessment_id: assessmentId,
          p_member_id: memberId,
          p_signed_by_user_id: cleanText((signature as { signed_by_user_id?: unknown }).signed_by_user_id),
          p_signed_by_name: cleanText((signature as { signed_by_name?: unknown }).signed_by_name),
          p_signed_at: cleanText((signature as { signed_at?: unknown }).signed_at) ?? now,
          p_signature_artifact_storage_path: cleanText(
            (signature as { signature_artifact_storage_path?: unknown }).signature_artifact_storage_path
          ),
          p_signature_artifact_member_file_id: cleanText(
            (signature as { signature_artifact_member_file_id?: unknown }).signature_artifact_member_file_id
          ),
          p_signature_metadata: toObject((signature as { signature_metadata?: unknown }).signature_metadata)
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, FINALIZE_INTAKE_SIGNATURE_RPC)) {
          throw new Error(
            "Intake assessment signature finalization RPC is not available. Apply Supabase migrations 0052_intake_assessment_signature_finalize_rpc.sql, 0074_fix_intake_signature_finalize_rpc_ambiguity.sql, and 0075_fix_intake_signature_finalize_rpc_conflict_ambiguity.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_finalize_intake_assessment_signature");
    }

    const signedOrderIds = rows.physicianOrders
      .filter((row) => cleanText((row as { status?: unknown }).status) === "signed")
      .map((row) => cleanText((row as { id?: unknown }).id))
      .filter((value): value is string => Boolean(value));

    for (const pofId of signedOrderIds) {
      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE_RPC, {
          p_pof_id: pofId,
          p_synced_at: now
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE_RPC)) {
          throw new Error(
            "Signed POF clinical sync RPC is not available. Apply Supabase migrations 0043_delivery_state_and_pof_post_sign_sync_rpc.sql and 0078_signed_pof_dnr_sync_alignment.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_sync_signed_pof_to_member_clinical_profile");
    }
  }

  if (options.modules.includes("intake") || options.modules.includes("attendance")) {
    const mhpMemberIds = new Set(
      rows.memberHealthProfiles
        .map((row) => cleanText((row as { member_id?: unknown }).member_id))
        .filter((value): value is string => Boolean(value))
    );
    const mccMemberIds = new Set(
      rows.memberCommandCenters
        .map((row) => cleanText((row as { member_id?: unknown }).member_id))
        .filter((value): value is string => Boolean(value))
    );
    const syncMemberIds = Array.from(new Set([...mhpMemberIds, ...mccMemberIds]));

    for (const memberId of syncMemberIds) {
      if (mhpMemberIds.has(memberId)) {
        try {
          await invokeSupabaseRpcOrThrow<unknown>(supabase, SYNC_MHP_TO_COMMAND_CENTER_RPC, {
            p_member_id: memberId,
            p_actor_user_id: actorUserId,
            p_actor_name: actorName,
            p_now: now
          });
        } catch (error) {
          if (isMissingRpcFunctionError(error, SYNC_MHP_TO_COMMAND_CENTER_RPC)) {
            throw new Error(
              "MHP to Command Center sync RPC is not available. Apply Supabase migrations 0056_shared_rpc_orchestration_hardening.sql, 0071_mhp_mcc_sync_rpc_member_id_ambiguity_fix.sql, 0072_mhp_gender_normalization_for_mcc_sync.sql, and 0066_billing_payor_sync_cleanup.sql, then rerun seed."
            );
          }
          throw error;
        }
        increment("rpc_sync_member_health_profile_to_command_center");
      }

      if (mccMemberIds.has(memberId)) {
        try {
          await invokeSupabaseRpcOrThrow<unknown>(supabase, SYNC_COMMAND_CENTER_TO_MHP_RPC, {
            p_member_id: memberId,
            p_actor_user_id: actorUserId,
            p_actor_name: actorName,
            p_now: now
          });
        } catch (error) {
          if (isMissingRpcFunctionError(error, SYNC_COMMAND_CENTER_TO_MHP_RPC)) {
            throw new Error(
              "Command Center to MHP sync RPC is not available. Apply Supabase migrations 0056_shared_rpc_orchestration_hardening.sql, 0071_mhp_mcc_sync_rpc_member_id_ambiguity_fix.sql, 0072_mhp_gender_normalization_for_mcc_sync.sql, and 0066_billing_payor_sync_cleanup.sql, then rerun seed."
            );
          }
          throw error;
        }
        increment("rpc_sync_command_center_to_member_health_profile");
      }
    }

    const signedOrderByMemberId = new Map<string, string>();
    rows.physicianOrders.forEach((row) => {
      const status = cleanText((row as { status?: unknown }).status);
      const memberId = cleanText((row as { member_id?: unknown }).member_id);
      const pofId = cleanText((row as { id?: unknown }).id);
      const activeSigned = Boolean((row as { is_active_signed?: unknown }).is_active_signed);
      if (!memberId || !pofId || status !== "signed") return;
      if (activeSigned || !signedOrderByMemberId.has(memberId)) {
        signedOrderByMemberId.set(memberId, pofId);
      }
    });

    const marMemberIds = Array.from(
      new Set(
        [
          ...rows.memberHealthProfiles.map((row) => cleanText((row as { member_id?: unknown }).member_id)),
          ...rows.memberMedications.map((row) => cleanText((row as { member_id?: unknown }).member_id)),
          ...rows.memberCommandCenters.map((row) => cleanText((row as { member_id?: unknown }).member_id))
        ].filter((value): value is string => Boolean(value))
      )
    );

    for (const memberId of marMemberIds) {
      const preferredPofId = signedOrderByMemberId.get(memberId) ?? null;
      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, MAR_MEDICATION_SYNC_RPC, {
          p_member_id: memberId,
          p_preferred_physician_order_id: preferredPofId,
          p_now: now
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, MAR_MEDICATION_SYNC_RPC)) {
          throw new Error(
            "MAR medication sync RPC is not available. Apply Supabase migration 0056_shared_rpc_orchestration_hardening.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_sync_mar_medications_from_member_profile");

      try {
        await invokeSupabaseRpcOrThrow<unknown>(supabase, MAR_RECONCILE_RPC, {
          p_member_id: memberId,
          p_start_date: today,
          p_end_date: marEndDate,
          p_preferred_physician_order_id: preferredPofId,
          p_now: now
        });
      } catch (error) {
        if (isMissingRpcFunctionError(error, MAR_RECONCILE_RPC)) {
          throw new Error(
            "MAR reconcile RPC is not available. Apply Supabase migration 0056_shared_rpc_orchestration_hardening.sql, then rerun seed."
          );
        }
        throw error;
      }
      increment("rpc_reconcile_member_mar_state");
    }
  }

  if (counts.size === 0) {
    console.log("rpc_seed_pass: no_applicable_rpcs");
    return;
  }
  for (const [label, count] of counts.entries()) {
    console.log(`rpc:${label}=${count}`);
  }
}

async function deleteRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  existingTables?: Map<string, boolean>
) {
  if (existingTables?.get(table) === false) return;
  const { error } = await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) {
    if (isMissingTableError(error, table)) return;
    throw new Error(`Reset ${table} failed: ${error.message}`);
  }
}

async function ensureAuthProfiles(supabase: ReturnType<typeof createSupabaseAdminClient>, db: SeededDb) {
  const map = new Map<string, string>();
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(listError.message);
  const byEmail = new Map((usersData.users ?? []).filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u.id] as const));

  for (const staff of db.staff) {
    const email = staff.email.toLowerCase();
    let userId = byEmail.get(email) ?? null;
    if (!userId) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: "SeedDataOnly!123",
        email_confirm: true,
        user_metadata: { full_name: staff.full_name, role: staff.role }
      });
      if (error) throw new Error(`Create auth user failed (${email}): ${error.message}`);
      userId = data.user?.id ?? null;
      if (!userId) throw new Error(`Auth id missing for ${email}`);
      byEmail.set(email, userId);
    }
    map.set(staff.id, userId);
  }

  const profileRows: Record<string, unknown>[] = [];
  db.staff.forEach((staff) => {
    const userId = map.get(staff.id);
    if (!userId) return;
    profileRows.push({
      id: userId,
      email: staff.email,
      full_name: staff.full_name,
      staff_id: staff.staff_id,
      role: staff.role,
      active: staff.active
    });
  });
  await upsertRows(supabase, "profiles", profileRows);
  return map;
}

function buildIntakeCascade(db: SeededDb, staffMap: Map<string, string>) {
  const byMemberDiagnoses = new Map<string, unknown[]>();
  const byMemberAllergies = new Map<string, unknown[]>();
  const byMemberMeds = new Map<string, unknown[]>();
  const byMemberProviders = new Map<string, SeededDb["memberProviders"][number][]>();
  const byMemberAssessment = new Map<string, SeededDb["assessments"][number]>();
  const byMemberMhp = new Map<string, SeededDb["memberHealthProfiles"][number]>();
  db.memberDiagnoses.forEach((row) => byMemberDiagnoses.set(row.member_id, [...(byMemberDiagnoses.get(row.member_id) ?? []), row]));
  db.memberAllergies.forEach((row) => byMemberAllergies.set(row.member_id, [...(byMemberAllergies.get(row.member_id) ?? []), row]));
  db.memberMedications.forEach((row) => byMemberMeds.set(row.member_id, [...(byMemberMeds.get(row.member_id) ?? []), row]));
  db.memberProviders.forEach((row) =>
    byMemberProviders.set(row.member_id, [...(byMemberProviders.get(row.member_id) ?? []), row])
  );
  db.assessments.forEach((row) => {
    const current = byMemberAssessment.get(row.member_id);
    if (!current || current.assessment_date < row.assessment_date) byMemberAssessment.set(row.member_id, row);
  });
  db.memberHealthProfiles.forEach((row) => byMemberMhp.set(row.member_id, row));

  const pofRows: Record<string, unknown>[] = [];
  const mhpRows: Record<string, unknown>[] = [];
  const activeSignedOrderByMember = new Map<string, string>();
  db.members.forEach((member, idx) => {
    const signedId = stableUuid(`pof-signed-${member.id}`);
    const oldSignedId = stableUuid(`pof-old-${member.id}`);
    const draftId = stableUuid(`pof-draft-${member.id}`);
    const sentId = stableUuid(`pof-sent-${member.id}`);
    const sourceAssessment = byMemberAssessment.get(member.id) ?? null;
    const sourceMhp = byMemberMhp.get(member.id) ?? null;
    const sourceMhpRecord = sourceMhp ? (sourceMhp as unknown as Record<string, unknown>) : {};
    const memberNameSnapshot = member.display_name ?? null;
    const memberDobSnapshot = member.dob ?? null;
    const diagnoses = byMemberDiagnoses.get(member.id) ?? [];
    const allergies = byMemberAllergies.get(member.id) ?? [];
    const medications = byMemberMeds.get(member.id) ?? [];
    const provider = (byMemberProviders.get(member.id) ?? [])[0] ?? null;
    const actorUserId = sourceAssessment?.created_by_user_id ? staffMap.get(sourceAssessment.created_by_user_id) ?? null : null;
    const actorName = sourceAssessment?.created_by_name ?? sourceAssessment?.completed_by ?? provider?.created_by_name ?? "Clinical Seed";
    const signedDate = asDateOnly(
      sourceAssessment?.assessment_date,
      member.latest_assessment_date ?? member.enrollment_date ?? addDays("2026-02-01", -(idx + 7))
    ) as string;
    const sentDate = addDays(signedDate, -2);
    const draftDate = addDays(signedDate, -4);
    const providerName = provider?.provider_name ?? sourceMhp?.provider_name ?? "Dr. Morgan White";

    const medicationPayload = medications.map((med, medIdx) => {
      const medRow = med as Record<string, unknown>;
      const timeSeed = medIdx % 3 === 0 ? "09:00" : medIdx % 3 === 1 ? "13:00" : "17:00";
      const statusText = String(medRow.medication_status ?? "").toLowerCase();
      const active = statusText !== "inactive";
      return {
        id: cleanText(medRow.id) ?? stableUuid(`pof-med-payload:${member.id}:${medIdx}`),
        name: cleanText(medRow.medication_name) ?? `Medication ${medIdx + 1}`,
        quantity: cleanText(medRow.quantity),
        dose: cleanText(medRow.dose),
        route: cleanText(medRow.route),
        frequency: cleanText(medRow.frequency),
        givenAtCenter: active,
        givenAtCenterTime24h: active ? timeSeed : null,
        prn: String(medRow.frequency ?? "").toLowerCase().includes("prn"),
        prnInstructions: String(medRow.frequency ?? "").toLowerCase().includes("prn")
          ? "Use as clinically indicated."
          : null,
        startDate: asDateOnly(cleanText(medRow.date_started), signedDate),
        endDate: asDateOnly(cleanText(medRow.inactivated_at)),
        active,
        provider: providerName,
        instructions: cleanText(medRow.comments),
        comments: cleanText(medRow.comments)
      };
    });

    const pushOrder = (input: {
      id: string;
      status: "draft" | "sent" | "signed" | "superseded";
      versionNumber: number;
      isActiveSigned: boolean;
      supersededBy?: string | null;
      createdDate: string;
      sentDate: string | null;
      signedDate: string | null;
      effectiveDate: string | null;
    }) => {
      pofRows.push({
        id: input.id,
        member_id: member.id,
        intake_assessment_id: sourceAssessment?.id ?? null,
        version_number: input.versionNumber,
        status: input.status,
        is_active_signed: input.isActiveSigned,
        superseded_by: input.supersededBy ?? null,
        superseded_at: input.status === "superseded" ? toIsoAt(signedDate, 8, 0) : null,
        sent_at: input.sentDate ? toIsoAt(input.sentDate, 10, 0) : null,
        signed_at: input.signedDate ? toIsoAt(input.signedDate, 14, 0) : null,
        effective_at: input.effectiveDate ? toIsoAt(input.effectiveDate, 15, 0) : null,
        next_renewal_due_date: input.signedDate ? addDays(input.signedDate, 365) : null,
        member_name_snapshot: memberNameSnapshot,
        member_dob_snapshot: memberDobSnapshot,
        sex: sourceMhp?.gender ?? (idx % 2 === 0 ? "Female" : "Male"),
        level_of_care:
          member.latest_assessment_track === "Track 3"
            ? "High support"
            : member.latest_assessment_track === "Track 2"
              ? "Moderate support"
              : "Routine support",
        dnr_selected: (member.code_status ?? sourceAssessment?.code_status ?? "Full Code").toUpperCase().includes("DNR"),
        vitals_blood_pressure: sourceAssessment?.vitals_bp ?? null,
        vitals_pulse: sourceAssessment?.vitals_hr ? String(sourceAssessment.vitals_hr) : null,
        vitals_oxygen_saturation: sourceAssessment?.vitals_o2_percent ? `${sourceAssessment.vitals_o2_percent}%` : null,
        vitals_respiration: sourceAssessment?.vitals_rr ? String(sourceAssessment.vitals_rr) : null,
        diagnoses,
        allergies,
        medications: medicationPayload,
        standing_orders: [
          { id: stableUuid(`standing-order:${member.id}:fall-risk`), text: "Fall risk precautions while ambulating." },
          { id: stableUuid(`standing-order:${member.id}:hydration`), text: "Encourage hydration throughout attendance day." }
        ],
        diet_order: {
          dietType: sourceAssessment?.diet_type ?? member.diet_type ?? sourceMhp?.diet_type ?? "Regular",
          dietOther: sourceAssessment?.diet_other ?? null,
          restrictions: sourceAssessment?.diet_restrictions_notes ?? member.diet_restrictions_notes ?? null
        },
        mobility_order: {
          mobilitySteadiness: sourceAssessment?.mobility_steadiness ?? member.mobility_status ?? null,
          mobilityAids: sourceAssessment?.mobility_aids ?? member.mobility_aids ?? null
        },
        adl_support: {
          dressingSupport: sourceAssessment?.dressing_support_status ?? member.dressing_support_status ?? null,
          toiletingNeeds: sourceAssessment?.incontinence_products ?? member.incontinence_products ?? null
        },
        continence_support: {
          bladder: sourceMhp?.bladder_continence ?? null,
          bowel: sourceMhp?.bowel_continence ?? null
        },
        behavior_orientation: {
          orientationDobVerified: sourceAssessment?.orientation_dob_verified ?? member.orientation_dob_verified ?? null,
          orientationCityVerified: sourceAssessment?.orientation_city_verified ?? member.orientation_city_verified ?? null,
          socialTriggers: sourceAssessment?.social_triggers ?? member.social_triggers ?? null
        },
        clinical_support: {
          medicationManagement: sourceAssessment?.medication_management_status ?? member.medication_management_status ?? null,
          assistiveDevices: sourceAssessment?.assistive_devices ?? member.assistive_devices ?? null
        },
        nutrition_orders: {
          joySparks: sourceAssessment?.joy_sparks ?? member.joy_sparks ?? cleanText(sourceMhpRecord.joy_sparks) ?? null
        },
        operational_flags: {
          transportAppropriate: sourceAssessment?.transport_appropriate ?? member.transport_appropriate ?? null,
          sourceAssessmentTrack: member.latest_assessment_track ?? null
        },
        provider_name: providerName,
        provider_signature: input.status === "signed" ? providerName : null,
        provider_signature_date: input.status === "signed" && input.signedDate ? input.signedDate : null,
        signed_by_name: input.status === "signed" ? providerName : null,
        signature_metadata:
          input.status === "signed"
            ? { seeded: true, source: "seed:v3", signedVia: "seeded-provider-signature" }
            : { seeded: true, source: "seed:v3" },
        created_by_user_id: actorUserId,
        created_by_name: actorName,
        updated_by_user_id: actorUserId,
        updated_by_name: actorName,
        created_at: toIsoAt(input.createdDate, 9, 0),
        updated_at: toIsoAt(input.signedDate ?? input.sentDate ?? input.createdDate, 16, 0)
      });
    };

    if (idx < 4) {
      pushOrder({
        id: oldSignedId,
        status: "superseded",
        versionNumber: 1,
        isActiveSigned: false,
        supersededBy: signedId,
        createdDate: addDays(signedDate, -45),
        sentDate: addDays(signedDate, -41),
        signedDate: addDays(signedDate, -40),
        effectiveDate: addDays(signedDate, -39)
      });
    }

    pushOrder({
      id: signedId,
      status: "signed",
      versionNumber: idx < 4 ? 2 : 1,
      isActiveSigned: true,
      createdDate: addDays(signedDate, -5),
      sentDate,
      signedDate,
      effectiveDate: addDays(signedDate, 1)
    });

    if (idx >= 4 && idx < 9) {
      pushOrder({
        id: sentId,
        status: "sent",
        versionNumber: 3,
        isActiveSigned: false,
        createdDate: draftDate,
        sentDate: addDays(draftDate, 1),
        signedDate: null,
        effectiveDate: null
      });
    }
    if (idx >= 9 && idx < 13) {
      pushOrder({
        id: draftId,
        status: "draft",
        versionNumber: 3,
        isActiveSigned: false,
        createdDate: draftDate,
        sentDate: null,
        signedDate: null,
        effectiveDate: null
      });
    }

    activeSignedOrderByMember.set(member.id, signedId);

    const sourceAssessmentDate = asDateOnly(
      cleanText(sourceMhpRecord.source_assessment_at) ?? sourceAssessment?.assessment_date ?? member.latest_assessment_date
    );

    mhpRows.push({
      id: isUuid(cleanText(sourceMhpRecord.id)) ? cleanText(sourceMhpRecord.id) : stableUuid(`mhp-${member.id}`),
      member_id: member.id,
      active_physician_order_id: signedId,
      diagnoses,
      allergies,
      medications: medicationPayload,
      diet:
        sourceMhpRecord.diet && typeof sourceMhpRecord.diet === "object"
          ? sourceMhpRecord.diet
          : {
              type: sourceMhp?.diet_type ?? sourceAssessment?.diet_type ?? member.diet_type ?? "Regular",
              restrictions: sourceMhp?.dietary_restrictions ?? sourceAssessment?.diet_restrictions_notes ?? null
            },
      mobility:
        sourceMhpRecord.mobility && typeof sourceMhpRecord.mobility === "object"
          ? sourceMhpRecord.mobility
          : {
              ambulation: sourceMhp?.ambulation ?? sourceAssessment?.mobility_steadiness ?? member.mobility_status ?? null,
              aids: cleanText(sourceMhpRecord.mobility_aids) ?? sourceAssessment?.mobility_aids ?? member.mobility_aids ?? null
            },
      adl_support:
        sourceMhpRecord.adl_support && typeof sourceMhpRecord.adl_support === "object"
          ? sourceMhpRecord.adl_support
          : {
              dressing: sourceMhp?.dressing ?? sourceAssessment?.dressing_support_status ?? null,
              medicationManagement: sourceAssessment?.medication_management_status ?? member.medication_management_status ?? null
            },
      continence:
        sourceMhpRecord.continence && typeof sourceMhpRecord.continence === "object"
          ? sourceMhpRecord.continence
          : {
              toiletingNeeds: sourceMhp?.toileting_needs ?? sourceAssessment?.incontinence_products ?? member.incontinence_products ?? null
            },
      behavior_orientation:
        sourceMhpRecord.behavior_orientation && typeof sourceMhpRecord.behavior_orientation === "object"
          ? sourceMhpRecord.behavior_orientation
          : {
              orientationDob: sourceMhp?.orientation_dob ?? (member.orientation_dob_verified ? member.dob : null),
              orientationCity: sourceMhp?.orientation_city ?? (member.orientation_city_verified ? member.city : null),
              socialTriggers: sourceAssessment?.social_triggers ?? member.social_triggers ?? null
            },
      clinical_support:
        sourceMhpRecord.clinical_support && typeof sourceMhpRecord.clinical_support === "object"
          ? sourceMhpRecord.clinical_support
          : {
              codeStatus: sourceMhp?.code_status ?? sourceAssessment?.code_status ?? member.code_status ?? "Full Code"
            },
      operational_flags:
        sourceMhpRecord.operational_flags && typeof sourceMhpRecord.operational_flags === "object"
          ? sourceMhpRecord.operational_flags
          : { source: "seed:v3" },
      gender: sourceMhp?.gender ?? (idx % 2 === 0 ? "Female" : "Male"),
      payor: null,
      original_referral_source: sourceMhp?.original_referral_source ?? null,
      photo_consent: sourceMhp?.photo_consent ?? true,
      profile_image_url: sourceMhp?.profile_image_url ?? null,
      primary_caregiver_name: sourceMhp?.primary_caregiver_name ?? null,
      primary_caregiver_phone: sourceMhp?.primary_caregiver_phone ?? null,
      responsible_party_name: sourceMhp?.responsible_party_name ?? null,
      responsible_party_phone: sourceMhp?.responsible_party_phone ?? null,
      provider_name: sourceMhp?.provider_name ?? providerName,
      provider_phone: sourceMhp?.provider_phone ?? provider?.provider_phone ?? null,
      important_alerts: sourceMhp?.important_alerts ?? member.social_triggers ?? null,
      diet_type: sourceMhp?.diet_type ?? sourceAssessment?.diet_type ?? member.diet_type ?? null,
      dietary_restrictions: sourceMhp?.dietary_restrictions ?? sourceAssessment?.diet_restrictions_notes ?? member.diet_restrictions_notes ?? null,
      swallowing_difficulty: sourceMhp?.swallowing_difficulty ?? null,
      diet_texture: sourceMhp?.diet_texture ?? null,
      supplements: sourceMhp?.supplements ?? null,
      foods_to_omit: sourceMhp?.foods_to_omit ?? null,
      ambulation: sourceMhp?.ambulation ?? sourceAssessment?.mobility_steadiness ?? member.mobility_status ?? null,
      transferring: sourceMhp?.transferring ?? null,
      bathing: sourceMhp?.bathing ?? null,
      dressing: sourceMhp?.dressing ?? sourceAssessment?.dressing_support_status ?? member.dressing_support_status ?? null,
      eating: sourceMhp?.eating ?? null,
      bladder_continence: sourceMhp?.bladder_continence ?? null,
      bowel_continence: sourceMhp?.bowel_continence ?? null,
      toileting: sourceMhp?.toileting ?? null,
      toileting_needs: sourceMhp?.toileting_needs ?? sourceAssessment?.incontinence_products ?? member.incontinence_products ?? null,
      toileting_comments: sourceMhp?.toileting_comments ?? null,
      hearing: sourceMhp?.hearing ?? null,
      vision: sourceMhp?.vision ?? null,
      dental: sourceMhp?.dental ?? null,
      speech_verbal_status: sourceMhp?.speech_verbal_status ?? null,
      speech_comments: sourceMhp?.speech_comments ?? null,
      personal_appearance_hygiene_grooming: sourceMhp?.personal_appearance_hygiene_grooming ?? null,
      may_self_medicate: sourceMhp?.may_self_medicate ?? null,
      medication_manager_name: sourceMhp?.medication_manager_name ?? null,
      orientation_dob: sourceMhp?.orientation_dob ?? (member.orientation_dob_verified ? member.dob : null),
      orientation_city: sourceMhp?.orientation_city ?? (member.orientation_city_verified ? member.city : null),
      orientation_current_year: sourceMhp?.orientation_current_year ?? null,
      orientation_former_occupation: sourceMhp?.orientation_former_occupation ?? null,
      memory_impairment: sourceMhp?.memory_impairment ?? null,
      memory_severity: sourceMhp?.memory_severity ?? null,
      wandering: sourceMhp?.wandering ?? false,
      combative_disruptive: sourceMhp?.combative_disruptive ?? false,
      sleep_issues: sourceMhp?.sleep_issues ?? false,
      self_harm_unsafe: sourceMhp?.self_harm_unsafe ?? false,
      impaired_judgement: sourceMhp?.impaired_judgement ?? false,
      delirium: sourceMhp?.delirium ?? false,
      disorientation: sourceMhp?.disorientation ?? false,
      agitation_resistive: sourceMhp?.agitation_resistive ?? false,
      screaming_loud_noises: sourceMhp?.screaming_loud_noises ?? false,
      exhibitionism_disrobing: sourceMhp?.exhibitionism_disrobing ?? false,
      exit_seeking: sourceMhp?.exit_seeking ?? false,
      cognitive_behavior_comments: sourceMhp?.cognitive_behavior_comments ?? sourceAssessment?.social_triggers ?? null,
      code_status: sourceMhp?.code_status ?? sourceAssessment?.code_status ?? member.code_status ?? null,
      dnr: sourceMhp?.dnr ?? (member.code_status ?? sourceAssessment?.code_status ?? "").toUpperCase().includes("DNR"),
      dni: sourceMhp?.dni ?? false,
      polst_molst_colst: sourceMhp?.polst_molst_colst ?? null,
      hospice: sourceMhp?.hospice ?? false,
      advanced_directives_obtained: sourceMhp?.advanced_directives_obtained ?? null,
      power_of_attorney: sourceMhp?.power_of_attorney ?? null,
      hospital_preference: sourceMhp?.hospital_preference ?? null,
      legal_comments: sourceMhp?.legal_comments ?? null,
      oxygen_use: cleanText(sourceMhpRecord.oxygen_use),
      mental_health_history: cleanText(sourceMhpRecord.mental_health_history),
      falls_history: cleanText(sourceMhpRecord.falls_history),
      physical_health_problems: cleanText(sourceMhpRecord.physical_health_problems),
      communication_style: cleanText(sourceMhpRecord.communication_style),
      mobility_aids: cleanText(sourceMhpRecord.mobility_aids) ?? sourceMhp?.ambulation ?? null,
      incontinence_products: cleanText(sourceMhpRecord.incontinence_products),
      glasses_hearing_aids_cataracts: cleanText(sourceMhpRecord.glasses_hearing_aids_cataracts),
      intake_notes: cleanText(sourceMhpRecord.intake_notes),
      source_assessment_id: sourceAssessment?.id ?? cleanText(sourceMhpRecord.source_assessment_id),
      source_assessment_at: sourceAssessmentDate ? toIsoAt(sourceAssessmentDate, 12, 0) : null,
      updated_by_user_id: actorUserId,
      updated_by_name: actorName,
      profile_notes: cleanText(sourceMhpRecord.profile_notes) ?? member.personal_notes ?? null,
      joy_sparks: cleanText(sourceMhpRecord.joy_sparks) ?? member.joy_sparks ?? null,
      last_synced_at: new Date().toISOString()
    });
  });

  return { pofRows, mhpRows, activeSignedOrderByMember };
}

function withMemberCohort(db: SeededDb) {
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const activeMembers = db.members.filter((row) => row.status === "active");
  const inactiveMembers = db.members.filter((row) => row.status !== "active");
  const selectedBaseMembers = [...activeMembers, ...inactiveMembers].slice(0, TARGET_MEMBER_COUNT);
  const selectedMembers = selectedBaseMembers.map((member, idx) => {
    const normalizedEnrollment = member.enrollment_date ?? addDays(today, -(90 + idx * 6));
    if (idx < Math.max(0, TARGET_MEMBER_COUNT - 3)) {
      return {
        ...member,
        status: "active" as const,
        enrollment_date: normalizedEnrollment,
        discharge_date: null,
        discharge_reason: null,
        discharge_disposition: null,
        discharged_by: null
      };
    }
    const dischargeDate = addDays(today, -(12 + idx * 3));
    return {
      ...member,
      status: "inactive" as const,
      enrollment_date: normalizedEnrollment,
      discharge_date: dischargeDate,
      discharge_reason: idx % 2 === 0 ? "Higher Level of Care" : "Family Choice",
      discharge_disposition: idx % 2 === 0 ? "Skilled Nursing Transition" : "Home With Family",
      discharged_by: "Seed Workflow"
    };
  });
  const memberIdSet = new Set(selectedMembers.map((row) => row.id));
  const hasMember = (id: string | null | undefined) => Boolean(id && memberIdSet.has(id));

  const filteredAssessments = db.assessments.filter((row) => hasMember(row.member_id));
  const assessmentIdSet = new Set(filteredAssessments.map((row) => row.id));

  const filteredMemberBillingSettings = db.memberBillingSettings.filter((row) => hasMember(row.member_id));
  const payorIdSet = new Set(filteredMemberBillingSettings.map((row) => row.payor_id).filter((value): value is string => Boolean(value)));

  return {
    ...db,
    members: selectedMembers,
    memberCommandCenters: db.memberCommandCenters.filter((row) => hasMember(row.member_id)),
    memberAttendanceSchedules: db.memberAttendanceSchedules.filter((row) => hasMember(row.member_id)),
    memberHolds: db.memberHolds.filter((row) => hasMember(row.member_id)),
    transportationManifestAdjustments: db.transportationManifestAdjustments.filter((row) => hasMember(row.member_id)),
    memberContacts: db.memberContacts.filter((row) => hasMember(row.member_id)),
    memberFiles: db.memberFiles.filter((row) => hasMember(row.member_id)),
    attendanceRecords: db.attendanceRecords.filter((row) => hasMember(row.member_id)),
    dailyActivities: db.dailyActivities.filter((row) => hasMember(row.member_id)),
    toiletLogs: db.toiletLogs.filter((row) => hasMember(row.member_id)),
    showerLogs: db.showerLogs.filter((row) => hasMember(row.member_id)),
    transportationLogs: db.transportationLogs.filter((row) => hasMember(row.member_id)),
    photoUploads: db.photoUploads.filter((row) => hasMember(row.member_id)),
    bloodSugarLogs: db.bloodSugarLogs.filter((row) => hasMember(row.member_id)),
    ancillaryLogs: db.ancillaryLogs.filter((row) => hasMember(row.member_id)),
    payors: db.payors.filter((row) => payorIdSet.has(row.id)),
    memberBillingSettings: filteredMemberBillingSettings,
    billingScheduleTemplates: db.billingScheduleTemplates.filter((row) => hasMember(row.member_id)),
    billingAdjustments: db.billingAdjustments.filter((row) => hasMember(row.member_id)),
    billingInvoices: db.billingInvoices.filter((row) => hasMember(row.member_id)),
    billingInvoiceLines: db.billingInvoiceLines.filter((row) => hasMember((row as { member_id?: string }).member_id)),
    billingCoverages: db.billingCoverages.filter((row) => hasMember(row.member_id)),
    assessments: filteredAssessments,
    assessmentResponses: db.assessmentResponses.filter((row) => assessmentIdSet.has(row.assessment_id) && hasMember(row.member_id)),
    memberHealthProfiles: db.memberHealthProfiles.filter((row) => hasMember(row.member_id)),
    memberDiagnoses: db.memberDiagnoses.filter((row) => hasMember(row.member_id)),
    memberMedications: db.memberMedications.filter((row) => hasMember(row.member_id)),
    memberAllergies: db.memberAllergies.filter((row) => hasMember(row.member_id)),
    memberProviders: db.memberProviders.filter((row) => hasMember(row.member_id)),
    memberEquipment: db.memberEquipment.filter((row) => hasMember(row.member_id)),
    memberNotes: db.memberNotes.filter((row) => hasMember(row.member_id))
  };
}

type LeadFlow =
  | "new-inquiry"
  | "follow-up-pending"
  | "tour-scheduled"
  | "toured"
  | "packet-sent"
  | "packet-completed"
  | "nurture"
  | "lost"
  | "converted";

type SeedLeadScenario = {
  key: string;
  flow: LeadFlow;
  stage: string;
  status: "Open" | "Won" | "Lost" | "Nurture";
  leadSource: string;
  likelihood: string;
  caregiverRelationship: string;
  preferredSchedule: string;
  transportationInterest: string;
  payerInterest: string;
  summary: string;
  lostReason?: string | null;
  convertedMemberOffset?: number;
};

type SeedLeadPackage = {
  leads: SeededDb["leads"];
  leadActivities: SeededDb["leadActivities"];
  leadStageHistory: SeededDb["leadStageHistory"];
  partnerActivities: SeededDb["partnerActivities"];
  memberLeadByMemberId: Map<string, string>;
};

type SeedLeadActivityStep = {
  dayOffset: number;
  activityType: string;
  outcome: string;
  notes: string;
  nextFollowUpType: string | null;
  nextFollowUpOffset: number | null;
  lostReason: string | null;
};

type SeedLeadStageStep = {
  stage: string;
  status: "open" | "won" | "lost";
  dayOffset: number;
  reason: string;
};

const SEED_LEAD_SCENARIOS: SeedLeadScenario[] = [
  {
    key: "lead-01-new-inquiry",
    flow: "new-inquiry",
    stage: "Inquiry",
    status: "Open",
    leadSource: "Website",
    likelihood: "Warm",
    caregiverRelationship: "Daughter",
    preferredSchedule: "Mon/Wed/Fri full day",
    transportationInterest: "Interested in door-to-door transportation.",
    payerInterest: "Private pay, may apply for VA aid.",
    summary: "Initial web intake request from caregiver."
  },
  {
    key: "lead-02-follow-up-pending",
    flow: "follow-up-pending",
    stage: "Inquiry",
    status: "Open",
    leadSource: "Phone",
    likelihood: "Warm",
    caregiverRelationship: "Son",
    preferredSchedule: "Tue/Thu mornings",
    transportationInterest: "Family transport for now.",
    payerInterest: "Long-term care policy review pending.",
    summary: "Requested call-back after physician visit."
  },
  {
    key: "lead-03-tour-scheduled",
    flow: "tour-scheduled",
    stage: "Tour",
    status: "Open",
    leadSource: "Referral",
    likelihood: "Hot",
    caregiverRelationship: "Spouse",
    preferredSchedule: "Mon-Fri, likely 3 days/week",
    transportationInterest: "Needs bus stop pickup option.",
    payerInterest: "Private pay confirmed.",
    summary: "Tour booked with spouse and daughter."
  },
  {
    key: "lead-04-toured",
    flow: "toured",
    stage: "Tour",
    status: "Open",
    leadSource: "Hospital/Provider",
    likelihood: "Hot",
    caregiverRelationship: "Daughter",
    preferredSchedule: "Mon/Tue/Thu",
    transportationInterest: "Transportation needed both ways.",
    payerInterest: "Family support with supplemental benefits.",
    summary: "Tour completed and clinical fit appears strong."
  },
  {
    key: "lead-05-packet-sent",
    flow: "packet-sent",
    stage: "Enrollment in Progress",
    status: "Open",
    leadSource: "Community Event",
    likelihood: "Hot",
    caregiverRelationship: "Niece",
    preferredSchedule: "Mon/Wed/Fri",
    transportationInterest: "Door-to-door requested due mobility concerns.",
    payerInterest: "Private pay with respite grant inquiry.",
    summary: "Enrollment packet sent after successful tour."
  },
  {
    key: "lead-06-packet-completed",
    flow: "packet-completed",
    stage: "Enrollment in Progress",
    status: "Open",
    leadSource: "Referral",
    likelihood: "Hot",
    caregiverRelationship: "Daughter",
    preferredSchedule: "Tue/Thu/Fri",
    transportationInterest: "Caregiver requests PM return only.",
    payerInterest: "Long-term care insurance in progress.",
    summary: "Packet completed and pending final intake review."
  },
  {
    key: "lead-07-nurture-1",
    flow: "nurture",
    stage: "Nurture",
    status: "Nurture",
    leadSource: "Google",
    likelihood: "Warm",
    caregiverRelationship: "Friend",
    preferredSchedule: "Considering 2 days/week in summer.",
    transportationInterest: "Not needed yet.",
    payerInterest: "Exploring available benefits.",
    summary: "Family not ready yet, requested monthly follow-up."
  },
  {
    key: "lead-08-nurture-2",
    flow: "nurture",
    stage: "Nurture",
    status: "Nurture",
    leadSource: "Walk-in",
    likelihood: "Cold",
    caregiverRelationship: "Spouse",
    preferredSchedule: "Undecided",
    transportationInterest: "Unsure, dependent on move plans.",
    payerInterest: "Budget review in progress.",
    summary: "Nurture cadence established for future enrollment."
  },
  {
    key: "lead-09-closed-lost-1",
    flow: "lost",
    stage: "Closed - Lost",
    status: "Lost",
    leadSource: "Referral",
    likelihood: "Warm",
    caregiverRelationship: "Son",
    preferredSchedule: "Mon-Fri",
    transportationInterest: "Needed but out-of-area route.",
    payerInterest: "Price-sensitive decision.",
    summary: "Lead chose another center closer to home.",
    lostReason: "Chose competitor"
  },
  {
    key: "lead-10-closed-lost-2",
    flow: "lost",
    stage: "Closed - Lost",
    status: "Lost",
    leadSource: "Facebook/Instagram",
    likelihood: "Cold",
    caregiverRelationship: "Daughter",
    preferredSchedule: "2 afternoons/week",
    transportationInterest: "Would require PM pickup only.",
    payerInterest: "Unable to support private-pay start.",
    summary: "Family deferred due financial constraints.",
    lostReason: "Price"
  },
  {
    key: "lead-11-converted-1",
    flow: "converted",
    stage: "Closed - Won",
    status: "Won",
    leadSource: "Referral",
    likelihood: "Hot",
    caregiverRelationship: "Daughter",
    preferredSchedule: "Mon/Wed/Fri",
    transportationInterest: "Transportation requested both ways.",
    payerInterest: "Private pay + family contribution.",
    summary: "Converted after packet completion and intake approval.",
    convertedMemberOffset: 0
  },
  {
    key: "lead-12-converted-2",
    flow: "converted",
    stage: "Closed - Won",
    status: "Won",
    leadSource: "Hospital/Provider",
    likelihood: "Hot",
    caregiverRelationship: "Son",
    preferredSchedule: "Tue/Thu/Fri",
    transportationInterest: "Door-to-door AM pickup required.",
    payerInterest: "VA and private-pay blend.",
    summary: "Converted with discharge planner handoff complete.",
    convertedMemberOffset: 1
  },
  {
    key: "lead-13-converted-3",
    flow: "converted",
    stage: "Closed - Won",
    status: "Won",
    leadSource: "Website",
    likelihood: "Hot",
    caregiverRelationship: "Spouse",
    preferredSchedule: "Mon-Thu mornings",
    transportationInterest: "Family drops off, center returns PM.",
    payerInterest: "Long-term care plan activated.",
    summary: "Converted after clinical review and caregiver education.",
    convertedMemberOffset: 2
  },
  {
    key: "lead-14-converted-4",
    flow: "converted",
    stage: "Closed - Won",
    status: "Won",
    leadSource: "Community Event",
    likelihood: "Warm",
    caregiverRelationship: "Niece",
    preferredSchedule: "Mon/Wed",
    transportationInterest: "Bus stop pickup approved.",
    payerInterest: "Family self-pay arrangement.",
    summary: "Converted following trial-day completion.",
    convertedMemberOffset: 3
  },
  {
    key: "lead-15-converted-5",
    flow: "converted",
    stage: "Closed - Won",
    status: "Won",
    leadSource: "Referral",
    likelihood: "Hot",
    caregiverRelationship: "Daughter",
    preferredSchedule: "Tue/Thu",
    transportationInterest: "Door-to-door both ways.",
    payerInterest: "Private pay with billing autopay.",
    summary: "Converted after final enrollment packet signatures.",
    convertedMemberOffset: 4
  },
  {
    key: "lead-16-follow-up-pending-2",
    flow: "follow-up-pending",
    stage: "Inquiry",
    status: "Open",
    leadSource: "Google",
    likelihood: "Warm",
    caregiverRelationship: "Granddaughter",
    preferredSchedule: "Mon/Thu afternoons",
    transportationInterest: "Family transport during trial period.",
    payerInterest: "Reviewing LTC policy and VA attendance benefits.",
    summary: "Follow-up delayed until family completes neurology consultation."
  },
  {
    key: "lead-17-tour-scheduled-2",
    flow: "tour-scheduled",
    stage: "Tour",
    status: "Open",
    leadSource: "Hospital/Provider",
    likelihood: "Hot",
    caregiverRelationship: "Spouse",
    preferredSchedule: "Tue/Thu/Fri full day",
    transportationInterest: "Needs wheelchair-accessible pickup review.",
    payerInterest: "Private pay approved pending transportation pricing.",
    summary: "Discharge planner requested expedited tour for likely near-term start."
  },
  {
    key: "lead-18-packet-sent-2",
    flow: "packet-sent",
    stage: "Enrollment in Progress",
    status: "Open",
    leadSource: "Referral",
    likelihood: "Hot",
    caregiverRelationship: "Daughter",
    preferredSchedule: "Mon/Wed/Thu",
    transportationInterest: "AM pickup requested; family can handle PM return.",
    payerInterest: "Private pay with possible respite support through church grant.",
    summary: "Packet sent after caregiver confirmed interest in starting next month."
  },
  {
    key: "lead-19-nurture-3",
    flow: "nurture",
    stage: "Nurture",
    status: "Nurture",
    leadSource: "Website",
    likelihood: "Warm",
    caregiverRelationship: "Son",
    preferredSchedule: "Considering 1 to 2 days/week after home repairs finish.",
    transportationInterest: "Unsure until move back into primary home.",
    payerInterest: "Budget review underway with siblings.",
    summary: "Family requested nurture cadence until housing transition is complete."
  },
  {
    key: "lead-20-closed-lost-3",
    flow: "lost",
    stage: "Closed - Lost",
    status: "Lost",
    leadSource: "Walk-in",
    likelihood: "Warm",
    caregiverRelationship: "Daughter",
    preferredSchedule: "Mon-Fri mornings",
    transportationInterest: "Needed immediately but outside service footprint.",
    payerInterest: "Would have needed partial subsidy to begin.",
    summary: "Family could not move forward because transportation coverage was not workable.",
    lostReason: "Schedule/Availability"
  }
];

const SEED_LEAD_PROSPECTS = [
  { memberName: "Evelyn Archer", memberDob: "1945-06-17", caregiverName: "Monica Archer" },
  { memberName: "Jerome Baldwin", memberDob: "1939-11-04", caregiverName: "Andre Baldwin" },
  { memberName: "Patricia Cole", memberDob: "1948-03-23", caregiverName: "Lena Cole" },
  { memberName: "Robert Denson", memberDob: "1942-01-12", caregiverName: "Isaiah Denson" },
  { memberName: "Nora Everett", memberDob: "1947-09-27", caregiverName: "Dana Everett" },
  { memberName: "Louis Freeman", memberDob: "1941-02-03", caregiverName: "Kara Freeman" },
  { memberName: "Gloria Hines", memberDob: "1940-08-15", caregiverName: "Devin Hines" },
  { memberName: "Harold Ingram", memberDob: "1938-12-09", caregiverName: "Tasha Ingram" },
  { memberName: "Clara Jordan", memberDob: "1946-10-30", caregiverName: "Monique Jordan" },
  { memberName: "Samuel Knox", memberDob: "1943-04-11", caregiverName: "Elijah Knox" },
  { memberName: "Theresa Lane", memberDob: "1944-07-08", caregiverName: "Camille Lane" },
  { memberName: "Walter Mason", memberDob: "1937-05-19", caregiverName: "Jordan Mason" },
  { memberName: "Irene Neal", memberDob: "1949-02-26", caregiverName: "Brenda Neal" },
  { memberName: "Otis Parker", memberDob: "1941-09-14", caregiverName: "Melissa Parker" },
  { memberName: "Ruth Quinn", memberDob: "1946-12-01", caregiverName: "Darius Quinn" }
];

function seedLeadActivitySteps(flow: LeadFlow, lostReason: string | null): SeedLeadActivityStep[] {
  if (flow === "new-inquiry") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Initial inquiry received and basic needs captured.", nextFollowUpType: "Call", nextFollowUpOffset: 2, lostReason: null },
      { dayOffset: 2, activityType: "Call", outcome: "Call attempted", notes: "Attempted caregiver callback and left detailed note.", nextFollowUpType: "Voicemail", nextFollowUpOffset: 4, lostReason: null },
      { dayOffset: 4, activityType: "Voicemail", outcome: "Voicemail left", notes: "Requested preferred time window for consult.", nextFollowUpType: "Call", nextFollowUpOffset: 7, lostReason: null }
    ];
  }
  if (flow === "follow-up-pending") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Caregiver asked for callback after specialist appointment.", nextFollowUpType: "Call", nextFollowUpOffset: 2, lostReason: null },
      { dayOffset: 2, activityType: "Call", outcome: "Call completed", notes: "Discussed clinical profile and trial-day expectations.", nextFollowUpType: "Email", nextFollowUpOffset: 5, lostReason: null },
      { dayOffset: 5, activityType: "Email", outcome: "Follow-up email sent", notes: "Sent service overview, pricing, and day-program calendar.", nextFollowUpType: "Call", nextFollowUpOffset: 9, lostReason: null }
    ];
  }
  if (flow === "tour-scheduled") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Referral intake complete with caregiver details.", nextFollowUpType: "Call", nextFollowUpOffset: 1, lostReason: null },
      { dayOffset: 1, activityType: "Call", outcome: "Call completed", notes: "Caregiver confirmed transportation and diet questions.", nextFollowUpType: "Tour", nextFollowUpOffset: 4, lostReason: null },
      { dayOffset: 4, activityType: "Tour", outcome: "Tour scheduled", notes: "Tour booked with caregiver and responsible party.", nextFollowUpType: "Tour", nextFollowUpOffset: 7, lostReason: null }
    ];
  }
  if (flow === "toured") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Hospital referral triaged and accepted.", nextFollowUpType: "Tour", nextFollowUpOffset: 4, lostReason: null },
      { dayOffset: 4, activityType: "Tour", outcome: "Tour scheduled", notes: "On-site tour prepared with clinical and operations leads.", nextFollowUpType: "Tour", nextFollowUpOffset: 8, lostReason: null },
      { dayOffset: 8, activityType: "Tour", outcome: "Tour completed", notes: "Caregiver attended and reviewed enrollment packet checklist.", nextFollowUpType: "Email", nextFollowUpOffset: 10, lostReason: null },
      { dayOffset: 10, activityType: "Email", outcome: "Follow-up email sent", notes: "Sent next steps and intake timeline.", nextFollowUpType: "Call", nextFollowUpOffset: 14, lostReason: null }
    ];
  }
  if (flow === "packet-sent") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Community event lead triaged same day.", nextFollowUpType: "Tour", nextFollowUpOffset: 4, lostReason: null },
      { dayOffset: 6, activityType: "Tour", outcome: "Tour completed", notes: "Tour completed with favorable clinical fit.", nextFollowUpType: "Email", nextFollowUpOffset: 8, lostReason: null },
      { dayOffset: 8, activityType: "Email", outcome: "Enrollment packet sent", notes: "Enrollment packet delivered via secure email.", nextFollowUpType: "Call", nextFollowUpOffset: 11, lostReason: null }
    ];
  }
  if (flow === "packet-completed") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Referral lead entered with strong urgency.", nextFollowUpType: "Tour", nextFollowUpOffset: 4, lostReason: null },
      { dayOffset: 5, activityType: "Tour", outcome: "Tour completed", notes: "Family agreed to begin enrollment workflow.", nextFollowUpType: "Email", nextFollowUpOffset: 7, lostReason: null },
      { dayOffset: 7, activityType: "Email", outcome: "Enrollment packet sent", notes: "Packet issued with intake and physician-order instructions.", nextFollowUpType: "Follow-up", nextFollowUpOffset: 10, lostReason: null },
      { dayOffset: 10, activityType: "Follow-up", outcome: "Enrollment packet completed", notes: "Packet returned complete; pending final admission date.", nextFollowUpType: "Call", nextFollowUpOffset: 13, lostReason: null }
    ];
  }
  if (flow === "nurture") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Intro call logged and goals reviewed.", nextFollowUpType: "Call", nextFollowUpOffset: 3, lostReason: null },
      { dayOffset: 3, activityType: "Call", outcome: "Call completed", notes: "Family requested delayed start and ongoing education.", nextFollowUpType: "Email", nextFollowUpOffset: 7, lostReason: null },
      { dayOffset: 7, activityType: "Email", outcome: "Follow-up email sent", notes: "Nurture resources sent for caregiver planning.", nextFollowUpType: "Call", nextFollowUpOffset: 21, lostReason: null }
    ];
  }
  if (flow === "lost") {
    return [
      { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Lead qualified and added to active follow-up queue.", nextFollowUpType: "Call", nextFollowUpOffset: 2, lostReason: null },
      { dayOffset: 2, activityType: "Call", outcome: "Call completed", notes: "Reviewed schedule and transportation constraints.", nextFollowUpType: "Tour", nextFollowUpOffset: 5, lostReason: null },
      { dayOffset: 5, activityType: "Tour", outcome: "Tour completed", notes: "Family toured but remained undecided.", nextFollowUpType: "Follow-up", nextFollowUpOffset: 8, lostReason: null },
      { dayOffset: 8, activityType: "Follow-up", outcome: "Not interested / closed lost", notes: "Case closed after final caregiver decision.", nextFollowUpType: null, nextFollowUpOffset: null, lostReason }
    ];
  }
  return [
    { dayOffset: 0, activityType: "Discovery", outcome: "Inquiry received", notes: "Lead accepted for rapid intake workflow.", nextFollowUpType: "Tour", nextFollowUpOffset: 4, lostReason: null },
    { dayOffset: 4, activityType: "Tour", outcome: "Tour completed", notes: "Tour completed with caregiver and responsible party.", nextFollowUpType: "Email", nextFollowUpOffset: 7, lostReason: null },
    { dayOffset: 7, activityType: "Email", outcome: "Enrollment packet sent", notes: "Packet sent with intake assessment packet and POF checklist.", nextFollowUpType: "Follow-up", nextFollowUpOffset: 11, lostReason: null },
    { dayOffset: 11, activityType: "Follow-up", outcome: "Enrollment packet completed", notes: "Packet returned complete and clinically reviewed.", nextFollowUpType: "Call", nextFollowUpOffset: 14, lostReason: null },
    { dayOffset: 14, activityType: "Discovery", outcome: "Converted to member", notes: "Lead converted and linked to canonical enrolled member.", nextFollowUpType: null, nextFollowUpOffset: null, lostReason: null }
  ];
}

function seedLeadStageSteps(flow: LeadFlow, finalStage: string): SeedLeadStageStep[] {
  if (flow === "converted") {
    return [
      { stage: "Inquiry", status: "open", dayOffset: 0, reason: "Inquiry logged." },
      { stage: "Tour", status: "open", dayOffset: 4, reason: "Tour scheduled and completed." },
      { stage: "Enrollment in Progress", status: "open", dayOffset: 8, reason: "Enrollment packet workflow started." },
      { stage: "Closed - Won", status: "won", dayOffset: 15, reason: "Converted to enrolled member." }
    ];
  }
  if (flow === "lost") {
    return [
      { stage: "Inquiry", status: "open", dayOffset: 0, reason: "Inquiry logged." },
      { stage: "Tour", status: "open", dayOffset: 4, reason: "Tour workflow initiated." },
      { stage: "Closed - Lost", status: "lost", dayOffset: 9, reason: "Lead closed as lost." }
    ];
  }
  if (flow === "packet-sent" || flow === "packet-completed") {
    return [
      { stage: "Inquiry", status: "open", dayOffset: 0, reason: "Inquiry logged." },
      { stage: "Tour", status: "open", dayOffset: 4, reason: "Tour completed." },
      { stage: "Enrollment in Progress", status: "open", dayOffset: 8, reason: "Enrollment packet workflow in progress." }
    ];
  }
  if (flow === "tour-scheduled" || flow === "toured") {
    return [
      { stage: "Inquiry", status: "open", dayOffset: 0, reason: "Inquiry logged." },
      { stage: "Tour", status: "open", dayOffset: 4, reason: "Tour stage entered." }
    ];
  }
  if (flow === "nurture") {
    return [
      { stage: "Inquiry", status: "open", dayOffset: 0, reason: "Inquiry logged." },
      { stage: "Nurture", status: "open", dayOffset: 7, reason: "Placed in nurture cadence." }
    ];
  }
  return [{ stage: finalStage, status: "open", dayOffset: 0, reason: "Lead opened." }];
}

function buildLeadSeedPackage(db: SeededDb): SeedLeadPackage {
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const salesOwners =
    db.staff.filter((row) => row.active && ["sales", "admin", "manager", "director"].includes(row.role)) ?? [];
  const ownerPool = salesOwners.length > 0 ? salesOwners : db.staff;
  const partnerPool = db.partners.slice(0, 24);
  const referralPool = db.referralSources.slice(0, 36);
  const referralsByPartner = new Map<string, SeededDb["referralSources"]>();
  referralPool.forEach((row) => {
    referralsByPartner.set(row.partner_id, [...(referralsByPartner.get(row.partner_id) ?? []), row]);
  });

  const activeMembers = db.members.filter((row) => row.status === "active");
  const convertedMembers = (activeMembers.length > 0 ? activeMembers : db.members).slice(0, 5);
  const contactsByMember = new Map<string, SeededDb["memberContacts"]>();
  db.memberContacts.forEach((row) => {
    contactsByMember.set(row.member_id, [...(contactsByMember.get(row.member_id) ?? []), row]);
  });

  const leads: SeededDb["leads"] = [];
  const leadActivities: SeededDb["leadActivities"] = [];
  const leadStageHistory: SeededDb["leadStageHistory"] = [];
  const partnerActivities: SeededDb["partnerActivities"] = [];
  const memberLeadByMemberId = new Map<string, string>();
  const scenarios = SEED_LEAD_SCENARIOS.slice(0, TARGET_LEAD_COUNT);

  let prospectCursor = 0;
  scenarios.forEach((scenario, idx) => {
    const owner = ownerPool[idx % ownerPool.length] ?? db.staff[0];
    if (!owner) return;

    const inquiryDate = addDays(today, -(88 - idx * 4));
    const stageSteps = seedLeadStageSteps(scenario.flow, scenario.stage);
    const finalStep = stageSteps[stageSteps.length - 1] ?? { dayOffset: 0, stage: scenario.stage, status: "open", reason: "Seed lead stage" };
    const partnerNeeded =
      scenario.leadSource === "Referral" ||
      scenario.leadSource === "Hospital/Provider" ||
      scenario.leadSource === "Community Event";
    const partner = partnerNeeded && partnerPool.length > 0 ? partnerPool[idx % partnerPool.length] : null;
    const partnerReferrals = partner ? referralsByPartner.get(partner.partner_id) ?? [] : [];
    const referral =
      partnerNeeded && partnerReferrals.length > 0
        ? partnerReferrals[idx % partnerReferrals.length]
        : partnerNeeded && referralPool.length > 0
          ? referralPool[idx % referralPool.length]
          : null;

    const convertedMember =
      scenario.convertedMemberOffset !== undefined && convertedMembers.length > 0
        ? convertedMembers[scenario.convertedMemberOffset % convertedMembers.length]
        : null;
    const fallbackProspect = SEED_LEAD_PROSPECTS[prospectCursor % SEED_LEAD_PROSPECTS.length];
    if (!convertedMember) {
      prospectCursor += 1;
    }

    const memberContacts = convertedMember ? contactsByMember.get(convertedMember.id) ?? [] : [];
    const primaryContact = memberContacts[0] ?? null;
    const caregiverName =
      primaryContact?.contact_name ??
      (convertedMember ? `Caregiver for ${convertedMember.display_name.split(" ")[0]}` : fallbackProspect.caregiverName);
    const caregiverEmail =
      primaryContact?.email ??
      `${caregiverName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || `caregiver${idx + 1}`}@example.com`;
    const caregiverPhone =
      primaryContact?.cellular_number ?? primaryContact?.home_number ?? `803-555-${String(3200 + idx).slice(-4)}`;
    const memberName = convertedMember?.display_name ?? fallbackProspect.memberName;
    const memberDob = asDateOnly(convertedMember?.dob ?? fallbackProspect.memberDob, null);

    const leadId = stableUuid(`seed:v2:lead:${scenario.key}`);
    if (convertedMember) {
      memberLeadByMemberId.set(convertedMember.id, leadId);
    }

    const activitySteps = seedLeadActivitySteps(scenario.flow, scenario.lostReason ?? null);
    const leadCreatedAt = toIsoAt(inquiryDate, 9 + (idx % 4), 10 + ((idx * 7) % 40));
    const nextFollowUpActivity = [...activitySteps]
      .reverse()
      .find((step) => step.nextFollowUpType !== null && step.nextFollowUpOffset !== null);
    const nextFollowUpDate =
      scenario.status === "Open" || scenario.status === "Nurture"
        ? addDays(inquiryDate, nextFollowUpActivity?.nextFollowUpOffset ?? 14)
        : null;
    const nextFollowUpType =
      scenario.status === "Open" || scenario.status === "Nurture" ? nextFollowUpActivity?.nextFollowUpType ?? "Call" : null;
    const stageUpdatedAt = toIsoAt(addDays(inquiryDate, finalStep.dayOffset), 15, 0);
    const hasTour = scenario.flow !== "new-inquiry" && scenario.flow !== "follow-up-pending" && scenario.flow !== "nurture";
    const tourDate = hasTour ? addDays(inquiryDate, 4) : null;
    const tourCompleted =
      scenario.flow !== "new-inquiry" &&
      scenario.flow !== "follow-up-pending" &&
      scenario.flow !== "tour-scheduled" &&
      scenario.flow !== "nurture";
    const discoveryDate = addDays(inquiryDate, 1);
    const projectedStartDate = scenario.flow === "packet-completed" || scenario.flow === "converted" ? addDays(inquiryDate, 24 + (idx % 8)) : null;
    const closedDate = scenario.status === "Won" || scenario.status === "Lost" ? addDays(inquiryDate, finalStep.dayOffset) : null;

    leads.push({
      id: leadId,
      lead_id: `LD-SEED-${String(idx + 1).padStart(3, "0")}`,
      created_at: leadCreatedAt,
      created_by_user_id: owner.id,
      created_by_name: owner.full_name,
      status: scenario.status,
      stage: scenario.stage,
      stage_updated_at: stageUpdatedAt,
      inquiry_date: inquiryDate,
      tour_date: tourDate,
      tour_completed: hasTour ? tourCompleted : false,
      discovery_date: discoveryDate,
      member_start_date: projectedStartDate,
      caregiver_name: caregiverName,
      caregiver_relationship: scenario.caregiverRelationship,
      caregiver_email: caregiverEmail,
      caregiver_phone: caregiverPhone,
      member_name: memberName,
      member_dob: memberDob,
      lead_source: scenario.leadSource,
      lead_source_other: scenario.leadSource === "Other" ? "Community partner outreach" : null,
      referral_name: referral?.contact_name ?? null,
      likelihood: scenario.likelihood,
      next_follow_up_date: nextFollowUpDate,
      next_follow_up_type: nextFollowUpType,
      notes_summary: `${scenario.summary} Preferred schedule: ${scenario.preferredSchedule}. Transportation: ${scenario.transportationInterest} Payer: ${scenario.payerInterest}`,
      lost_reason: scenario.status === "Lost" ? scenario.lostReason ?? "Other" : null,
      closed_date: closedDate,
      partner_id: partner?.partner_id ?? null,
      referral_source_id: referral?.referral_source_id ?? null
    });

    activitySteps.forEach((step, activityIdx) => {
      leadActivities.push({
        id: stableUuid(`seed:v2:lead-activity:${leadId}:${activityIdx}`),
        activity_id: `LA-SEED-${String(idx + 1).padStart(3, "0")}-${activityIdx + 1}`,
        lead_id: leadId,
        member_name: memberName,
        activity_at: toIsoAt(addDays(inquiryDate, step.dayOffset), 10 + (activityIdx % 5), (idx * 7 + activityIdx * 11) % 60),
        activity_type: step.activityType,
        outcome: step.outcome,
        lost_reason: step.lostReason,
        notes: step.notes,
        next_follow_up_date: step.nextFollowUpOffset !== null ? addDays(inquiryDate, step.nextFollowUpOffset) : null,
        next_follow_up_type: step.nextFollowUpType,
        completed_by_user_id: owner.id,
        completed_by_name: owner.full_name,
        partner_id: partner?.partner_id ?? null,
        referral_source_id: referral?.referral_source_id ?? null
      });
    });

    stageSteps.forEach((step, stageIdx) => {
      const fromStep = stageIdx > 0 ? stageSteps[stageIdx - 1] : null;
      leadStageHistory.push({
        id: stableUuid(`seed:v2:lead-stage:${leadId}:${stageIdx}`),
        lead_id: leadId,
        from_stage: fromStep?.stage ?? null,
        to_stage: step.stage,
        from_status: fromStep?.status ?? null,
        to_status: step.status,
        changed_at: toIsoAt(addDays(inquiryDate, step.dayOffset), 16, (idx * 5 + stageIdx * 9) % 60),
        changed_by_user_id: owner.id,
        changed_by_name: owner.full_name,
        reason: step.reason,
        source: "seed:v2"
      });
    });

    if (partner && referral) {
      partnerActivities.push({
        id: stableUuid(`seed:v2:partner-activity:${leadId}`),
        partner_activity_id: `PA-SEED-${String(idx + 1).padStart(3, "0")}`,
        referral_source_id: referral.referral_source_id,
        partner_id: partner.partner_id,
        organization_name: partner.organization_name,
        contact_name: referral.contact_name,
        activity_at: toIsoAt(addDays(inquiryDate, 2), 11, (idx * 3) % 60),
        activity_type: "Follow-up",
        notes: "Referral partner touchpoint tied to seeded lead progression.",
        completed_by: owner.full_name,
        next_follow_up_date: addDays(inquiryDate, 21),
        next_follow_up_type: "Call",
        last_touched: addDays(inquiryDate, 2),
        lead_id: leadId,
        completed_by_user_id: owner.id
      });
    }
  });

  return {
    leads,
    leadActivities,
    leadStageHistory,
    partnerActivities,
    memberLeadByMemberId
  };
}

function addMonths(date: string, months: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function monthEnd(date: string) {
  return addDays(addMonths(date, 1), -1);
}

function computeCarePlanStatus(nextDueDate: string, today: string) {
  const todayDate = new Date(`${today}T00:00:00.000Z`).getTime();
  const dueDate = new Date(`${nextDueDate}T00:00:00.000Z`).getTime();
  const delta = Math.floor((dueDate - todayDate) / 86400000);
  if (delta < 0) return "Overdue";
  if (delta === 0) return "Due Now";
  if (delta <= 14) return "Due Soon";
  return "Completed";
}

function normalizeTrack(value: string | null | undefined): "Track 1" | "Track 2" | "Track 3" {
  if (value === "Track 1" || value === "Track 2" || value === "Track 3") return value;
  const text = String(value ?? "").toLowerCase();
  if (text.includes("1")) return "Track 1";
  if (text.includes("2")) return "Track 2";
  if (text.includes("3")) return "Track 3";
  return "Track 2";
}

function normalizeLeadStatus(value: string | null | undefined): "open" | "won" | "lost" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "won" || normalized === "lost") return normalized;
  return "open";
}

function buildScheduleChanges(db: SeededDb, staffMap: Map<string, string>) {
  const coordinator =
    db.staff.find((row) => row.role === "coordinator" && row.active) ??
    db.staff.find((row) => row.role === "manager" && row.active) ??
    db.staff.find((row) => row.role === "admin" && row.active) ??
    db.staff[0];
  const enteredByUserId = coordinator ? staffMap.get(coordinator.id) ?? null : null;
  const enteredBy = coordinator?.full_name ?? "Coordinator";
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const scheduleByMember = new Map(db.memberAttendanceSchedules.map((row) => [row.member_id, row] as const));
  const activeMembers = db.members.filter((row) => row.status === "active").slice(0, TARGET_MEMBER_COUNT);

  return activeMembers.map((member, idx) => {
    const schedule = scheduleByMember.get(member.id);
    const enabledDays = WEEKDAY_OPTIONS.filter((day) => Boolean(schedule?.[day]));
    const fallbackDay = WEEKDAY_OPTIONS[idx % WEEKDAY_OPTIONS.length];
    const originalDays = enabledDays.length > 0 ? enabledDays : [fallbackDay];
    const changeType =
      idx % 5 === 0
        ? "Scheduled Absence"
        : idx % 5 === 1
          ? "Makeup Day"
          : idx % 5 === 2
            ? "Day Swap"
            : idx % 5 === 3
              ? "Temporary Schedule Change"
              : "Permanent Schedule Change";
    const effectiveStartDate = addDays(today, -(idx * 3 + 10));
    const effectiveEndDate =
      changeType === "Permanent Schedule Change" ? null : addDays(effectiveStartDate, changeType === "Scheduled Absence" ? 2 : 21);
    const newDay =
      WEEKDAY_OPTIONS[(WEEKDAY_OPTIONS.indexOf(originalDays[0] as (typeof WEEKDAY_OPTIONS)[number]) + 2) % WEEKDAY_OPTIONS.length];
    const newDays =
      changeType === "Scheduled Absence"
        ? []
        : changeType === "Makeup Day"
          ? [newDay]
          : changeType === "Day Swap"
            ? [newDay]
            : [...new Set([newDay, ...originalDays.slice(0, 2)])];
    const status: "active" | "cancelled" | "completed" = idx % 6 === 0 ? "cancelled" : idx % 4 === 0 ? "completed" : "active";
    return {
      id: `schedule-change-${idx + 1}-${member.id.slice(0, 8)}`,
      member_id: member.id,
      change_type: changeType,
      effective_start_date: effectiveStartDate,
      effective_end_date: effectiveEndDate,
      original_days: originalDays,
      new_days: newDays,
      suspend_base_schedule: changeType !== "Scheduled Absence" && changeType !== "Makeup Day",
      reason:
        changeType === "Scheduled Absence"
          ? "Planned family trip."
          : changeType === "Makeup Day"
            ? "Makeup day for prior scheduled absence."
            : changeType === "Day Swap"
              ? "Recurring appointment conflict."
              : changeType === "Temporary Schedule Change"
                ? "Temporary caregiver availability change."
                : "Member requested long-term schedule adjustment.",
      notes: idx % 2 === 0 ? "Seeded schedule-change record for operations testing." : null,
      entered_by: enteredBy,
      entered_by_user_id: enteredByUserId,
      status,
      created_at: toIsoAt(addDays(effectiveStartDate, -1), 9, 0),
      updated_at: toIsoAt(effectiveStartDate, 11, 0),
      closed_at: status === "active" ? null : toIsoAt(addDays(effectiveStartDate, 5), 15, 0),
      closed_by: status === "active" ? null : enteredBy,
      closed_by_user_id: status === "active" ? null : enteredByUserId
    };
  });
}

function buildCarePlanRows(db: SeededDb, staffMap: Map<string, string>) {
  const actor =
    db.staff.find((row) => row.role === "nurse" && row.active) ??
    db.staff.find((row) => row.role === "admin" && row.active) ??
    db.staff[0];
  const actorUserId = actor ? staffMap.get(actor.id) ?? null : null;
  const actorName = actor?.full_name ?? "Clinical Lead";
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const members = db.members.filter((row) => row.status === "active").slice(0, TARGET_MEMBER_COUNT);

  const carePlans: Record<string, unknown>[] = [];
  const carePlanSections: Record<string, unknown>[] = [];
  const carePlanVersions: Record<string, unknown>[] = [];
  const carePlanReviewHistory: Record<string, unknown>[] = [];

  members.forEach((member, idx) => {
    const planId = stableUuid(`care-plan:${member.id}`);
    const track = normalizeTrack(member.latest_assessment_track);
    const enrollmentDate = asDateOnly(member.enrollment_date, addDays(today, -(120 + idx * 11))) as string;
    const reviewDate = addDays(enrollmentDate, 30 + idx * 2);
    const dateOfCompletion = idx % 4 === 3 ? null : addDays(today, -(40 + idx * 3));
    const nextDueDate =
      idx % 4 === 0 ? addDays(today, -5 - idx) : idx % 4 === 1 ? today : idx % 4 === 2 ? addDays(today, 7 + idx) : addDays(today, 33 + idx);
    const status = computeCarePlanStatus(nextDueDate, today);
    const modificationsRequired = idx % 3 !== 0;
    const modificationsDescription = modificationsRequired
      ? "Adjusted socialization interventions and transfer support prompts."
      : "";

    const caregiverName = `Caregiver ${idx + 1}`;
    const caregiverEmail = `caregiver${idx + 1}@example.com`;

    carePlans.push({
      id: planId,
      member_id: member.id,
      track,
      enrollment_date: enrollmentDate,
      review_date: reviewDate,
      last_completed_date: dateOfCompletion,
      next_due_date: nextDueDate,
      status,
      completed_by: dateOfCompletion ? actorName : null,
      date_of_completion: dateOfCompletion,
      responsible_party_signature: dateOfCompletion ? "Family Signature" : null,
      responsible_party_signature_date: dateOfCompletion,
      administrator_signature: dateOfCompletion ? actorName : null,
      administrator_signature_date: dateOfCompletion,
      care_team_notes: "Seeded interdisciplinary notes for quarterly care-plan review.",
      no_changes_needed: !modificationsRequired,
      modifications_required: modificationsRequired,
      modifications_description: modificationsDescription,
      nurse_designee_user_id: actorUserId,
      nurse_designee_name: actorName,
      nurse_signed_at: dateOfCompletion ? toIsoAt(dateOfCompletion, 12, 0) : null,
      caregiver_name: caregiverName,
      caregiver_email: caregiverEmail,
      caregiver_signature_status: dateOfCompletion ? "ready_to_send" : "not_requested",
      caregiver_sent_at: null,
      caregiver_sent_by_user_id: null,
      caregiver_viewed_at: null,
      caregiver_signed_at: null,
      caregiver_signature_request_token: null,
      caregiver_signature_expires_at: null,
      caregiver_signature_request_url: null,
      caregiver_signed_name: null,
      caregiver_signature_image_url: null,
      caregiver_signature_ip: null,
      caregiver_signature_user_agent: null,
      caregiver_signature_error: null,
      final_member_file_id: null,
      legacy_cleanup_flag: false,
      created_by_user_id: actorUserId,
      created_by_name: actorName,
      updated_by_user_id: actorUserId,
      updated_by_name: actorName,
      created_at: toIsoAt(addDays(enrollmentDate, 1), 10, 15),
      updated_at: toIsoAt(today, 9, 10)
    });

    const sectionsSnapshot = getCanonicalTrackSections(track).map((section) => {
      const shortTermGoals = section.shortTermGoals;
      const longTermGoals = section.longTermGoals;
      carePlanSections.push({
        id: stableUuid(`care-plan-section:${planId}:${section.sectionType}`),
        care_plan_id: planId,
        section_type: section.sectionType,
        short_term_goals: shortTermGoals,
        long_term_goals: longTermGoals,
        display_order: section.displayOrder,
        created_at: toIsoAt(addDays(enrollmentDate, 2), 11, 0),
        updated_at: toIsoAt(today, 8, 45)
      });
      return {
        sectionType: section.sectionType,
        shortTermGoals,
        longTermGoals,
        displayOrder: section.displayOrder
      };
    });

    carePlanVersions.push({
      id: stableUuid(`care-plan-version:${planId}:1`),
      care_plan_id: planId,
      version_number: 1,
      snapshot_type: "initial",
      snapshot_date: reviewDate,
      reviewed_by: actorName,
      status,
      next_due_date: nextDueDate,
      no_changes_needed: !modificationsRequired,
      modifications_required: modificationsRequired,
      modifications_description: modificationsDescription,
      care_team_notes: "Initial care-plan snapshot generated from seeded review.",
      sections_snapshot: sectionsSnapshot,
      created_at: toIsoAt(addDays(reviewDate, 1), 14, 20)
    });

    if (idx % 2 === 0) {
      const reviewDate2 = addDays(reviewDate, 180);
      const nextDueDate2 = addDays(reviewDate2, 180);
      const status2 = computeCarePlanStatus(nextDueDate2, today);
      const versionId2 = stableUuid(`care-plan-version:${planId}:2`);
      carePlanVersions.push({
        id: versionId2,
        care_plan_id: planId,
        version_number: 2,
        snapshot_type: "review",
        snapshot_date: reviewDate2,
        reviewed_by: actorName,
        status: status2,
        next_due_date: nextDueDate2,
        no_changes_needed: idx % 4 === 0,
        modifications_required: idx % 4 !== 0,
        modifications_description: idx % 4 !== 0 ? "Added fall-prevention cueing and hydration reminders." : "",
        care_team_notes: "Quarterly review snapshot for test workflow.",
        sections_snapshot: sectionsSnapshot,
        created_at: toIsoAt(addDays(reviewDate2, 1), 13, 30)
      });
      carePlanReviewHistory.push({
        id: stableUuid(`care-plan-review:${planId}:2`),
        care_plan_id: planId,
        review_date: reviewDate2,
        reviewed_by: actorName,
        summary: "Routine interdisciplinary review completed with updated interventions.",
        changes_made: idx % 4 !== 0,
        next_due_date: nextDueDate2,
        version_id: versionId2,
        created_at: toIsoAt(addDays(reviewDate2, 1), 16, 0)
      });
    }
  });

  return {
    carePlans,
    carePlanSections,
    carePlanVersions,
    carePlanReviewHistory
  };
}

function buildBillingRows(db: SeededDb, staffMap: Map<string, string>) {
  const actor =
    db.staff.find((row) => row.role === "coordinator" && row.active) ??
    db.staff.find((row) => row.role === "manager" && row.active) ??
    db.staff.find((row) => row.role === "admin" && row.active) ??
    db.staff[0];
  const actorUserId = actor ? staffMap.get(actor.id) ?? null : null;
  const actorName = actor?.full_name ?? "Billing Coordinator";
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;
  const invoiceMonth = addMonths(today, -1);
  const invoicePeriodStart = invoiceMonth;
  const invoicePeriodEnd = monthEnd(invoiceMonth);

  const settingsByMember = new Map(db.memberBillingSettings.map((row) => [row.member_id, row] as const));
  const scheduleByMember = new Map(db.memberAttendanceSchedules.map((row) => [row.member_id, row] as const));
  const activeMembers = db.members.filter((row) => row.status === "active").slice(0, TARGET_MEMBER_COUNT);
  const billedMemberIds = new Set(activeMembers.map((row) => row.id));

  const billingAdjustments: Record<string, unknown>[] = [];
  const billingInvoices: Record<string, unknown>[] = [];
  const billingInvoiceLines: Record<string, unknown>[] = [];
  const billingCoverages: Record<string, unknown>[] = [];
  let invoiceTotal = 0;

  activeMembers.forEach((member, idx) => {
    const invoiceId = stableUuid(`billing-invoice:${member.id}:${invoiceMonth}`);
    const settings = settingsByMember.get(member.id);
    const schedule = scheduleByMember.get(member.id);
    const attendanceDays = db.attendanceRecords.filter(
      (row) => row.member_id === member.id && row.status === "present" && row.attendance_date >= invoicePeriodStart && row.attendance_date <= invoicePeriodEnd
    ).length;
    const scheduledDaysPerWeek =
      (schedule?.monday ? 1 : 0) +
      (schedule?.tuesday ? 1 : 0) +
      (schedule?.wednesday ? 1 : 0) +
      (schedule?.thursday ? 1 : 0) +
      (schedule?.friday ? 1 : 0);
    const billedDays = attendanceDays > 0 ? attendanceDays : Math.max(8, scheduledDaysPerWeek * 4);
    const dailyRate = Number(settings?.custom_daily_rate ?? schedule?.custom_daily_rate ?? schedule?.daily_rate ?? schedule?.default_daily_rate ?? 180);
    const baseProgramAmount = Number((billedDays * dailyRate).toFixed(2));

    const memberTransport = db.transportationLogs.filter(
      (row) => row.member_id === member.id && row.service_date >= invoicePeriodStart && row.service_date <= invoicePeriodEnd
    );
    const transportCount = memberTransport.length;
    const transportRate = settings?.transportation_billing_status === "Waived" ? 0 : 20;
    const transportationAmount = Number((transportCount * transportRate).toFixed(2));

    const memberAncillary = db.ancillaryLogs.filter(
      (row) => row.member_id === member.id && row.service_date >= invoicePeriodStart && row.service_date <= invoicePeriodEnd
    );
    const ancillaryAmount = Number(
      memberAncillary.reduce((sum, row) => sum + Number(row.total_amount ?? row.amount_cents / 100), 0).toFixed(2)
    );

    const adjustmentAmount = idx % 3 === 0 ? -25 : idx % 4 === 0 ? 40 : 0;
    if (adjustmentAmount !== 0) {
      const adjustmentId = stableUuid(`billing-adjustment:${member.id}:${invoiceMonth}`);
      billingAdjustments.push({
        id: adjustmentId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        adjustment_date: addDays(invoicePeriodEnd, -2),
        adjustment_type: adjustmentAmount > 0 ? "ManualCharge" : "Credit",
        description: adjustmentAmount > 0 ? "Additional service support charge." : "Service credit adjustment.",
        quantity: 1,
        unit_rate: Math.abs(adjustmentAmount),
        amount: adjustmentAmount,
        billing_status: "Billed",
        exclusion_reason: null,
        invoice_id: invoiceId,
        created_by_system: false,
        source_table: "attendance_records",
        source_record_id: `${member.id}:${invoiceMonth}`,
        created_by_user_id: actorUserId,
        created_by_name: actorName,
        created_at: toIsoAt(addDays(invoicePeriodEnd, -1), 11, 0),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, -1), 11, 0)
      });
    }

    const totalAmount = Number((baseProgramAmount + transportationAmount + ancillaryAmount + adjustmentAmount).toFixed(2));
    invoiceTotal += totalAmount;
    const invoiceNumber = `ML-${invoiceMonth.replace(/-/g, "")}-${String(idx + 1).padStart(3, "0")}`;

    billingInvoices.push({
      id: invoiceId,
      billing_batch_id: stableUuid(`billing-batch:${invoiceMonth}`),
      member_id: member.id,
      payor_id: settings?.payor_id ?? null,
      invoice_number: invoiceNumber,
      invoice_month: invoiceMonth,
      invoice_source: "BatchGenerated",
      invoice_status: idx % 5 === 0 ? "Sent" : idx % 3 === 0 ? "Finalized" : "Draft",
      export_status: idx % 5 === 0 ? "Exported" : "NotExported",
      billing_mode_snapshot: settings?.billing_mode ?? "Membership",
      monthly_billing_basis_snapshot: settings?.monthly_billing_basis ?? "ScheduledMonthBehind",
      transportation_billing_status_snapshot: settings?.transportation_billing_status ?? "BillNormally",
      billing_method_snapshot: "InvoiceEmail",
      base_period_start: invoicePeriodStart,
      base_period_end: invoicePeriodEnd,
      variable_charge_period_start: invoicePeriodStart,
      variable_charge_period_end: invoicePeriodEnd,
      invoice_date: addDays(invoicePeriodEnd, 1),
      due_date: addDays(invoicePeriodEnd, 16),
      base_program_billed_days: billedDays,
      member_daily_rate_snapshot: dailyRate,
      base_program_amount: baseProgramAmount,
      transportation_amount: transportationAmount,
      ancillary_amount: ancillaryAmount,
      adjustment_amount: adjustmentAmount,
      total_amount: totalAmount,
      notes: "Seeded invoice for billing workflow validation.",
      created_by_user_id: actorUserId,
      created_by_name: actorName,
      finalized_by: idx % 3 === 0 || idx % 5 === 0 ? actorName : null,
      finalized_at: idx % 3 === 0 || idx % 5 === 0 ? toIsoAt(addDays(invoicePeriodEnd, 1), 17, 0) : null,
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 30),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 30)
    });

    const baseLineId = stableUuid(`billing-line:${invoiceId}:base`);
    billingInvoiceLines.push({
      id: baseLineId,
      invoice_id: invoiceId,
      member_id: member.id,
      payor_id: settings?.payor_id ?? null,
      service_date: invoicePeriodEnd,
      service_period_start: invoicePeriodStart,
      service_period_end: invoicePeriodEnd,
      line_type: "BaseProgram",
      description: "Base program charges",
      quantity: billedDays,
      unit_rate: dailyRate,
      amount: baseProgramAmount,
      source_table: "attendance_records",
      source_record_id: `${member.id}:${invoiceMonth}`,
      billing_status: "Billed",
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 45),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 45)
    });
    billingCoverages.push({
      id: stableUuid(`billing-coverage:${invoiceId}:base`),
      member_id: member.id,
      coverage_type: "BaseProgram",
      coverage_start_date: invoicePeriodStart,
      coverage_end_date: invoicePeriodEnd,
      source_invoice_id: invoiceId,
      source_invoice_line_id: baseLineId,
      source_table: "billing_invoice_lines",
      source_record_id: baseLineId,
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 0)
    });

    if (transportationAmount > 0) {
      const transportLineId = stableUuid(`billing-line:${invoiceId}:transport`);
      billingInvoiceLines.push({
        id: transportLineId,
        invoice_id: invoiceId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        service_date: invoicePeriodEnd,
        service_period_start: invoicePeriodStart,
        service_period_end: invoicePeriodEnd,
        line_type: "Transportation",
        description: "Transportation services",
        quantity: transportCount,
        unit_rate: transportRate,
        amount: transportationAmount,
        source_table: "transportation_logs",
        source_record_id: memberTransport[0]?.id ?? `${member.id}:${invoiceMonth}:transport`,
        billing_status: "Billed",
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 50),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 50)
      });
      billingCoverages.push({
        id: stableUuid(`billing-coverage:${invoiceId}:transport`),
        member_id: member.id,
        coverage_type: "Transportation",
        coverage_start_date: invoicePeriodStart,
        coverage_end_date: invoicePeriodEnd,
        source_invoice_id: invoiceId,
        source_invoice_line_id: transportLineId,
        source_table: "billing_invoice_lines",
        source_record_id: transportLineId,
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 5)
      });
    }

    if (ancillaryAmount > 0) {
      const ancillaryLineId = stableUuid(`billing-line:${invoiceId}:ancillary`);
      billingInvoiceLines.push({
        id: ancillaryLineId,
        invoice_id: invoiceId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        service_date: invoicePeriodEnd,
        service_period_start: invoicePeriodStart,
        service_period_end: invoicePeriodEnd,
        line_type: "Ancillary",
        description: "Ancillary service charges",
        quantity: memberAncillary.length,
        unit_rate: memberAncillary.length > 0 ? Number((ancillaryAmount / memberAncillary.length).toFixed(2)) : ancillaryAmount,
        amount: ancillaryAmount,
        source_table: "ancillary_charge_logs",
        source_record_id: memberAncillary[0]?.id ?? `${member.id}:${invoiceMonth}:ancillary`,
        billing_status: "Billed",
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 55),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 9, 55)
      });
      billingCoverages.push({
        id: stableUuid(`billing-coverage:${invoiceId}:ancillary`),
        member_id: member.id,
        coverage_type: "Ancillary",
        coverage_start_date: invoicePeriodStart,
        coverage_end_date: invoicePeriodEnd,
        source_invoice_id: invoiceId,
        source_invoice_line_id: ancillaryLineId,
        source_table: "billing_invoice_lines",
        source_record_id: ancillaryLineId,
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 10)
      });
    }

    if (adjustmentAmount !== 0) {
      const adjustmentLineId = stableUuid(`billing-line:${invoiceId}:adjustment`);
      billingInvoiceLines.push({
        id: adjustmentLineId,
        invoice_id: invoiceId,
        member_id: member.id,
        payor_id: settings?.payor_id ?? null,
        service_date: addDays(invoicePeriodEnd, -2),
        service_period_start: null,
        service_period_end: null,
        line_type: adjustmentAmount > 0 ? "Adjustment" : "Credit",
        description: "Manual billing adjustment",
        quantity: 1,
        unit_rate: Math.abs(adjustmentAmount),
        amount: adjustmentAmount,
        source_table: "billing_adjustments",
        source_record_id: stableUuid(`billing-adjustment:${member.id}:${invoiceMonth}`),
        billing_status: "Billed",
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 10, 0),
        updated_at: toIsoAt(addDays(invoicePeriodEnd, 1), 10, 0)
      });
      billingCoverages.push({
        id: stableUuid(`billing-coverage:${invoiceId}:adjustment`),
        member_id: member.id,
        coverage_type: "Adjustment",
        coverage_start_date: addDays(invoicePeriodEnd, -2),
        coverage_end_date: addDays(invoicePeriodEnd, -2),
        source_invoice_id: invoiceId,
        source_invoice_line_id: adjustmentLineId,
        source_table: "billing_invoice_lines",
        source_record_id: adjustmentLineId,
        created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 12, 15)
      });
    }
  });

  const billingBatchId = stableUuid(`billing-batch:${invoiceMonth}`);
  const billingBatches: Record<string, unknown>[] = [
    {
      id: billingBatchId,
      batch_type: "Mixed",
      billing_month: invoiceMonth,
      run_date: addDays(invoicePeriodEnd, 1),
      batch_status: "Finalized",
      invoice_count: billingInvoices.length,
      total_amount: Number(invoiceTotal.toFixed(2)),
      completion_date: addDays(invoicePeriodEnd, 2),
      next_due_date: addDays(invoicePeriodEnd, 30),
      generated_by_user_id: actorUserId,
      generated_by_name: actorName,
      finalized_by: actorName,
      finalized_at: toIsoAt(addDays(invoicePeriodEnd, 2), 16, 30),
      reopened_by: null,
      reopened_at: null,
      created_at: toIsoAt(addDays(invoicePeriodEnd, 1), 8, 30),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 2), 16, 30)
    }
  ];
  const billingExportJobs: Record<string, unknown>[] = [
    {
      id: stableUuid(`billing-export:${billingBatchId}`),
      billing_batch_id: billingBatchId,
      export_type: "InvoiceSummaryCSV",
      quickbooks_detail_level: "Summary",
      file_name: `billing-summary-${invoiceMonth}.csv`,
      file_data_url: null,
      generated_at: toIsoAt(addDays(invoicePeriodEnd, 3), 10, 0),
      generated_by: actorName,
      status: "Generated",
      notes: "Seeded export artifact for QA validation.",
      created_at: toIsoAt(addDays(invoicePeriodEnd, 3), 10, 0),
      updated_at: toIsoAt(addDays(invoicePeriodEnd, 3), 10, 0)
    }
  ];

  const updatedTransportationLogs = db.transportationLogs.map((row, idx) => {
    const shouldBill = billedMemberIds.has(row.member_id) && idx % 5 !== 0;
    const unitRate = Number(row.unit_rate ?? 20);
    const quantity = Number(row.quantity ?? 1);
    return {
      ...row,
      trip_type: row.trip_type ?? "OneWay",
      quantity,
      unit_rate: unitRate,
      total_amount: Number((unitRate * quantity).toFixed(2)),
      billable: row.billable ?? true,
      billing_status: shouldBill ? "Billed" : row.billing_status ?? "Unbilled",
      billing_exclusion_reason: !shouldBill && idx % 7 === 0 ? "Transport included in bundled arrangement." : row.billing_exclusion_reason ?? null,
      invoice_id: shouldBill ? stableUuid(`billing-invoice:${row.member_id}:${invoiceMonth}`) : null
    };
  });
  const updatedAncillaryLogs = db.ancillaryLogs.map((row, idx) => {
    const unitRate = Number(row.unit_rate ?? row.amount_cents / 100);
    const quantity = Number(row.quantity ?? 1);
    const amount = Number((unitRate * quantity).toFixed(2));
    const shouldBill = billedMemberIds.has(row.member_id) && idx % 4 !== 0;
    return {
      ...row,
      unit_rate: unitRate,
      total_amount: amount,
      billing_status: shouldBill ? "Billed" : row.billing_status ?? "Unbilled",
      billing_exclusion_reason: !shouldBill && idx % 9 === 0 ? "Promotional courtesy adjustment." : row.billing_exclusion_reason ?? null,
      invoice_id: shouldBill ? stableUuid(`billing-invoice:${row.member_id}:${invoiceMonth}`) : null
    };
  });

  return {
    billingBatches,
    billingInvoices,
    billingInvoiceLines,
    billingAdjustments,
    billingCoverages,
    billingExportJobs,
    transportationLogs: updatedTransportationLogs,
    ancillaryLogs: updatedAncillaryLogs
  };
}

function buildDerivedRows(db: SeededDb, staffMap: Map<string, string>) {
  const mapStaff = (id: string | null | undefined) => (id ? staffMap.get(id) ?? null : null);
  const today = asDateOnly(new Date().toISOString(), "2026-01-01") as string;

  const manager =
    db.staff.find((row) => row.role === "manager" || row.role === "admin" || row.role === "director") ?? db.staff[0];
  const nurse = db.staff.find((row) => row.role === "nurse") ?? manager;
  const assignableStaff = db.staff.filter((row) => row.active);

  const timePunchExceptions = db.timePunches
    .filter((row) => row.within_fence === false || (row.distance_meters ?? 0) > 120)
    .slice(0, 24)
    .map((row, idx) => {
      const resolved = idx % 3 === 0;
      const exceptionType = row.within_fence === false ? "outside_geofence" : "distance_threshold";
      const message =
        exceptionType === "outside_geofence"
          ? "Punch recorded outside configured site geofence."
          : "Punch distance exceeded configured threshold.";
      return {
        id: ensureUuid(stableUuid(`time-punch-exception:${row.id}`), `time-punch-exception:${row.id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        punch_id: ensureUuid(row.id, `time-punch:${row.id}`),
        exception_type: exceptionType,
        message,
        resolved,
        resolved_by: resolved ? mapStaff(manager.id) : null,
        resolved_at: resolved ? row.punch_at : null,
        created_at: row.punch_at
      };
    })
    .filter((row) => row.staff_user_id);

  const payPeriods = [...db.payPeriods].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const periodForDate = (date: string) =>
    payPeriods.find((row) => row.start_date <= date && row.end_date >= date) ?? null;

  const punchGroups = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      workDate: string;
      inTimes: string[];
      outTimes: string[];
      sampleTimestamp: string;
    }
  >();
  db.punches.forEach((row) => {
    const employeeId = mapStaff(row.employee_id);
    if (!employeeId) return;
    if (row.status === "voided") return;
    const workDate = asDateOnly(row.timestamp);
    if (!workDate) return;
    const key = `${employeeId}:${workDate}`;
    const existing = punchGroups.get(key) ?? {
      employeeId,
      employeeName: row.employee_name,
      workDate,
      inTimes: [],
      outTimes: [],
      sampleTimestamp: row.timestamp
    };
    if (row.type === "in") existing.inTimes.push(row.timestamp);
    if (row.type === "out") existing.outTimes.push(row.timestamp);
    punchGroups.set(key, existing);
  });

  const dailyTimecards = [...punchGroups.values()].map((group) => {
    const sortedIn = [...group.inTimes].sort();
    const sortedOut = [...group.outTimes].sort();
    const firstIn = sortedIn[0] ?? null;
    const lastOut = sortedOut.length > 0 ? sortedOut[sortedOut.length - 1] : null;
    let rawHours = 0;
    if (firstIn && lastOut) {
      const inMs = Date.parse(firstIn);
      const outMs = Date.parse(lastOut);
      if (!Number.isNaN(inMs) && !Number.isNaN(outMs) && outMs > inMs) {
        rawHours = Math.max(0, (outMs - inMs) / 3600000);
      }
    }
    const roundedRaw = Number(rawHours.toFixed(2));
    const mealDeduction = roundedRaw >= 6 ? 0.5 : 0;
    const workedHours = Number(Math.max(0, roundedRaw - mealDeduction).toFixed(2));
    const overtimeHours = Number(Math.max(0, workedHours - 8).toFixed(2));
    const hasException = !firstIn || !lastOut;
    const status: "pending" | "needs_review" | "approved" | "corrected" = hasException
      ? "needs_review"
      : group.workDate < today
        ? "approved"
        : "pending";
    const matchedPeriod = periodForDate(group.workDate);
    return {
      id: ensureUuid(stableUuid(`daily-timecard:${group.employeeId}:${group.workDate}`), `daily-timecard:${group.employeeId}:${group.workDate}`),
      employee_id: group.employeeId,
      employee_name: group.employeeName,
      work_date: group.workDate,
      first_in: firstIn,
      last_out: lastOut,
      raw_hours: roundedRaw,
      meal_deduction_hours: mealDeduction,
      worked_hours: workedHours,
      pto_hours: 0,
      overtime_hours: overtimeHours,
      total_paid_hours: workedHours,
      status,
      director_note: hasException ? "Missing punch pair detected during seed translation." : null,
      approved_by: status === "approved" ? manager.full_name : null,
      approved_at: status === "approved" ? toIsoAt(group.workDate, 18, 0) : null,
      pay_period_id: matchedPeriod ? ensureUuid(matchedPeriod.id, `pay-period:${matchedPeriod.id}`) : null,
      has_exception: hasException,
      created_at: group.sampleTimestamp,
      updated_at: group.sampleTimestamp
    };
  });

  const ptoEntries = db.staff
    .filter((row) => row.active)
    .slice(0, 8)
    .map((row, idx) => {
      const employeeId = mapStaff(row.id);
      if (!employeeId) return null;
      const workDate = addDays(today, -((idx % 5) + 2));
      const type = (["vacation", "sick", "holiday", "personal"] as const)[idx % 4];
      const status = idx % 3 === 0 ? "pending" : "approved";
      return {
        id: ensureUuid(stableUuid(`pto-entry:${employeeId}:${workDate}`), `pto-entry:${employeeId}:${workDate}`),
        employee_id: employeeId,
        employee_name: row.full_name,
        work_date: workDate,
        hours: idx % 2 === 0 ? 8 : 4,
        type,
        status,
        note: "Seeded PTO entry for testing payroll and daily totals.",
        approved_by: status === "approved" ? manager.full_name : null,
        approved_at: status === "approved" ? toIsoAt(workDate, 15, 0) : null,
        created_at: toIsoAt(workDate, 9, 0),
        updated_at: toIsoAt(workDate, 9, 0)
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const ptoByEmployeeDate = new Map<string, number>();
  ptoEntries.forEach((row) => {
    if (row.status === "denied") return;
    const key = `${row.employee_id}:${row.work_date}`;
    ptoByEmployeeDate.set(key, (ptoByEmployeeDate.get(key) ?? 0) + row.hours);
  });

  dailyTimecards.forEach((row) => {
    const ptoHours = ptoByEmployeeDate.get(`${row.employee_id}:${row.work_date}`) ?? 0;
    row.pto_hours = Number(ptoHours.toFixed(2));
    row.total_paid_hours = Number((row.worked_hours + row.pto_hours).toFixed(2));
  });

  const forgottenPunchRequests = dailyTimecards
    .filter((row) => row.has_exception)
    .slice(0, 12)
    .map((row, idx) => {
      const requestType: "missing_in" | "missing_out" | "full_shift" | "edit_shift" = !row.first_in
        ? "missing_in"
        : !row.last_out
          ? "missing_out"
          : "edit_shift";
      const status = idx % 2 === 0 ? "submitted" : "approved";
      return {
        id: ensureUuid(stableUuid(`forgotten-punch:${row.employee_id}:${row.work_date}`), `forgotten-punch:${row.employee_id}:${row.work_date}`),
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        work_date: row.work_date,
        request_type: requestType,
        requested_in: toTimeOnly(row.first_in),
        requested_out: toTimeOnly(row.last_out),
        reason: "Seeded request: missing punch pair detected from translated punch set.",
        employee_note: "Please verify this shift.",
        status,
        director_decision_note: status === "approved" ? "Approved during seed translation." : null,
        approved_by: status === "approved" ? manager.full_name : null,
        approved_at: status === "approved" ? toIsoAt(row.work_date, 14, 0) : null,
        created_at: toIsoAt(row.work_date, 10, 0),
        updated_at: toIsoAt(row.work_date, 10, 0)
      };
    });

  const marEntries = db.memberMedications
    .slice(0, 120)
    .map((row, idx) => {
      const dueDate = asDateOnly(row.date_started, addDays(today, -(idx % 7))) as string;
      const dueAt = toIsoAt(dueDate, 9 + (idx % 3) * 2, 0);
      const status = idx % 4 === 0 ? "scheduled" : idx % 5 === 0 ? "missed" : "administered";
      return {
        id: ensureUuid(row.id, `mar-entry:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        medication_name: row.medication_name,
        due_at: dueAt,
        administered_at: status === "administered" ? toIsoAt(dueDate, 10 + (idx % 3) * 2, 0) : null,
        nurse_user_id: mapStaff(row.created_by_user_id) ?? mapStaff(nurse.id),
        status,
        notes: row.comments ?? null,
        created_at: dueAt
      };
    });

  const activityDateByMember = new Map<string, string>();
  db.dailyActivities.forEach((row) => {
    const current = activityDateByMember.get(row.member_id);
    if (!current || current < row.activity_date) activityDateByMember.set(row.member_id, row.activity_date);
  });

  const documentationTracker = db.members
    .filter((row) => row.status === "active")
    .map((row, idx) => {
      const assigned = assignableStaff[idx % assignableStaff.length] ?? manager;
      const assignedStaffId = mapStaff(assigned.id);
      const startDate = asDateOnly(row.enrollment_date, addDays(today, -(120 + idx))) as string;
      const lastCarePlanUpdate = asDateOnly(row.latest_assessment_date, addDays(startDate, 30));
      const nextCarePlanDue = addDays(lastCarePlanUpdate as string, 180);
      const lastProgressNote = activityDateByMember.get(row.id) ?? addDays(today, -((idx % 10) + 1));
      const nextProgressNoteDue = addDays(lastProgressNote, 30);
      return {
        id: ensureUuid(stableUuid(`doc-tracker:${row.id}`), `doc-tracker:${row.id}`),
        member_id: ensureUuid(row.id, `member:${row.id}`),
        member_name: row.display_name,
        start_date: startDate,
        last_care_plan_update: lastCarePlanUpdate,
        next_care_plan_due: nextCarePlanDue,
        care_plan_done: idx % 4 !== 0,
        last_progress_note: lastProgressNote,
        next_progress_note_due: nextProgressNoteDue,
        note_done: idx % 3 !== 0,
        assigned_staff_user_id: assignedStaffId,
        assigned_staff_name: assigned.full_name,
        qr_code: row.qr_code,
        created_at: toIsoAt(startDate, 9, 0),
        updated_at: toIsoAt(today, 9, 0)
      };
    });

  const documentationAssignments = documentationTracker.flatMap((row) => [
    {
      id: ensureUuid(stableUuid(`doc-assignment:care:${row.member_id}`), `doc-assignment:care:${row.member_id}`),
      member_id: row.member_id,
      assignment_type: "care_plan_review",
      due_at: toIsoAt(row.next_care_plan_due, 20, 0),
      completed: row.care_plan_done,
      completed_at: row.care_plan_done ? toIsoAt(row.next_care_plan_due, 12, 0) : null,
      assigned_staff_user_id: row.assigned_staff_user_id,
      created_at: toIsoAt(today, 8, 30)
    },
    {
      id: ensureUuid(stableUuid(`doc-assignment:progress:${row.member_id}`), `doc-assignment:progress:${row.member_id}`),
      member_id: row.member_id,
      assignment_type: "progress_note",
      due_at: toIsoAt(row.next_progress_note_due, 20, 0),
      completed: row.note_done,
      completed_at: row.note_done ? toIsoAt(row.next_progress_note_due, 13, 0) : null,
      assigned_staff_user_id: row.assigned_staff_user_id,
      created_at: toIsoAt(today, 8, 45)
    }
  ]);

  const documentationEvents = [
    ...db.dailyActivities
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:daily_activity_logs:${row.id}`), `doc-event:daily_activity_logs:${row.id}`),
        event_type: "daily_activity_logged",
        event_table: "daily_activity_logs",
        event_row_id: ensureUuid(row.id, `daily-activity:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.created_at ?? toIsoAt(row.activity_date, 12, 0),
        created_at: row.created_at ?? toIsoAt(row.activity_date, 12, 0)
      }))
      .filter((row) => row.staff_user_id),
    ...db.toiletLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:toilet_logs:${row.id}`), `doc-event:toilet_logs:${row.id}`),
        event_type: "toilet_logged",
        event_table: "toilet_logs",
        event_row_id: ensureUuid(row.id, `toilet-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.event_at,
        created_at: row.event_at
      }))
      .filter((row) => row.staff_user_id),
    ...db.showerLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:shower_logs:${row.id}`), `doc-event:shower_logs:${row.id}`),
        event_type: "shower_logged",
        event_table: "shower_logs",
        event_row_id: ensureUuid(row.id, `shower-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.event_at,
        created_at: row.event_at
      }))
      .filter((row) => row.staff_user_id),
    ...db.transportationLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:transportation_logs:${row.id}`), `doc-event:transportation_logs:${row.id}`),
        event_type: "transport_logged",
        event_table: "transportation_logs",
        event_row_id: ensureUuid(row.id, `transport-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.timestamp,
        created_at: row.timestamp
      }))
      .filter((row) => row.staff_user_id),
    ...db.ancillaryLogs
      .map((row) => ({
        id: ensureUuid(stableUuid(`doc-event:ancillary_charge_logs:${row.id}`), `doc-event:ancillary_charge_logs:${row.id}`),
        event_type: "ancillary_logged",
        event_table: "ancillary_charge_logs",
        event_row_id: ensureUuid(row.id, `ancillary-log:${row.id}`),
        member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
        staff_user_id: mapStaff(row.staff_user_id),
        event_at: row.created_at,
        created_at: row.created_at
      }))
      .filter((row) => row.staff_user_id)
  ];

  return {
    timePunchExceptions,
    dailyTimecards,
    forgottenPunchRequests,
    ptoEntries,
    marEntries,
    documentationTracker,
    documentationAssignments,
    documentationEvents
  };
}

function buildRows(sourceDb: SeededDb, staffMap: Map<string, string>) {
  const db = withMemberCohort(sourceDb);
  const mapStaff = (id: string | null | undefined) => (id ? staffMap.get(id) ?? null : null);
  const salesSeed = buildLeadSeedPackage(db);
  const seededPartnerIds = new Set(
    [...salesSeed.leads, ...salesSeed.leadActivities, ...salesSeed.partnerActivities]
      .map((row) => cleanText((row as { partner_id?: string | null }).partner_id))
      .filter((value): value is string => Boolean(value))
  );
  const seededReferralIds = new Set(
    [...salesSeed.leads, ...salesSeed.leadActivities, ...salesSeed.partnerActivities]
      .map((row) => cleanText((row as { referral_source_id?: string | null }).referral_source_id))
      .filter((value): value is string => Boolean(value))
  );
  const partnerByExternalId = new Map<string, string>();
  const referralByExternalId = new Map<string, string>();

  const scopedPartners = db.partners.filter((row) => seededPartnerIds.has(row.partner_id));
  const scopedReferrals = db.referralSources.filter((row) => seededReferralIds.has(row.referral_source_id));

  const partnerRows = scopedPartners.map((row) => {
    partnerByExternalId.set(row.partner_id, row.id);
    return { id: row.id, partner_id: row.partner_id, organization_name: row.organization_name, category: row.referral_source_category, active: row.active };
  });
  const referralRows = scopedReferrals.map((row) => {
    referralByExternalId.set(row.referral_source_id, row.id);
    return { id: row.id, referral_source_id: row.referral_source_id, partner_id: partnerByExternalId.get(row.partner_id) ?? null, contact_name: row.contact_name, organization_name: row.organization_name, active: row.active };
  });
  const intake = buildIntakeCascade(db, staffMap);
  const derived = buildDerivedRows(db, staffMap);
  const billing = buildBillingRows(db, staffMap);
  const carePlans = buildCarePlanRows(db, staffMap);
  const scheduleChanges = buildScheduleChanges(db, staffMap);
  const pricingActor =
    db.staff.find((row) => row.role === "admin" && row.active) ??
    db.staff.find((row) => row.role === "director" && row.active) ??
    db.staff.find((row) => row.role === "manager" && row.active) ??
    db.staff[0];
  const pricingActorUserId = pricingActor ? mapStaff(pricingActor.id) : null;
  const pricingEffectiveStartDate = "2026-01-01";
  const enrollmentPricingCommunityFees = [
    {
      id: stableUuid("seed:enrollment-pricing:community-fee:default"),
      amount: 750,
      effective_start_date: pricingEffectiveStartDate,
      effective_end_date: null,
      is_active: true,
      notes: "Seeded default community fee for enrollment packet pricing.",
      created_by: pricingActorUserId,
      updated_by: pricingActorUserId
    }
  ];
  const enrollmentPricingDailyRates = [
    {
      id: stableUuid("seed:enrollment-pricing:daily-rate:1day"),
      label: "1 day/week",
      min_days_per_week: 1,
      max_days_per_week: 1,
      daily_rate: 205,
      effective_start_date: pricingEffectiveStartDate,
      effective_end_date: null,
      is_active: true,
      display_order: 10,
      notes: "Seeded default daily rate tier.",
      created_by: pricingActorUserId,
      updated_by: pricingActorUserId
    },
    {
      id: stableUuid("seed:enrollment-pricing:daily-rate:2to3"),
      label: "2-3 days/week",
      min_days_per_week: 2,
      max_days_per_week: 3,
      daily_rate: 180,
      effective_start_date: pricingEffectiveStartDate,
      effective_end_date: null,
      is_active: true,
      display_order: 20,
      notes: "Seeded default daily rate tier.",
      created_by: pricingActorUserId,
      updated_by: pricingActorUserId
    },
    {
      id: stableUuid("seed:enrollment-pricing:daily-rate:4to5"),
      label: "4-5 days/week",
      min_days_per_week: 4,
      max_days_per_week: 5,
      daily_rate: 170,
      effective_start_date: pricingEffectiveStartDate,
      effective_end_date: null,
      is_active: true,
      display_order: 30,
      notes: "Seeded default daily rate tier.",
      created_by: pricingActorUserId,
      updated_by: pricingActorUserId
    }
  ];

  const firstMappedUserId = [...staffMap.values()][0] ?? null;
  const salesActor =
    db.staff.find((row) => row.role === "sales" && row.active) ??
    db.staff.find((row) => row.role === "coordinator" && row.active) ??
    db.staff.find((row) => row.role === "manager" && row.active) ??
    db.staff[0];
  const nurseActor =
    db.staff.find((row) => row.role === "nurse" && row.active) ??
    db.staff.find((row) => row.role === "director" && row.active) ??
    db.staff[0];
  const coordinatorActor =
    db.staff.find((row) => row.role === "coordinator" && row.active) ??
    db.staff.find((row) => row.role === "manager" && row.active) ??
    db.staff[0];
  const salesActorUserId = (salesActor ? mapStaff(salesActor.id) : null) ?? firstMappedUserId;
  const nurseActorUserId = (nurseActor ? mapStaff(nurseActor.id) : null) ?? firstMappedUserId;
  const coordinatorActorUserId = (coordinatorActor ? mapStaff(coordinatorActor.id) : null) ?? firstMappedUserId;
  if (!salesActorUserId || !nurseActorUserId || !coordinatorActorUserId) {
    throw new Error("Seed workflow actor mapping is missing profile ids.");
  }

  const normalizeRequestedDays = (schedule: SeededDb["memberAttendanceSchedules"][number] | undefined) => {
    const days: string[] = [];
    if (schedule?.monday) days.push("Monday");
    if (schedule?.tuesday) days.push("Tuesday");
    if (schedule?.wednesday) days.push("Wednesday");
    if (schedule?.thursday) days.push("Thursday");
    if (schedule?.friday) days.push("Friday");
    return days.length > 0 ? days : ["Monday", "Wednesday", "Friday"];
  };

  const toRecordRows = (value: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)
    );
  };

  const parseTime24h = (value: string | null | undefined) => {
    const normalized = String(value ?? "").trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  };

  const today = asDateOnly(new Date().toISOString(), "2026-03-01") as string;
  const memberById = new Map(db.members.map((row) => [row.id, row] as const));
  const leadById = new Map(salesSeed.leads.map((row) => [row.id, row] as const));
  const scheduleByMember = new Map(db.memberAttendanceSchedules.map((row) => [row.member_id, row] as const));
  const contactByMember = new Map<string, SeededDb["memberContacts"][number]>();
  db.memberContacts.forEach((row) => {
    if (!contactByMember.has(row.member_id)) contactByMember.set(row.member_id, row);
  });

  const workflowMemberFiles: Record<string, unknown>[] = [];
  const intakeAssessmentSignatures: Record<string, unknown>[] = [];
  const intakeAssessments = db.assessments.map((row, idx) => {
    const signed = row.complete && idx % 7 !== 0;
    const signedAt = signed ? toIsoAt(asDateOnly(row.assessment_date, addDays(today, -21)) as string, 16, 10) : null;
    const signerUserId = signed ? mapStaff(row.created_by_user_id) ?? nurseActorUserId : null;
    const signerName = signed ? row.signed_by || row.completed_by || nurseActor?.full_name || "Clinical Nurse" : null;
    const signatureFileId = signed ? stableUuid(`seed:member-file:intake-signature:${row.id}`) : null;
    if (signed && signatureFileId) {
      workflowMemberFiles.push({
        id: signatureFileId,
        member_id: row.member_id,
        file_name: `intake-assessment-signature-${row.id.slice(0, 8)}.png`,
        file_type: "image/png",
        file_data_url: `storage://member-documents/members/${row.member_id}/intake/${row.id}/signature.png`,
        category: "Intake Assessment",
        category_other: null,
        document_source: "intake-assessment-esign",
        uploaded_by_user_id: signerUserId,
        uploaded_by_name: signerName,
        uploaded_at: signedAt,
        updated_at: signedAt
      });
      intakeAssessmentSignatures.push({
        id: stableUuid(`seed:intake-signature:${row.id}`),
        assessment_id: row.id,
        member_id: row.member_id,
        signed_by_user_id: signerUserId,
        signed_by_name: signerName,
        signed_at: signedAt,
        status: "signed",
        signature_artifact_storage_path: `members/${row.member_id}/intake/${row.id}/signature.png`,
        signature_artifact_member_file_id: signatureFileId,
        signature_metadata: {
          seeded: true,
          seededSource: "seed:v3"
        },
        created_at: signedAt,
        updated_at: signedAt
      });
    }

    return {
      id: row.id,
      member_id: row.member_id,
      lead_id: row.lead_id ?? salesSeed.memberLeadByMemberId.get(row.member_id) ?? null,
      assessment_date: row.assessment_date,
      status: row.complete ? "completed" : "draft",
      completed_by_user_id: mapStaff(row.created_by_user_id),
      completed_by: row.completed_by,
      signed_by: signerName ?? row.signed_by,
      complete: row.complete,
      feeling_today: row.feeling_today,
      health_lately: row.health_lately,
      allergies: row.allergies,
      code_status: row.code_status,
      orientation_dob_verified: row.orientation_dob_verified,
      orientation_city_verified: row.orientation_city_verified,
      orientation_year_verified: row.orientation_year_verified,
      orientation_occupation_verified: row.orientation_occupation_verified,
      orientation_notes: row.orientation_notes,
      medication_management_status: row.medication_management_status,
      dressing_support_status: row.dressing_support_status,
      assistive_devices: row.assistive_devices,
      incontinence_products: row.incontinence_products,
      on_site_medication_use: row.on_site_medication_use,
      on_site_medication_list: row.on_site_medication_list,
      independence_notes: row.independence_notes,
      diet_type: row.diet_type,
      diet_other: row.diet_other,
      diet_restrictions_notes: row.diet_restrictions_notes,
      mobility_steadiness: row.mobility_steadiness,
      falls_history: row.falls_history,
      mobility_aids: row.mobility_aids,
      mobility_safety_notes: row.mobility_safety_notes,
      overwhelmed_by_noise: row.overwhelmed_by_noise,
      social_triggers: row.social_triggers,
      emotional_wellness_notes: row.emotional_wellness_notes,
      joy_sparks: row.joy_sparks,
      personal_notes: row.personal_notes,
      score_orientation_general_health: row.score_orientation_general_health,
      score_daily_routines_independence: row.score_daily_routines_independence,
      score_nutrition_dietary_needs: row.score_nutrition_dietary_needs,
      score_mobility_safety: row.score_mobility_safety,
      score_social_emotional_wellness: row.score_social_emotional_wellness,
      total_score: row.total_score,
      recommended_track: row.recommended_track,
      admission_review_required: row.admission_review_required,
      transport_can_enter_exit_vehicle: row.transport_can_enter_exit_vehicle,
      transport_assistance_level: row.transport_assistance_level,
      transport_mobility_aid: row.transport_mobility_aid,
      transport_can_remain_seated_buckled: row.transport_can_remain_seated_buckled,
      transport_behavior_concern: row.transport_behavior_concern,
      transport_appropriate: row.transport_appropriate,
      transport_notes: row.transport_notes,
      vitals_hr: row.vitals_hr,
      vitals_bp: row.vitals_bp,
      vitals_o2_percent: row.vitals_o2_percent,
      vitals_rr: row.vitals_rr,
      notes: row.notes,
      signed_by_user_id: signerUserId,
      signed_at: signedAt,
      signature_status: signed ? "signed" : "unsigned",
      signature_metadata: {
        seeded: true,
        seededSource: "seed:v3"
      },
      created_at: row.created_at,
      updated_at: row.created_at
    };
  });

  const baseMemberFiles = db.memberFiles.map((row) => ({
    ...row,
    uploaded_by_user_id: mapStaff(row.uploaded_by_user_id)
  }));

  const pofRequests: Record<string, unknown>[] = [];
  const pofSignatures: Record<string, unknown>[] = [];
  const pofDocumentEvents: Record<string, unknown>[] = [];
  const pofMedications: Record<string, unknown>[] = [];
  const marSchedules: Record<string, unknown>[] = [];
  const marAdministrations: Record<string, unknown>[] = [];
  const activeSignedOrders = intake.pofRows
    .filter((row) => cleanText((row as { status?: unknown }).status) === "signed" && Boolean((row as { is_active_signed?: unknown }).is_active_signed))
    .map((row) => row as Record<string, unknown>);

  activeSignedOrders.forEach((order, idx) => {
    const orderId = cleanText(order.id);
    const memberId = cleanText(order.member_id);
    if (!orderId || !memberId) return;
    const member = memberById.get(memberId);
    if (!member) return;

    const leadId = salesSeed.memberLeadByMemberId.get(memberId) ?? null;
    const lead = leadId ? leadById.get(leadId) ?? null : null;
    const contact = contactByMember.get(memberId) ?? null;
    const providerName = cleanText(order.provider_name) ?? "Dr. Morgan White";
    const providerEmail = lead?.caregiver_email ? `provider+${lead.id.slice(0, 8)}@exampleclinic.org` : `provider${idx + 1}@exampleclinic.org`;
    const requestId = stableUuid(`seed:pof-request:${orderId}`);
    const requestTokenHash = createHash("sha256").update(`seed:pof-token:${requestId}`).digest("hex");
    const createdDate = addDays(asDateOnly(cleanText(order.signed_at), today) as string, -7);
    const sentDate = addDays(createdDate, 1);
    const openedDate = addDays(createdDate, 2);
    const signedDate = addDays(createdDate, 3);
    const requestStatus: "draft" | "sent" | "opened" | "signed" | "declined" | "expired" =
      idx % 6 === 0 ? "signed" : idx % 6 === 1 ? "opened" : idx % 6 === 2 ? "sent" : idx % 6 === 3 ? "declined" : idx % 6 === 4 ? "expired" : "draft";
    const unsignedFileId = stableUuid(`seed:member-file:pof-unsigned:${requestId}`);
    const signedFileId = stableUuid(`seed:member-file:pof-signed:${requestId}`);
    const sentAtIso = requestStatus === "draft" ? null : toIsoAt(sentDate, 10, 20);
    const openedAtIso = requestStatus === "opened" || requestStatus === "signed" ? toIsoAt(openedDate, 8, 35) : null;
    const signedAtIso = requestStatus === "signed" ? toIsoAt(signedDate, 12, 5) : null;
    const unsignedStoragePath = `members/${memberId}/pof/${orderId}/requests/${requestId}/unsigned.pdf`;
    const signedStoragePath = `members/${memberId}/pof/${orderId}/requests/${requestId}/signed.pdf`;

    workflowMemberFiles.push({
      id: unsignedFileId,
      member_id: memberId,
      file_name: `pof-${orderId.slice(0, 8)}-unsigned.pdf`,
      file_type: "application/pdf",
      file_data_url: `storage://member-documents/${unsignedStoragePath}`,
      category: "Physician Orders",
      category_other: null,
      document_source: "pof-esign",
      uploaded_by_user_id: nurseActorUserId,
      uploaded_by_name: nurseActor?.full_name ?? "Clinical Nurse",
      uploaded_at: toIsoAt(createdDate, 10, 0),
      updated_at: toIsoAt(createdDate, 10, 0)
    });
    if (requestStatus === "signed") {
      workflowMemberFiles.push({
        id: signedFileId,
        member_id: memberId,
        file_name: `pof-${orderId.slice(0, 8)}-signed.pdf`,
        file_type: "application/pdf",
        file_data_url: `storage://member-documents/${signedStoragePath}`,
        category: "Physician Orders",
        category_other: null,
        document_source: "pof-esign",
        uploaded_by_user_id: nurseActorUserId,
        uploaded_by_name: nurseActor?.full_name ?? "Clinical Nurse",
        uploaded_at: signedAtIso,
        updated_at: signedAtIso
      });
    }

    pofRequests.push({
      id: requestId,
      physician_order_id: orderId,
      member_id: memberId,
      provider_name: providerName,
      provider_email: providerEmail,
      nurse_name: nurseActor?.full_name ?? "Clinical Nurse",
      from_email: "clinical@memorylane.local",
      sent_by_user_id: nurseActorUserId,
      status: requestStatus,
      optional_message: "Seeded provider signature workflow request.",
      sent_at: sentAtIso,
      opened_at: openedAtIso,
      signed_at: signedAtIso,
      expires_at: toIsoAt(addDays(createdDate, 14), 23, 59),
      signature_request_token: requestTokenHash,
      signature_request_url: `http://localhost:3001/sign/pof/${requestTokenHash.slice(0, 48)}`,
      unsigned_pdf_url: `storage://member-documents/${unsignedStoragePath}`,
      signed_pdf_url: requestStatus === "signed" ? `storage://member-documents/${signedStoragePath}` : null,
      member_file_id: requestStatus === "signed" ? signedFileId : unsignedFileId,
      pof_payload_json: {
        id: orderId,
        memberId,
        memberNameSnapshot: member.display_name,
        diagnosisRows: toRecordRows(order.diagnoses),
        allergyRows: toRecordRows(order.allergies),
        medications: toRecordRows(order.medications),
        standingOrders: toRecordRows(order.standing_orders),
        careInformation: {
          providerName
        },
        operationalFlags: order.operational_flags ?? {}
      },
      created_by_user_id: nurseActorUserId,
      created_by_name: nurseActor?.full_name ?? "Clinical Nurse",
      created_at: toIsoAt(createdDate, 9, 30),
      updated_by_user_id: nurseActorUserId,
      updated_by_name: nurseActor?.full_name ?? "Clinical Nurse",
      updated_at: signedAtIso ?? openedAtIso ?? sentAtIso ?? toIsoAt(createdDate, 9, 45)
    });

    pofDocumentEvents.push({
      id: stableUuid(`seed:pof-document-event:${requestId}:created`),
      document_type: "pof_request",
      document_id: requestId,
      member_id: memberId,
      physician_order_id: orderId,
      event_type: "created",
      actor_type: "user",
      actor_user_id: nurseActorUserId,
      actor_name: nurseActor?.full_name ?? "Clinical Nurse",
      actor_email: "clinical@memorylane.local",
      actor_ip: null,
      actor_user_agent: null,
      metadata: { seeded: true, source: "seed:v3" },
      created_at: toIsoAt(createdDate, 9, 31)
    });
    if (requestStatus !== "draft") {
      pofDocumentEvents.push({
        id: stableUuid(`seed:pof-document-event:${requestId}:sent`),
        document_type: "pof_request",
        document_id: requestId,
        member_id: memberId,
        physician_order_id: orderId,
        event_type: "sent",
        actor_type: "user",
        actor_user_id: nurseActorUserId,
        actor_name: nurseActor?.full_name ?? "Clinical Nurse",
        actor_email: "clinical@memorylane.local",
        actor_ip: null,
        actor_user_agent: null,
        metadata: {
          caregiverEmail: cleanText(lead?.caregiver_email) ?? cleanText(contact?.email)
        },
        created_at: sentAtIso
      });
    }
    if (openedAtIso) {
      pofDocumentEvents.push({
        id: stableUuid(`seed:pof-document-event:${requestId}:opened`),
        document_type: "pof_request",
        document_id: requestId,
        member_id: memberId,
        physician_order_id: orderId,
        event_type: "opened",
        actor_type: "provider",
        actor_user_id: null,
        actor_name: providerName,
        actor_email: providerEmail,
        actor_ip: "198.51.100.11",
        actor_user_agent: "Seeded Provider Browser",
        metadata: {},
        created_at: openedAtIso
      });
    }
    if (requestStatus === "signed" && signedAtIso) {
      pofSignatures.push({
        id: stableUuid(`seed:pof-signature:${requestId}`),
        pof_request_id: requestId,
        provider_typed_name: providerName,
        provider_signature_image_url: `storage://member-documents/members/${memberId}/pof/${orderId}/requests/${requestId}/provider-signature.png`,
        provider_ip: "198.51.100.11",
        provider_user_agent: "Seeded Provider Browser",
        signed_at: signedAtIso,
        created_at: signedAtIso,
        updated_at: signedAtIso
      });
      pofDocumentEvents.push({
        id: stableUuid(`seed:pof-document-event:${requestId}:signed`),
        document_type: "pof_request",
        document_id: requestId,
        member_id: memberId,
        physician_order_id: orderId,
        event_type: "signed",
        actor_type: "provider",
        actor_user_id: null,
        actor_name: providerName,
        actor_email: providerEmail,
        actor_ip: "198.51.100.11",
        actor_user_agent: "Seeded Provider Browser",
        metadata: {
          memberFileId: signedFileId
        },
        created_at: signedAtIso
      });
    }
    if (requestStatus === "declined") {
      pofDocumentEvents.push({
        id: stableUuid(`seed:pof-document-event:${requestId}:declined`),
        document_type: "pof_request",
        document_id: requestId,
        member_id: memberId,
        physician_order_id: orderId,
        event_type: "declined",
        actor_type: "provider",
        actor_user_id: null,
        actor_name: providerName,
        actor_email: providerEmail,
        actor_ip: "198.51.100.11",
        actor_user_agent: "Seeded Provider Browser",
        metadata: {
          reason: "Needs medication clarification before signing."
        },
        created_at: toIsoAt(addDays(createdDate, 3), 11, 40)
      });
    }
    if (requestStatus === "expired") {
      pofDocumentEvents.push({
        id: stableUuid(`seed:pof-document-event:${requestId}:expired`),
        document_type: "pof_request",
        document_id: requestId,
        member_id: memberId,
        physician_order_id: orderId,
        event_type: "expired",
        actor_type: "system",
        actor_user_id: null,
        actor_name: "System",
        actor_email: null,
        actor_ip: null,
        actor_user_agent: null,
        metadata: {},
        created_at: toIsoAt(addDays(createdDate, 15), 0, 5)
      });
    }

    const medicationRows = toRecordRows(order.medications);
    medicationRows.forEach((medication, medIdx) => {
      const sourceMedicationId = cleanText(medication.id) ?? `med-${medIdx + 1}`;
      const pofMedicationId = stableUuid(`seed:pof-medication:${orderId}:${sourceMedicationId}`);
      const givenAtCenter = String(medication.givenAtCenter ?? "true").toLowerCase() !== "false";
      const active = String(medication.active ?? "true").toLowerCase() !== "false";
      const prn = String(medication.prn ?? "false").toLowerCase() === "true";
      const scheduledTimesRaw = Array.isArray(medication.scheduled_times)
        ? medication.scheduled_times
        : Array.isArray(medication.scheduledTimes)
          ? medication.scheduledTimes
          : cleanText(medication.givenAtCenterTime24h)
            ? [cleanText(medication.givenAtCenterTime24h)]
            : [];
      const normalizedTimes = scheduledTimesRaw
        .map((entry) => cleanText(entry))
        .filter((entry): entry is string => Boolean(entry));
      const scheduledTimes = normalizedTimes.length > 0 ? normalizedTimes : [medIdx % 2 === 0 ? "09:00" : "13:00"];
      const medicationStartDate = asDateOnly(cleanText(medication.startDate) ?? cleanText(medication.date_started), addDays(today, -14)) as string;
      const medicationEndDate = asDateOnly(cleanText(medication.endDate));

      pofMedications.push({
        id: pofMedicationId,
        physician_order_id: orderId,
        member_id: memberId,
        source_medication_id: sourceMedicationId,
        medication_name: cleanText(medication.name) ?? cleanText(medication.medication_name) ?? `Medication ${medIdx + 1}`,
        strength: cleanText(medication.quantity),
        dose: cleanText(medication.dose),
        route: cleanText(medication.route) ?? "PO",
        frequency: cleanText(medication.frequency) ?? "Daily",
        scheduled_times: scheduledTimes,
        given_at_center: givenAtCenter,
        prn,
        prn_instructions: prn ? cleanText(medication.prnInstructions) ?? "Use PRN as clinically indicated." : null,
        start_date: medicationStartDate,
        end_date: medicationEndDate,
        active,
        provider: providerName,
        instructions: cleanText(medication.instructions),
        created_by_user_id: nurseActorUserId,
        created_by_name: nurseActor?.full_name ?? "Clinical Nurse",
        updated_by_user_id: nurseActorUserId,
        updated_by_name: nurseActor?.full_name ?? "Clinical Nurse",
        created_at: toIsoAt(medicationStartDate, 8, 0),
        updated_at: toIsoAt(medicationStartDate, 8, 0)
      });

      if (givenAtCenter && active) {
        scheduledTimes.forEach((timeValue, scheduleIdx) => {
          const parsedTime = parseTime24h(timeValue);
          if (!parsedTime) return;
          const scheduleDate = addDays(today, -(scheduleIdx % 3));
          const scheduleId = stableUuid(`seed:mar-schedule:${pofMedicationId}:${timeValue}`);
          const scheduledAt = toIsoAt(scheduleDate, parsedTime.hour, parsedTime.minute);
          marSchedules.push({
            id: scheduleId,
            member_id: memberId,
            pof_medication_id: pofMedicationId,
            medication_name: cleanText(medication.name) ?? cleanText(medication.medication_name) ?? `Medication ${medIdx + 1}`,
            dose: cleanText(medication.dose),
            route: cleanText(medication.route) ?? "PO",
            scheduled_time: scheduledAt,
            frequency: cleanText(medication.frequency) ?? "Daily",
            instructions: cleanText(medication.instructions),
            prn,
            active: true,
            start_date: medicationStartDate,
            end_date: medicationEndDate,
            created_at: toIsoAt(scheduleDate, 7, 0),
            updated_at: toIsoAt(scheduleDate, 7, 0)
          });

          const notGiven = (idx + medIdx + scheduleIdx) % 5 === 0;
          marAdministrations.push({
            id: stableUuid(`seed:mar-admin:${scheduleId}`),
            member_id: memberId,
            pof_medication_id: pofMedicationId,
            mar_schedule_id: scheduleId,
            administration_date: scheduleDate,
            scheduled_time: scheduledAt,
            medication_name: cleanText(medication.name) ?? cleanText(medication.medication_name) ?? `Medication ${medIdx + 1}`,
            dose: cleanText(medication.dose),
            route: cleanText(medication.route) ?? "PO",
            status: notGiven ? "Not Given" : "Given",
            not_given_reason: notGiven ? "Absent" : null,
            prn_reason: null,
            notes: notGiven ? "Member absent at scheduled administration time." : "Administered per schedule.",
            administered_by: nurseActor?.full_name ?? "Clinical Nurse",
            administered_by_user_id: nurseActorUserId,
            administered_at: toIsoAt(scheduleDate, parsedTime.hour, Math.min(parsedTime.minute + 18, 59)),
            source: "scheduled",
            prn_outcome: null,
            prn_outcome_assessed_at: null,
            prn_followup_note: null,
            created_at: toIsoAt(scheduleDate, parsedTime.hour, Math.min(parsedTime.minute + 20, 59)),
            updated_at: toIsoAt(scheduleDate, parsedTime.hour, Math.min(parsedTime.minute + 20, 59))
          });
        });
      }

      if (prn && active && medIdx % 2 === 0) {
        const prnDate = addDays(today, -(idx % 4));
        const prnOutcome = idx % 3 === 0 ? "Ineffective" : "Effective";
        marAdministrations.push({
          id: stableUuid(`seed:mar-admin-prn:${pofMedicationId}`),
          member_id: memberId,
          pof_medication_id: pofMedicationId,
          mar_schedule_id: null,
          administration_date: prnDate,
          scheduled_time: null,
          medication_name: cleanText(medication.name) ?? cleanText(medication.medication_name) ?? `Medication ${medIdx + 1}`,
          dose: cleanText(medication.dose),
          route: cleanText(medication.route) ?? "PO",
          status: "Given",
          not_given_reason: null,
          prn_reason: "Breakthrough anxiety symptoms.",
          notes: "PRN administered after behavioral escalation.",
          administered_by: nurseActor?.full_name ?? "Clinical Nurse",
          administered_by_user_id: nurseActorUserId,
          administered_at: toIsoAt(prnDate, 14, 10),
          source: "prn",
          prn_outcome: prnOutcome,
          prn_outcome_assessed_at: toIsoAt(prnDate, 15, 5),
          prn_followup_note: prnOutcome === "Ineffective" ? "Escalated to provider for follow-up." : null,
          created_at: toIsoAt(prnDate, 14, 12),
          updated_at: toIsoAt(prnDate, 15, 5)
        });
      }
    });
  });

  const enrollmentPacketRequests: Record<string, unknown>[] = [];
  const enrollmentPacketFields: Record<string, unknown>[] = [];
  const enrollmentPacketEvents: Record<string, unknown>[] = [];
  const enrollmentPacketSignatures: Record<string, unknown>[] = [];
  const enrollmentPacketSenderSignatures: Record<string, unknown>[] = [
    {
      user_id: salesActorUserId,
      signature_name: salesActor?.full_name ?? "Sales Coordinator",
      signature_blob: "data:image/png;base64,c2VlZGVkLXNpZ25hdHVyZQ==",
      created_at: toIsoAt(addDays(today, -90), 9, 0),
      updated_at: toIsoAt(addDays(today, -90), 9, 0)
    }
  ];
  const enrollmentPacketUploads: Record<string, unknown>[] = [];
  const userNotifications: Record<string, unknown>[] = [];

  const enrollmentMembers = db.members.filter((member) => member.status === "active");

  enrollmentMembers.slice(0, TARGET_MEMBER_COUNT).forEach((member, idx) => {
    const leadId = salesSeed.memberLeadByMemberId.get(member.id) ?? null;
    const lead = leadId ? leadById.get(leadId) ?? null : null;
    const schedule = scheduleByMember.get(member.id);
    const contact = contactByMember.get(member.id) ?? null;
    const requestedDays = normalizeRequestedDays(schedule);
    const daysPerWeek = requestedDays.length;
    const dailyRateTier =
      enrollmentPricingDailyRates.find(
        (row) => Number(row.min_days_per_week) <= daysPerWeek && Number(row.max_days_per_week) >= daysPerWeek
      ) ?? enrollmentPricingDailyRates[enrollmentPricingDailyRates.length - 1];
    const communityFeeRow = enrollmentPricingCommunityFees[0];
    const packetId = stableUuid(`seed:enrollment-packet:${member.id}`);
    const packetTokenHash = createHash("sha256").update(`seed:enrollment-packet-token:${packetId}`).digest("hex");
    const packetStatus: "draft" | "prepared" | "sent" | "opened" | "partially_completed" | "completed" | "filed" =
      idx % 7 === 0
        ? "filed"
        : idx % 7 === 1
          ? "completed"
          : idx % 7 === 2
            ? "partially_completed"
            : idx % 7 === 3
              ? "opened"
              : idx % 7 === 4
                ? "sent"
                : idx % 7 === 5
                  ? "prepared"
                  : "draft";
    const createdDate = addDays(today, -(35 + idx));
    const sentAt = ["sent", "opened", "partially_completed", "completed", "filed"].includes(packetStatus)
      ? toIsoAt(addDays(createdDate, 1), 11, 0)
      : null;
    const completedAt = ["completed", "filed"].includes(packetStatus) ? toIsoAt(addDays(createdDate, 4), 15, 40) : null;
    const caregiverEmail = cleanText(lead?.caregiver_email) ?? cleanText(contact?.email) ?? `caregiver${idx + 1}@example.org`;
    const primaryContactName = cleanText(lead?.caregiver_name) ?? cleanText(contact?.contact_name) ?? `Caregiver ${idx + 1}`;
    const primaryContactPhone = cleanText(lead?.caregiver_phone) ?? cleanText(contact?.cellular_number) ?? `803-555-${String(7100 + idx).slice(-4)}`;
    const completedPacketFileId = stableUuid(`seed:member-file:enrollment-packet:${packetId}:completed`);
    const insuranceFileId = stableUuid(`seed:member-file:enrollment-packet:${packetId}:insurance`);

    workflowMemberFiles.push({
      id: insuranceFileId,
      member_id: member.id,
      file_name: `insurance-card-${member.id.slice(0, 8)}.pdf`,
      file_type: "application/pdf",
      file_data_url: `storage://member-documents/members/${member.id}/enrollment/${packetId}/insurance-card.pdf`,
      category: "Insurance",
      category_other: null,
      document_source: "enrollment-packet",
      uploaded_by_user_id: salesActorUserId,
      uploaded_by_name: salesActor?.full_name ?? "Sales Coordinator",
      uploaded_at: toIsoAt(addDays(createdDate, 1), 12, 15),
      updated_at: toIsoAt(addDays(createdDate, 1), 12, 15)
    });
    if (packetStatus === "completed" || packetStatus === "filed") {
      workflowMemberFiles.push({
        id: completedPacketFileId,
        member_id: member.id,
        file_name: `enrollment-packet-${packetId.slice(0, 8)}-completed.pdf`,
        file_type: "application/pdf",
        file_data_url: `storage://member-documents/members/${member.id}/enrollment/${packetId}/completed-packet.pdf`,
        category: "Enrollment Packet",
        category_other: null,
        document_source: "enrollment-packet",
        uploaded_by_user_id: salesActorUserId,
        uploaded_by_name: salesActor?.full_name ?? "Sales Coordinator",
        uploaded_at: completedAt,
        updated_at: completedAt
      });
    }

    enrollmentPacketRequests.push({
      id: packetId,
      member_id: member.id,
      lead_id: leadId,
      sender_user_id: salesActorUserId,
      caregiver_email: caregiverEmail,
      status: packetStatus,
      token: packetTokenHash,
      token_expires_at: toIsoAt(addDays(createdDate, 14), 23, 59),
      created_at: toIsoAt(createdDate, 10, 30),
      sent_at: sentAt,
      completed_at: completedAt,
      updated_at: completedAt ?? sentAt ?? toIsoAt(createdDate, 10, 30)
    });

    enrollmentPacketFields.push({
      id: stableUuid(`seed:enrollment-packet-fields:${packetId}`),
      packet_id: packetId,
      requested_days: requestedDays,
      transportation: schedule?.transportation_required ? schedule.transportation_mode ?? "Door to Door" : "Family Transport",
      community_fee: Number(communityFeeRow.amount),
      daily_rate: Number(dailyRateTier.daily_rate),
      pricing_community_fee_id: communityFeeRow.id,
      pricing_daily_rate_id: dailyRateTier.id,
      pricing_snapshot: {
        seeded: true,
        requestedDays,
        daysPerWeek,
        communityFee: Number(communityFeeRow.amount),
        dailyRate: Number(dailyRateTier.daily_rate)
      },
      caregiver_name: primaryContactName,
      caregiver_phone: primaryContactPhone,
      caregiver_email: caregiverEmail,
      caregiver_address_line1: cleanText(contact?.street_address) ?? `${180 + idx} Oak Ave`,
      caregiver_address_line2: null,
      caregiver_city: cleanText(contact?.city) ?? member.city ?? "Fort Mill",
      caregiver_state: cleanText(contact?.state) ?? "SC",
      caregiver_zip: cleanText(contact?.zip) ?? `297${String((idx % 60) + 10).padStart(2, "0")}`,
      secondary_contact_name: idx % 2 === 0 ? `Secondary Contact ${idx + 1}` : null,
      secondary_contact_phone: idx % 2 === 0 ? `803-555-${String(7200 + idx).slice(-4)}` : null,
      secondary_contact_email: idx % 2 === 0 ? `secondary${idx + 1}@example.org` : null,
      secondary_contact_relationship: idx % 2 === 0 ? "Sibling" : null,
      notes: "Seeded enrollment packet with realistic caregiver and pricing details.",
      intake_payload: {
        requestedAttendanceDays: requestedDays,
        transportationPreference: schedule?.transportation_required ? schedule.transportation_mode ?? "Door to Door" : "Family Transport",
        primaryContactName,
        primaryContactPhone,
        primaryContactEmail: caregiverEmail,
        memberLegalFirstName: cleanText(member.display_name?.split(" ").slice(0, -1).join(" ")) ?? cleanText(member.display_name),
        memberLegalLastName: cleanText(member.display_name?.split(" ").slice(-1).join(" ")),
        memberPreferredName: cleanText(member.display_name?.split(" ").slice(0, 1).join(" ")),
        memberSsnLast4: String(1000 + (idx % 8999)).slice(-4),
        primaryDiagnosis: cleanText(member.latest_assessment_track) ?? "Track 2 Support Needs",
        allergiesSummary: "See allergies section in chart.",
        pharmacy: idx % 2 === 0 ? "Walgreens Fort Mill" : "CVS Rock Hill",
        pcpName: "Dr. Morgan White",
        pcpPhone: "803-555-3000",
        livingSituation: idx % 3 === 0 ? "Lives with daughter" : "Lives with spouse",
        insuranceSummaryReference: `INS-${packetId.slice(0, 8).toUpperCase()}`
      },
      created_at: toIsoAt(createdDate, 10, 32),
      updated_at: completedAt ?? sentAt ?? toIsoAt(createdDate, 10, 32)
    });

    if (packetStatus !== "draft") {
      enrollmentPacketEvents.push({
        id: stableUuid(`seed:enrollment-packet-event:${packetId}:prepared`),
        packet_id: packetId,
        event_type: "prepared",
        actor_user_id: salesActorUserId,
        actor_email: "sales@memorylane.local",
        timestamp: toIsoAt(createdDate, 10, 33),
        metadata: {
          seeded: true
        }
      });
    }
    if (sentAt) {
      enrollmentPacketEvents.push({
        id: stableUuid(`seed:enrollment-packet-event:${packetId}:sent`),
        packet_id: packetId,
        event_type: "Enrollment Packet Sent",
        actor_user_id: salesActorUserId,
        actor_email: "sales@memorylane.local",
        timestamp: sentAt,
        metadata: {
          caregiverEmail
        }
      });
      userNotifications.push({
        id: stableUuid(`seed:user-notification:${packetId}:sent`),
        recipient_user_id: salesActorUserId,
        title: "Enrollment Packet Sent",
        message: `${member.display_name} enrollment packet sent to ${caregiverEmail}.`,
        entity_type: "enrollment_packet_request",
        entity_id: packetId,
        read_at: idx % 2 === 0 ? toIsoAt(addDays(createdDate, 2), 9, 0) : null,
        metadata: {
          memberId: member.id,
          leadId
        },
        created_at: sentAt
      });
    }
    if (packetStatus === "opened" || packetStatus === "partially_completed" || packetStatus === "completed" || packetStatus === "filed") {
      enrollmentPacketEvents.push({
        id: stableUuid(`seed:enrollment-packet-event:${packetId}:opened`),
        packet_id: packetId,
        event_type: "opened",
        actor_user_id: null,
        actor_email: caregiverEmail,
        timestamp: toIsoAt(addDays(createdDate, 2), 8, 20),
        metadata: {}
      });
    }
    if (packetStatus === "partially_completed" || packetStatus === "completed" || packetStatus === "filed") {
      enrollmentPacketEvents.push({
        id: stableUuid(`seed:enrollment-packet-event:${packetId}:partial`),
        packet_id: packetId,
        event_type: "partially_completed",
        actor_user_id: null,
        actor_email: caregiverEmail,
        timestamp: toIsoAt(addDays(createdDate, 3), 13, 10),
        metadata: {}
      });
    }
    if (completedAt) {
      enrollmentPacketEvents.push({
        id: stableUuid(`seed:enrollment-packet-event:${packetId}:completed`),
        packet_id: packetId,
        event_type: "completed",
        actor_user_id: null,
        actor_email: caregiverEmail,
        timestamp: completedAt,
        metadata: {}
      });
    }
    if (packetStatus === "filed") {
      enrollmentPacketEvents.push({
        id: stableUuid(`seed:enrollment-packet-event:${packetId}:filed`),
        packet_id: packetId,
        event_type: "filed",
        actor_user_id: coordinatorActorUserId,
        actor_email: "coordinator@memorylane.local",
        timestamp: toIsoAt(addDays(createdDate, 5), 11, 45),
        metadata: {}
      });
    }

    enrollmentPacketSignatures.push({
      id: stableUuid(`seed:enrollment-packet-signature:${packetId}:sender`),
      packet_id: packetId,
      signer_name: salesActor?.full_name ?? "Sales Coordinator",
      signer_email: "sales@memorylane.local",
      signer_role: "sender_staff",
      signature_blob: "data:image/png;base64,c2VlZGVkLXNlbmRlci1zaWduYXR1cmU=",
      ip_address: null,
      signed_at: toIsoAt(createdDate, 10, 31),
      created_at: toIsoAt(createdDate, 10, 31),
      updated_at: toIsoAt(createdDate, 10, 31)
    });
    if (packetStatus === "completed" || packetStatus === "filed") {
      enrollmentPacketSignatures.push({
        id: stableUuid(`seed:enrollment-packet-signature:${packetId}:caregiver`),
        packet_id: packetId,
        signer_name: primaryContactName,
        signer_email: caregiverEmail,
        signer_role: "caregiver",
        signature_blob: "data:image/png;base64,c2VlZGVkLWNhcmVnaXZlci1zaWduYXR1cmU=",
        ip_address: "198.51.100.42",
        signed_at: completedAt,
        created_at: completedAt,
        updated_at: completedAt
      });
      enrollmentPacketUploads.push({
        id: stableUuid(`seed:enrollment-packet-upload:${packetId}:completed`),
        packet_id: packetId,
        member_id: member.id,
        file_path: `members/${member.id}/enrollment/${packetId}/completed-packet.pdf`,
        file_name: `enrollment-packet-${packetId.slice(0, 8)}-completed.pdf`,
        file_type: "application/pdf",
        upload_category: "completed_packet",
        member_file_id: completedPacketFileId,
        uploaded_at: completedAt
      });
    }

    enrollmentPacketUploads.push({
      id: stableUuid(`seed:enrollment-packet-upload:${packetId}:insurance`),
      packet_id: packetId,
      member_id: member.id,
      file_path: `members/${member.id}/enrollment/${packetId}/insurance-card.pdf`,
      file_name: `insurance-card-${member.id.slice(0, 8)}.pdf`,
      file_type: "application/pdf",
      upload_category: "insurance",
      member_file_id: insuranceFileId,
      uploaded_at: toIsoAt(addDays(createdDate, 1), 12, 15)
    });
  });

  const memberFiles = (() => {
    const deduped = new Map<string, Record<string, unknown>>();
    [...baseMemberFiles, ...workflowMemberFiles].forEach((row) => {
      const id = cleanText(row.id);
      if (!id) return;
      deduped.set(id, row);
    });
    return [...deduped.values()];
  })();

  return {
    sites: [{ id: SITE_ID, site_code: "SITE-ML-01", site_name: "Memory Lane Main Site", latitude: 34.98, longitude: -80.995, fence_radius_meters: 75 }],
    members: db.members.map((row, idx) => {
      const nameParts = row.display_name.trim().split(/\s+/g);
      const legalFirstName = nameParts.slice(0, -1).join(" ") || nameParts[0] || row.display_name;
      const legalLastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Member";
      const preferredName = nameParts[0] ?? row.display_name;
      return {
        id: row.id,
        display_name: row.display_name,
        status: row.status,
        qr_code: row.qr_code,
        enrollment_date: row.enrollment_date,
        dob: row.dob,
        source_lead_id: salesSeed.memberLeadByMemberId.get(row.id) ?? null,
        discharge_date: row.discharge_date,
        discharge_reason: row.discharge_reason,
        discharge_disposition: row.discharge_disposition,
        locker_number: row.locker_number,
        city: row.city,
        code_status: row.code_status,
        discharged_by: row.discharged_by,
        latest_assessment_id: null,
        latest_assessment_date: row.latest_assessment_date,
        latest_assessment_score: row.latest_assessment_score,
        latest_assessment_track: row.latest_assessment_track,
        latest_assessment_admission_review_required: row.latest_assessment_admission_review_required,
        preferred_name: preferredName,
        legal_first_name: legalFirstName,
        legal_last_name: legalLastName,
        ssn_last4: String(1000 + ((idx * 37) % 8999)).slice(-4)
      };
    }),
    memberLatestAssessmentLinks: db.members.map((row, idx) => {
      const nameParts = row.display_name.trim().split(/\s+/g);
      const legalFirstName = nameParts.slice(0, -1).join(" ") || nameParts[0] || row.display_name;
      const legalLastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "Member";
      const preferredName = nameParts[0] ?? row.display_name;
      return {
        id: row.id,
        display_name: row.display_name,
        status: row.status,
        qr_code: row.qr_code,
        enrollment_date: row.enrollment_date,
        dob: row.dob,
        source_lead_id: salesSeed.memberLeadByMemberId.get(row.id) ?? null,
        discharge_date: row.discharge_date,
        discharge_reason: row.discharge_reason,
        discharge_disposition: row.discharge_disposition,
        locker_number: row.locker_number,
        city: row.city,
        code_status: row.code_status,
        discharged_by: row.discharged_by,
        latest_assessment_id: row.latest_assessment_id ?? null,
        latest_assessment_date: row.latest_assessment_date,
        latest_assessment_score: row.latest_assessment_score,
        latest_assessment_track: row.latest_assessment_track,
        latest_assessment_admission_review_required: row.latest_assessment_admission_review_required,
        preferred_name: preferredName,
        legal_first_name: legalFirstName,
        legal_last_name: legalLastName,
        ssn_last4: String(1000 + ((idx * 37) % 8999)).slice(-4)
      };
    }),
    payPeriods: db.payPeriods.map((row) => ({ id: ensureUuid(row.id, `pay-period:${row.id}`), label: row.label, start_date: row.start_date, end_date: row.end_date, is_closed: row.is_closed })),
    timePunches: db.timePunches.map((row) => ({ id: row.id, staff_user_id: mapStaff(row.staff_user_id), site_id: SITE_ID, punch_type: row.punch_type, punch_at: row.punch_at, ...parseLatLng(row.punch_lat_long), distance_meters: row.distance_meters, within_fence: row.within_fence, note: row.note, created_at: row.punch_at })).filter((row) => row.staff_user_id),
    punches: db.punches
      .map((row) => ({
        id: ensureUuid(row.id, `punch:${row.id}`),
        employee_id: mapStaff(row.employee_id),
        employee_name: row.employee_name,
        timestamp: row.timestamp,
        type: row.type,
        source: row.source,
        status: row.status,
        note: row.note,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        linked_time_punch_id: row.linked_time_punch_id ?? null
      }))
      .filter((row) => row.employee_id)
      .filter((row) => !(row.source === "employee" && Boolean(row.linked_time_punch_id))),
    dailyActivities: db.dailyActivities.map((row) => ({ id: row.id, member_id: row.member_id, activity_date: row.activity_date, staff_user_id: mapStaff(row.staff_user_id), activity_1_level: row.activity_1_level, activity_2_level: row.activity_2_level, activity_3_level: row.activity_3_level, activity_4_level: row.activity_4_level, activity_5_level: row.activity_5_level, notes: row.notes, created_at: row.created_at })).filter((row) => row.staff_user_id),
    toiletLogs: db.toiletLogs.map((row) => ({ id: row.id, member_id: row.member_id, event_at: row.event_at, created_at: row.event_at, briefs: row.briefs, member_supplied: row.member_supplied, use_type: row.use_type, staff_user_id: mapStaff(row.staff_user_id), notes: row.notes })).filter((row) => row.staff_user_id),
    showerLogs: db.showerLogs.map((row) => ({ id: row.id, member_id: row.member_id, event_at: row.event_at, created_at: row.event_at, laundry: row.laundry, briefs: row.briefs, staff_user_id: mapStaff(row.staff_user_id) })).filter((row) => row.staff_user_id),
    transportLogs: billing.transportationLogs
      .map((row) => ({
        id: row.id,
        member_id: row.member_id,
        first_name: row.first_name,
        period: row.period,
        transport_type: row.transport_type,
        service_date: row.service_date,
        staff_user_id: mapStaff(row.staff_user_id),
        created_at: row.timestamp,
        trip_type: row.trip_type ?? null,
        quantity: row.quantity ?? 1,
        unit_rate: row.unit_rate ?? 0,
        total_amount: row.total_amount ?? 0,
        billable: row.billable ?? true,
        billing_status: row.billing_status ?? "Unbilled",
        billing_exclusion_reason: row.billing_exclusion_reason ?? null,
        invoice_id: null,
        updated_at: row.timestamp
      }))
      .filter((row) => row.staff_user_id),
    bloodSugar: db.bloodSugarLogs.map((row) => ({ id: row.id, member_id: row.member_id, checked_at: row.checked_at, reading_mg_dl: row.reading_mg_dl, nurse_user_id: mapStaff(row.nurse_user_id), notes: row.notes })),
    photos: db.photoUploads.map((row) => ({ id: row.id, member_id: row.member_id, photo_url: row.photo_url, uploaded_by: mapStaff(row.uploaded_by), uploaded_at: row.uploaded_at })).filter((row) => row.uploaded_by),
    ancillaryCategories: db.ancillaryCategories.map((row) => ({ id: row.id, name: row.name, price_cents: row.price_cents, active: true })),
    ancillaryLogs: billing.ancillaryLogs
      .map((row) => ({
        id: row.id,
        member_id: row.member_id,
        category_id: row.category_id,
        service_date: row.service_date,
        late_pickup_time: row.late_pickup_time,
        staff_user_id: mapStaff(row.staff_user_id),
        notes: row.notes,
        created_at: row.created_at,
        reconciliation_status: row.reconciliation_status,
        reconciled_by: row.reconciled_by,
        reconciled_at: row.reconciled_at,
        reconciliation_note: row.reconciliation_note,
        quantity: row.quantity ?? 1,
        unit_rate: row.unit_rate ?? Number((row.amount_cents / 100).toFixed(2)),
        amount: row.total_amount ?? Number((row.amount_cents / 100).toFixed(2)),
        billing_status: row.billing_status ?? "Unbilled",
        billing_exclusion_reason: row.billing_exclusion_reason ?? null,
        invoice_id: null,
        updated_at: row.created_at
      }))
      .filter((row) => row.staff_user_id),
    enrollmentPricingCommunityFees,
    enrollmentPricingDailyRates,
    timePunchExceptions: derived.timePunchExceptions,
    dailyTimecards: derived.dailyTimecards,
    forgottenPunchRequests: derived.forgottenPunchRequests,
    ptoEntries: derived.ptoEntries,
    documentationTracker: derived.documentationTracker,
    documentationAssignments: derived.documentationAssignments,
    documentationEvents: derived.documentationEvents,
    marEntries: derived.marEntries,
    pofRequests,
    pofSignatures,
    pofDocumentEvents,
    pofMedications,
    marSchedules,
    marAdministrations,
    partners: partnerRows,
    referrals: referralRows,
    leads: salesSeed.leads.map((row) => ({ id: row.id, status: normalizeLeadStatus(String(row.status)), stage: row.stage, stage_updated_at: row.stage_updated_at, inquiry_date: row.inquiry_date, tour_date: row.tour_date, tour_completed: row.tour_completed, discovery_date: row.discovery_date, member_start_date: row.member_start_date, caregiver_name: row.caregiver_name, caregiver_relationship: row.caregiver_relationship, caregiver_email: row.caregiver_email, caregiver_phone: row.caregiver_phone, member_name: row.member_name, member_dob: row.member_dob, lead_source: row.lead_source, lead_source_other: row.lead_source_other, referral_name: row.referral_name, likelihood: row.likelihood, next_follow_up_date: row.next_follow_up_date, next_follow_up_type: row.next_follow_up_type, notes_summary: row.notes_summary, lost_reason: row.lost_reason, closed_date: row.closed_date, partner_id: row.partner_id, referral_source_id: row.referral_source_id, created_by_user_id: mapStaff(row.created_by_user_id), created_by_name: row.created_by_name, created_at: row.created_at, updated_at: row.created_at })),
    leadActivities: salesSeed.leadActivities.map((row) => ({ id: row.id, lead_id: row.lead_id, member_name: row.member_name, activity_at: row.activity_at, activity_type: row.activity_type, outcome: row.outcome, lost_reason: row.lost_reason, notes: row.notes, next_follow_up_date: row.next_follow_up_date, next_follow_up_type: row.next_follow_up_type, completed_by_user_id: mapStaff(row.completed_by_user_id), completed_by_name: row.completed_by_name, partner_id: row.partner_id, referral_source_id: row.referral_source_id })),
    partnerActivities: salesSeed.partnerActivities.map((row) => ({
      id: row.id,
      referral_source_id: row.referral_source_id ? (referralByExternalId.get(row.referral_source_id) ?? null) : null,
      partner_id: row.partner_id ? (partnerByExternalId.get(row.partner_id) ?? null) : null,
      organization_name: row.organization_name,
      contact_name: row.contact_name,
      activity_at: row.activity_at,
      activity_type: row.activity_type,
      notes: row.notes,
      completed_by: row.completed_by,
      completed_by_user_id: mapStaff(row.completed_by_user_id),
      next_follow_up_date: row.next_follow_up_date,
      next_follow_up_type: row.next_follow_up_type,
      last_touched: row.last_touched,
      lead_id: row.lead_id
    })),
    stageHistory: salesSeed.leadStageHistory.map((row) => ({ id: row.id, lead_id: row.lead_id, from_stage: row.from_stage, to_stage: row.to_stage, from_status: String(row.from_status ?? "").toLowerCase() || null, to_status: String(row.to_status).toLowerCase(), changed_by_user_id: mapStaff(row.changed_by_user_id), changed_by_name: row.changed_by_name, reason: row.reason, source: row.source, changed_at: row.changed_at, created_at: row.changed_at })),
    enrollmentPacketRequests,
    enrollmentPacketFields,
    enrollmentPacketEvents,
    enrollmentPacketSignatures,
    enrollmentPacketSenderSignatures,
    enrollmentPacketUploads,
    userNotifications,
    intakeAssessments,
    intakeAssessmentSignatures,
    assessmentResponses: db.assessmentResponses.map((row) => ({ id: row.id, assessment_id: row.assessment_id, member_id: row.member_id, field_key: row.field_key, field_label: row.field_label, section_type: row.section_type, field_value: row.field_value, field_value_type: row.field_value_type, created_at: row.created_at })),
    physicianOrders: intake.pofRows,
    memberHealthProfiles: intake.mhpRows,
    memberHolds: db.memberHolds.map((row) => ({ ...row, created_by_user_id: mapStaff(row.created_by_user_id), ended_by_user_id: mapStaff(row.ended_by_user_id) })),
    attendanceRecords: db.attendanceRecords.map((row) => ({
      id: ensureUuid(row.id, `attendance-record:${row.id}`),
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      attendance_date: row.attendance_date,
      status: row.status,
      absent_reason: row.absent_reason,
      absent_reason_other: row.absent_reason_other,
      check_in_at: row.check_in_at,
      check_out_at: row.check_out_at,
      notes: row.notes,
      recorded_by_user_id: mapStaff(row.recorded_by_user_id),
      recorded_by_name: row.recorded_by_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      scheduled_day: row.scheduled_day ?? null,
      unscheduled_day: row.unscheduled_day ?? null,
      billable_extra_day: row.billable_extra_day ?? null,
      billing_status: row.billing_status ?? null,
      linked_adjustment_id: row.linked_adjustment_id ?? null
    })),
    memberCommandCenters: db.memberCommandCenters.map((row) => ({
      ...row,
      source_assessment_id: null,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    memberCommandCenterAssessmentLinks: db.memberCommandCenters.map((row) => ({
      ...row,
      source_assessment_id: row.source_assessment_id ?? null,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    memberAttendanceSchedules: db.memberAttendanceSchedules.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    memberContacts: db.memberContacts.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberFiles,
    busStopDirectory: db.busStopDirectory.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    transportationManifestAdjustments: db.transportationManifestAdjustments.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    scheduleChanges,
    memberAllergies: db.memberAllergies.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    payors: db.payors.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    memberBillingSettings: db.memberBillingSettings.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    billingScheduleTemplates: db.billingScheduleTemplates.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    centerBillingSettings: db.centerBillingSettings.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    closureRules: db.closureRules.map((row) => ({
      ...row,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    centerClosures: db.centerClosures.map((row) => ({
      ...row,
      closure_rule_id: row.closure_rule_id ? ensureUuid(row.closure_rule_id, `closure-rule:${row.closure_rule_id}`) : null,
      updated_by_user_id: mapStaff(row.updated_by_user_id)
    })),
    billingBatches: billing.billingBatches,
    billingInvoices: billing.billingInvoices,
    billingInvoiceLines: billing.billingInvoiceLines,
    billingAdjustments: billing.billingAdjustments,
    billingCoverages: billing.billingCoverages,
    billingExportJobs: billing.billingExportJobs,
    carePlans: carePlans.carePlans,
    carePlanSections: carePlans.carePlanSections,
    carePlanVersions: carePlans.carePlanVersions,
    carePlanReviewHistory: carePlans.carePlanReviewHistory,
    memberDiagnoses: db.memberDiagnoses.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberMedications: db.memberMedications.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberProviders: db.memberProviders.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    providerDirectory: db.providerDirectory.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    hospitalPreferenceDirectory: db.hospitalPreferenceDirectory.map((row) => ({
      ...row,
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberEquipment: db.memberEquipment.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    })),
    memberNotes: db.memberNotes.map((row) => ({
      ...row,
      member_id: ensureUuid(row.member_id, `member:${row.member_id}`),
      created_by_user_id: mapStaff(row.created_by_user_id)
    }))
  };
}

type SeedValidationSummary = {
  totalLeads: number;
  totalMembers: number;
  convertedLeads: number;
  stageCounts: Map<string, number>;
  moduleCounts: Array<{ label: string; count: number }>;
  missing: Array<{ label: string; count: number; samples: string[] }>;
};

function buildIdSet(rows: Array<Record<string, unknown>>, key: string) {
  return new Set(rows.map((row) => cleanText(row[key])).filter((value): value is string => Boolean(value)));
}

function buildSeedValidationSummary(rows: ReturnType<typeof buildRows>): SeedValidationSummary {
  const members = rows.members as Array<{ id: string; display_name: string; status: string; source_lead_id?: string | null }>;
  const leads = rows.leads as Array<{ id: string; stage: string }>;

  const stageCounts = new Map<string, number>();
  leads.forEach((row) => stageCounts.set(row.stage, (stageCounts.get(row.stage) ?? 0) + 1));

  const convertedLeadIds = new Set(
    members.map((row) => cleanText(row.source_lead_id)).filter((value): value is string => Boolean(value))
  );
  const convertedLeads = leads.filter((row) => convertedLeadIds.has(row.id)).length;

  const activeMembers = members.filter((row) => row.status === "active");
  const commandCenterMemberIds = buildIdSet(rows.memberCommandCenters as Array<Record<string, unknown>>, "member_id");
  const scheduleMemberIds = buildIdSet(rows.memberAttendanceSchedules as Array<Record<string, unknown>>, "member_id");
  const contactMemberIds = buildIdSet(rows.memberContacts as Array<Record<string, unknown>>, "member_id");
  const fileMemberIds = buildIdSet(rows.memberFiles as Array<Record<string, unknown>>, "member_id");
  const intakeMemberIds = buildIdSet(rows.intakeAssessments as Array<Record<string, unknown>>, "member_id");
  const intakeSignedMemberIds = buildIdSet(rows.intakeAssessmentSignatures as Array<Record<string, unknown>>, "member_id");
  const pofMemberIds = buildIdSet(rows.physicianOrders as Array<Record<string, unknown>>, "member_id");
  const pofRequestMemberIds = buildIdSet(rows.pofRequests as Array<Record<string, unknown>>, "member_id");
  const pofMedicationMemberIds = buildIdSet(rows.pofMedications as Array<Record<string, unknown>>, "member_id");
  const marScheduleMemberIds = buildIdSet(rows.marSchedules as Array<Record<string, unknown>>, "member_id");
  const marAdministrationMemberIds = buildIdSet(rows.marAdministrations as Array<Record<string, unknown>>, "member_id");
  const mhpMemberIds = buildIdSet(rows.memberHealthProfiles as Array<Record<string, unknown>>, "member_id");
  const carePlanMemberIds = buildIdSet(rows.carePlans as Array<Record<string, unknown>>, "member_id");
  const enrollmentPacketMemberIds = buildIdSet(rows.enrollmentPacketRequests as Array<Record<string, unknown>>, "member_id");

  const leadActivityLeadIds = buildIdSet(rows.leadActivities as Array<Record<string, unknown>>, "lead_id");
  const leadHistoryLeadIds = buildIdSet(rows.stageHistory as Array<Record<string, unknown>>, "lead_id");

  const missingForMembers = (label: string, memberIdSet: Set<string>, scope: Array<{ id: string; display_name: string }>) => {
    const missing = scope.filter((row) => !memberIdSet.has(row.id));
    return {
      label,
      count: missing.length,
      samples: missing.slice(0, 4).map((row) => row.display_name)
    };
  };

  const missingForLeads = (label: string, leadIdSet: Set<string>) => {
    const missing = leads.filter((row) => !leadIdSet.has(row.id));
    return {
      label,
      count: missing.length,
      samples: missing.slice(0, 4).map((row) => row.stage)
    };
  };

  const moduleCounts: Array<{ label: string; count: number }> = [
    { label: "intake_assessments", count: rows.intakeAssessments.length },
    { label: "intake_assessment_signatures", count: rows.intakeAssessmentSignatures.length },
    { label: "physician_orders", count: rows.physicianOrders.length },
    { label: "pof_requests", count: rows.pofRequests.length },
    { label: "pof_medications", count: rows.pofMedications.length },
    { label: "mar_schedules", count: rows.marSchedules.length },
    { label: "mar_administrations", count: rows.marAdministrations.length },
    { label: "member_health_profiles", count: rows.memberHealthProfiles.length },
    { label: "care_plans", count: rows.carePlans.length },
    { label: "member_diagnoses", count: rows.memberDiagnoses.length },
    { label: "member_medications", count: rows.memberMedications.length },
    { label: "member_allergies", count: rows.memberAllergies.length },
    { label: "lead_activities", count: rows.leadActivities.length },
    { label: "lead_stage_history", count: rows.stageHistory.length },
    { label: "member_attendance_schedules", count: rows.memberAttendanceSchedules.length },
    { label: "attendance_records", count: rows.attendanceRecords.length },
    { label: "member_contacts", count: rows.memberContacts.length },
    { label: "member_files", count: rows.memberFiles.length },
    { label: "member_command_centers", count: rows.memberCommandCenters.length },
    { label: "enrollment_packet_requests", count: rows.enrollmentPacketRequests.length },
    { label: "enrollment_packet_uploads", count: rows.enrollmentPacketUploads.length },
    { label: "user_notifications", count: rows.userNotifications.length },
    { label: "member_billing_settings", count: rows.memberBillingSettings.length },
    { label: "billing_invoices", count: rows.billingInvoices.length }
  ];

  const missing = [
    missingForMembers("members_missing_command_center", commandCenterMemberIds, members),
    missingForMembers("members_missing_schedule", scheduleMemberIds, activeMembers),
    missingForMembers("members_missing_contacts", contactMemberIds, members),
    missingForMembers("members_missing_files", fileMemberIds, members),
    missingForMembers("members_missing_intake_assessment", intakeMemberIds, members),
    missingForMembers("members_missing_intake_signature", intakeSignedMemberIds, activeMembers),
    missingForMembers("members_missing_physician_order", pofMemberIds, members),
    missingForMembers("members_missing_pof_request", pofRequestMemberIds, activeMembers),
    missingForMembers("members_missing_pof_medications", pofMedicationMemberIds, activeMembers),
    missingForMembers("members_missing_mar_schedule", marScheduleMemberIds, activeMembers),
    missingForMembers("members_missing_mar_administration", marAdministrationMemberIds, activeMembers),
    missingForMembers("members_missing_member_health_profile", mhpMemberIds, members),
    missingForMembers("active_members_missing_care_plan", carePlanMemberIds, activeMembers),
    missingForMembers("members_missing_enrollment_packet", enrollmentPacketMemberIds, activeMembers),
    missingForLeads("leads_missing_activity_history", leadActivityLeadIds),
    missingForLeads("leads_missing_stage_history", leadHistoryLeadIds)
  ];

  return {
    totalLeads: leads.length,
    totalMembers: members.length,
    convertedLeads,
    stageCounts,
    moduleCounts,
    missing
  };
}

function printSeedValidationSummary(summary: SeedValidationSummary) {
  console.log("validation:seeded_leads=" + summary.totalLeads);
  console.log("validation:seeded_members=" + summary.totalMembers);
  console.log("validation:converted_leads=" + summary.convertedLeads);
  [...summary.stageCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([stage, count]) => console.log(`validation:lead_stage:${stage}=${count}`));
  summary.moduleCounts.forEach((entry) => console.log(`validation:${entry.label}=${entry.count}`));
  const missingCounts = summary.missing.filter((entry) => entry.count > 0);
  if (missingCounts.length === 0) {
    console.log("validation:missing_relationships=none");
    return;
  }
  missingCounts.forEach((entry) => {
    const sampleSuffix = entry.samples.length > 0 ? ` sample=[${entry.samples.join(", ")}]` : "";
    console.log(`validation:${entry.label}=${entry.count}${sampleSuffix}`);
  });
}

type SeedLeadIdentityRow = {
  id: string;
  stage: string;
  memberName: string;
  memberDob: string | null;
  inquiryDate: string | null;
  projectedStartDate: string | null;
};

function cleanText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isIntakeSeedStage(stage: string) {
  return stage === "Tour" || stage === "Enrollment in Progress";
}

function toSeedLeadIdentityRow(row: Record<string, unknown>): SeedLeadIdentityRow | null {
  const id = cleanText(row.id);
  if (!id) return null;
  const stage = cleanText(row.stage);
  if (!stage) return null;
  const memberName = cleanText(row.member_name) ?? "Seed Intake Member";
  return {
    id,
    stage,
    memberName,
    memberDob: asDateOnly(cleanText(row.member_dob)),
    inquiryDate: asDateOnly(cleanText(row.inquiry_date)),
    projectedStartDate: asDateOnly(cleanText(row.member_start_date))
  };
}

async function ensureIntakeReadySeedMembers(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  options: {
    existingTables: Map<string, boolean>;
    leads: Record<string, unknown>[];
  }
) {
  if (options.existingTables.get("members") === false || options.existingTables.get("leads") === false) {
    return { intakeLeadCount: 0, alreadyLinkedCount: 0, upsertedCount: 0 };
  }

  const intakeLeads = options.leads
    .map((row) => toSeedLeadIdentityRow(row))
    .filter((row): row is SeedLeadIdentityRow => Boolean(row))
    .filter((row) => isIntakeSeedStage(row.stage));
  if (intakeLeads.length === 0) {
    return { intakeLeadCount: 0, alreadyLinkedCount: 0, upsertedCount: 0 };
  }

  const leadIds = intakeLeads.map((lead) => lead.id);
  const { data: linkedRows, error: linkedRowsError } = await supabase
    .from("members")
    .select("id, source_lead_id")
    .in("source_lead_id", leadIds);
  if (linkedRowsError) {
    throw new Error(`Seed intake member-link lookup failed: ${linkedRowsError.message}`);
  }
  const linkedLeadIds = new Set(
    (linkedRows ?? [])
      .map((row) => cleanText((row as { source_lead_id?: string | null }).source_lead_id))
      .filter((value): value is string => Boolean(value))
  );

  const memberRowsToUpsert = intakeLeads
    .filter((lead) => !linkedLeadIds.has(lead.id))
    .map((lead) => {
      const enrollmentDate = lead.projectedStartDate ?? lead.inquiryDate ?? null;
      const syntheticMemberId = stableUuid(`seed:intake-linked-member:${lead.id}`);
      return {
        id: syntheticMemberId,
        display_name: lead.memberName,
        status: "active",
        enrollment_date: enrollmentDate,
        dob: lead.memberDob,
        source_lead_id: lead.id,
        qr_code: `QR-${syntheticMemberId.slice(0, 8).toUpperCase()}`
      };
    });

  if (memberRowsToUpsert.length === 0) {
    return {
      intakeLeadCount: intakeLeads.length,
      alreadyLinkedCount: linkedLeadIds.size,
      upsertedCount: 0
    };
  }

  const upsertedCount = await upsertRows(
    supabase,
    "members",
    memberRowsToUpsert as Record<string, unknown>[],
    options.existingTables
  );
  return {
    intakeLeadCount: intakeLeads.length,
    alreadyLinkedCount: linkedLeadIds.size,
    upsertedCount
  };
}

async function resetForModules(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  modules: SeedModule[],
  existingTables: Map<string, boolean>
) {
  const tables = new Set<string>();
  if (modules.includes("sales"))
    [
      "lead_stage_history",
      "lead_activities",
      "partner_activities",
      "leads",
      "referral_sources",
      "community_partner_organizations",
      "enrollment_packet_uploads",
      "enrollment_packet_signatures",
      "enrollment_packet_events",
      "enrollment_packet_fields",
      "enrollment_packet_requests",
      "enrollment_packet_sender_signatures",
      "user_notifications",
      "enrollment_pricing_daily_rates",
      "enrollment_pricing_community_fees"
    ].forEach((t) => tables.add(t));
  if (modules.includes("intake"))
    [
      "care_plan_review_history",
      "care_plan_versions",
      "care_plan_sections",
      "care_plans",
      "member_notes",
      "member_equipment",
      "hospital_preference_directory",
      "provider_directory",
      "member_providers",
      "member_medications",
      "member_diagnoses",
      "member_health_profiles",
      "physician_orders",
      "pof_signatures",
      "document_events",
      "pof_requests",
      "pof_medications",
      "mar_schedules",
      "mar_administrations",
      "assessment_responses",
      "intake_assessments",
      "intake_assessment_signatures",
      "mar_entries"
    ].forEach((t) => tables.add(t));
  if (modules.includes("attendance"))
    [
      "attendance_records",
      "center_closures",
      "closure_rules",
      "transportation_manifest_adjustments",
      "member_files",
      "member_contacts",
      "member_allergies",
      "member_attendance_schedules",
      "member_command_centers",
      "member_billing_settings",
      "billing_schedule_templates",
      "payors",
      "center_billing_settings",
      "member_holds",
      "schedule_changes",
      "ancillary_charge_logs",
      "ancillary_charge_categories",
      "billing_coverages",
      "billing_invoice_lines",
      "billing_adjustments",
      "billing_invoices",
      "billing_export_jobs",
      "billing_batches",
      "documentation_events",
      "documentation_assignments",
      "documentation_tracker",
      "member_photo_uploads",
      "blood_sugar_logs",
      "transportation_logs",
      "shower_logs",
      "toilet_logs",
      "daily_activity_logs",
      "time_punch_exceptions",
      "daily_timecards",
      "forgotten_punch_requests",
      "pto_entries",
      "punches",
      "time_punches",
      "pay_periods",
      "bus_stop_directory",
      "members",
      "sites"
    ].forEach((t) => tables.add(t));
  const order = [
    "enrollment_packet_uploads",
    "enrollment_packet_signatures",
    "enrollment_packet_events",
    "enrollment_packet_fields",
    "enrollment_packet_requests",
    "enrollment_packet_sender_signatures",
    "user_notifications",
    "pof_signatures",
    "document_events",
    "pof_requests",
    "mar_administrations",
    "mar_schedules",
    "pof_medications",
    "intake_assessment_signatures",
    "lead_stage_history",
    "lead_activities",
    "partner_activities",
    "enrollment_pricing_daily_rates",
    "enrollment_pricing_community_fees",
    "billing_coverages",
    "billing_invoice_lines",
    "billing_adjustments",
    "billing_invoices",
    "billing_export_jobs",
    "billing_batches",
    "care_plan_review_history",
    "care_plan_versions",
    "care_plan_sections",
    "care_plans",
    "center_closures",
    "closure_rules",
    "schedule_changes",
    "transportation_manifest_adjustments",
    "member_files",
    "member_contacts",
    "member_allergies",
    "member_attendance_schedules",
    "member_command_centers",
    "member_billing_settings",
    "billing_schedule_templates",
    "attendance_records",
    "member_holds",
    "member_notes",
    "member_equipment",
    "member_providers",
    "member_medications",
    "member_diagnoses",
    "hospital_preference_directory",
    "provider_directory",
    "member_health_profiles",
    "physician_orders",
    "assessment_responses",
    "intake_assessments",
    "documentation_events",
    "documentation_assignments",
    "documentation_tracker",
    "mar_entries",
    "ancillary_charge_logs",
    "ancillary_charge_categories",
    "member_photo_uploads",
    "blood_sugar_logs",
    "transportation_logs",
    "shower_logs",
    "toilet_logs",
    "daily_activity_logs",
    "time_punch_exceptions",
    "daily_timecards",
    "forgotten_punch_requests",
    "pto_entries",
    "punches",
    "time_punches",
    "pay_periods",
    "leads",
    "referral_sources",
    "community_partner_organizations",
    "payors",
    "center_billing_settings",
    "bus_stop_directory",
    "members",
    "sites"
  ];
  for (const table of order.filter((t) => tables.has(t))) await deleteRows(supabase, table, existingTables);
}

async function main() {
  loadEnvFiles();
  const parsed = parseArgs(process.argv.slice(2));
  assertSafeEnvironment(parsed.reset);
  const db = buildSeededMockDb();
  const supabase = createSupabaseAdminClient();
  const staffMap = await ensureAuthProfiles(supabase, db);
  const rows = buildRows(db, staffMap);

  const workload: Array<{ table: string; rows: Record<string, unknown>[]; module: SeedModule | "core"; legacy?: boolean }> = [
    { table: "sites", rows: rows.sites, module: "core" },
    { table: "leads", rows: rows.leads, module: "core" },
    { table: "members", rows: rows.members, module: "core" },
    { table: "pay_periods", rows: rows.payPeriods, module: "attendance" },
    { table: "time_punches", rows: rows.timePunches, module: "attendance" },
    { table: "time_punch_exceptions", rows: rows.timePunchExceptions, module: "attendance", legacy: true },
    { table: "punches", rows: rows.punches, module: "attendance" },
    { table: "daily_timecards", rows: rows.dailyTimecards, module: "attendance", legacy: true },
    { table: "forgotten_punch_requests", rows: rows.forgottenPunchRequests, module: "attendance", legacy: true },
    { table: "pto_entries", rows: rows.ptoEntries, module: "attendance", legacy: true },
    { table: "daily_activity_logs", rows: rows.dailyActivities, module: "attendance" },
    { table: "toilet_logs", rows: rows.toiletLogs, module: "attendance" },
    { table: "shower_logs", rows: rows.showerLogs, module: "attendance" },
    { table: "transportation_logs", rows: rows.transportLogs, module: "attendance" },
    { table: "blood_sugar_logs", rows: rows.bloodSugar, module: "attendance" },
    { table: "mar_entries", rows: rows.marEntries, module: "intake", legacy: true },
    { table: "member_photo_uploads", rows: rows.photos, module: "attendance" },
    { table: "ancillary_charge_categories", rows: rows.ancillaryCategories, module: "attendance" },
    { table: "ancillary_charge_logs", rows: rows.ancillaryLogs, module: "attendance" },
    { table: "documentation_events", rows: rows.documentationEvents, module: "attendance", legacy: true },
    { table: "documentation_tracker", rows: rows.documentationTracker, module: "attendance", legacy: true },
    { table: "documentation_assignments", rows: rows.documentationAssignments, module: "attendance", legacy: true },
    { table: "attendance_records", rows: rows.attendanceRecords, module: "attendance", legacy: true },
    { table: "payors", rows: rows.payors, module: "attendance", legacy: true },
    { table: "center_billing_settings", rows: rows.centerBillingSettings, module: "attendance", legacy: true },
    { table: "closure_rules", rows: rows.closureRules, module: "attendance", legacy: true },
    { table: "center_closures", rows: rows.centerClosures, module: "attendance", legacy: true },
    { table: "member_holds", rows: rows.memberHolds, module: "attendance" },
    { table: "schedule_changes", rows: rows.scheduleChanges, module: "attendance" },
    { table: "member_command_centers", rows: rows.memberCommandCenters, module: "attendance", legacy: true },
    { table: "member_attendance_schedules", rows: rows.memberAttendanceSchedules, module: "attendance", legacy: true },
    { table: "member_contacts", rows: rows.memberContacts, module: "attendance", legacy: true },
    { table: "member_files", rows: rows.memberFiles, module: "attendance", legacy: true },
    { table: "bus_stop_directory", rows: rows.busStopDirectory, module: "attendance", legacy: true },
    { table: "transportation_manifest_adjustments", rows: rows.transportationManifestAdjustments, module: "attendance", legacy: true },
    { table: "member_allergies", rows: rows.memberAllergies, module: "attendance", legacy: true },
    { table: "member_billing_settings", rows: rows.memberBillingSettings, module: "attendance", legacy: true },
    { table: "billing_schedule_templates", rows: rows.billingScheduleTemplates, module: "attendance", legacy: true },
    { table: "billing_batches", rows: rows.billingBatches, module: "attendance" },
    { table: "billing_invoices", rows: rows.billingInvoices, module: "attendance" },
    { table: "billing_invoice_lines", rows: rows.billingInvoiceLines, module: "attendance" },
    { table: "billing_adjustments", rows: rows.billingAdjustments, module: "attendance" },
    { table: "billing_coverages", rows: rows.billingCoverages, module: "attendance" },
    { table: "billing_export_jobs", rows: rows.billingExportJobs, module: "attendance" },
    { table: "enrollment_pricing_community_fees", rows: rows.enrollmentPricingCommunityFees, module: "sales" },
    { table: "enrollment_pricing_daily_rates", rows: rows.enrollmentPricingDailyRates, module: "sales" },
    { table: "community_partner_organizations", rows: rows.partners, module: "sales" },
    { table: "referral_sources", rows: rows.referrals, module: "sales" },
    { table: "lead_activities", rows: rows.leadActivities, module: "sales" },
    { table: "partner_activities", rows: rows.partnerActivities, module: "sales" },
    { table: "lead_stage_history", rows: rows.stageHistory, module: "sales" },
    { table: "enrollment_packet_requests", rows: rows.enrollmentPacketRequests, module: "sales" },
    { table: "enrollment_packet_fields", rows: rows.enrollmentPacketFields, module: "sales" },
    { table: "enrollment_packet_events", rows: rows.enrollmentPacketEvents, module: "sales" },
    { table: "enrollment_packet_signatures", rows: rows.enrollmentPacketSignatures, module: "sales" },
    { table: "enrollment_packet_sender_signatures", rows: rows.enrollmentPacketSenderSignatures, module: "sales" },
    { table: "enrollment_packet_uploads", rows: rows.enrollmentPacketUploads, module: "sales" },
    { table: "user_notifications", rows: rows.userNotifications, module: "sales" },
    { table: "intake_assessments", rows: rows.intakeAssessments, module: "intake" },
    { table: "intake_assessment_signatures", rows: rows.intakeAssessmentSignatures, module: "intake" },
    { table: "assessment_responses", rows: rows.assessmentResponses, module: "intake" },
    { table: "members", rows: rows.memberLatestAssessmentLinks, module: "intake", legacy: true },
    { table: "member_command_centers", rows: rows.memberCommandCenterAssessmentLinks, module: "intake", legacy: true },
    { table: "physician_orders", rows: rows.physicianOrders, module: "intake" },
    { table: "pof_requests", rows: rows.pofRequests, module: "intake" },
    { table: "pof_signatures", rows: rows.pofSignatures, module: "intake" },
    { table: "document_events", rows: rows.pofDocumentEvents, module: "intake" },
    { table: "pof_medications", rows: rows.pofMedications, module: "intake" },
    { table: "mar_schedules", rows: rows.marSchedules, module: "intake" },
    { table: "mar_administrations", rows: rows.marAdministrations, module: "intake" },
    { table: "member_health_profiles", rows: rows.memberHealthProfiles, module: "intake" },
    { table: "care_plans", rows: rows.carePlans, module: "intake" },
    { table: "care_plan_sections", rows: rows.carePlanSections, module: "intake" },
    { table: "care_plan_versions", rows: rows.carePlanVersions, module: "intake" },
    { table: "care_plan_review_history", rows: rows.carePlanReviewHistory, module: "intake" },
    { table: "member_diagnoses", rows: rows.memberDiagnoses, module: "intake", legacy: true },
    { table: "member_medications", rows: rows.memberMedications, module: "intake", legacy: true },
    { table: "member_providers", rows: rows.memberProviders, module: "intake", legacy: true },
    { table: "provider_directory", rows: rows.providerDirectory, module: "intake", legacy: true },
    { table: "hospital_preference_directory", rows: rows.hospitalPreferenceDirectory, module: "intake", legacy: true },
    { table: "member_equipment", rows: rows.memberEquipment, module: "intake", legacy: true },
    { table: "member_notes", rows: rows.memberNotes, module: "intake", legacy: true }
  ];
  const existingTables = await discoverExistingTables(
    supabase,
    workload.map((entry) => entry.table)
  );
  if (parsed.reset) await resetForModules(supabase, parsed.modules, existingTables);

  const selected = workload.filter((entry) => {
    const inModuleScope = entry.module === "core" || parsed.modules.includes(entry.module);
    if (!inModuleScope) return false;
    if (!parsed.legacyOnly) return true;
    return entry.module === "core" || entry.legacy === true || LEGACY_DEPENDENCY_TABLES.has(entry.table);
  });
  const tableCounts = new Map<string, number>();
  const moduleCounts = new Map<string, number>();
  for (const item of selected) {
    let inserted = 0;
    try {
      inserted = await upsertRows(supabase, item.table, item.rows, existingTables);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const triggerConflictMessage = "no unique or exclusion constraint matching the ON CONFLICT specification";
      if (item.table === "time_punches" && message.includes(triggerConflictMessage)) {
        throw new Error(
          "Seeding time_punches failed because payroll canonical sync prerequisites are missing. Apply migrations 0009_payroll_canonical_sync.sql and 0017_reseed_schema_alignment.sql, then rerun seed."
        );
      }
      if (message.includes('record "new" has no field "created_at"')) {
        throw new Error(
          `Seeding ${item.table} failed because the documentation trigger expects created_at. Apply migration 0017_reseed_schema_alignment.sql and rerun seed.`
        );
      }
      throw error;
    }
    tableCounts.set(item.table, inserted);
    const moduleKey = item.module;
    moduleCounts.set(moduleKey, (moduleCounts.get(moduleKey) ?? 0) + inserted);
  }

  if (!parsed.legacyOnly && parsed.modules.includes("intake")) {
    const intakeSeedMemberLinks = await ensureIntakeReadySeedMembers(supabase, {
      existingTables,
      leads: rows.leads
    });
    console.log(
      `intake_seed_member_links: intake_leads=${intakeSeedMemberLinks.intakeLeadCount} already_linked=${intakeSeedMemberLinks.alreadyLinkedCount} upserted=${intakeSeedMemberLinks.upsertedCount}`
    );
  }

  if (!parsed.skipRpcPass) {
    await applySeedRpcPass(supabase, rows, staffMap, {
      modules: parsed.modules,
      legacyOnly: parsed.legacyOnly
    });
  } else {
    console.log("rpc_seed_pass: skipped=flag");
  }

  console.log("Supabase seed complete.");
  console.log(`Modules: ${parsed.modules.join(", ")}`);
  console.log(`Legacy only: ${parsed.legacyOnly ? "yes" : "no"}`);
  console.log(`RPC pass: ${parsed.skipRpcPass ? "skipped" : "applied"}`);
  console.log(`Reset: ${parsed.reset ? "yes" : "no"}`);
  selected.forEach((item) => console.log(`${item.table}: ${tableCounts.get(item.table) ?? 0}`));
  for (const [module, count] of moduleCounts.entries()) {
    console.log(`module:${module}: ${count}`);
  }
  printSeedValidationSummary(buildSeedValidationSummary(rows));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
