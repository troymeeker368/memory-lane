import { normalizeRoleKey } from "@/lib/permissions";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { createClient } from "@/lib/supabase/server";
import { getPublicAppUrl } from "@/lib/runtime";
import { buildStaffAuthEmailTemplate } from "@/lib/email/templates/staff-auth";
import { buildDocumentCenterSenderHeader } from "@/lib/services/document-branding";
import { toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";
import type { Database } from "@/types/supabase-types";

export type StaffAuthStatus = "invited" | "active" | "disabled";
export type StaffAuthEventType =
  | "invite_sent"
  | "invite_resent"
  | "password_set"
  | "password_reset_requested"
  | "password_reset_completed"
  | "login_disabled"
  | "login_enabled";

export interface StaffAuthProfile {
  id: string;
  authUserId: string;
  email: string;
  fullName: string;
  role: AppRole;
  active: boolean;
  isActive: boolean;
  status: StaffAuthStatus;
  invitedAt: string | null;
  passwordSetAt: string | null;
  lastSignInAt: string | null;
  disabledAt: string | null;
}

type SendInviteMode = "invite_sent" | "invite_resent";
type StaffAuthEmailMode = "set-password" | "reset-password";
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type StaffAuthProfileRow = Pick<
  ProfileRow,
  | "id"
  | "auth_user_id"
  | "email"
  | "full_name"
  | "role"
  | "active"
  | "is_active"
  | "status"
  | "invited_at"
  | "password_set_at"
  | "last_sign_in_at"
  | "disabled_at"
>;

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: string | null | undefined) {
  return clean(value)?.toLowerCase() ?? null;
}

function isEmail(value: string | null | undefined) {
  const normalized = normalizeEmail(value);
  return Boolean(normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized));
}

function normalizeStatus(value: string | null | undefined, active: boolean) {
  const normalized = clean(value)?.toLowerCase();
  if (normalized === "invited" || normalized === "active" || normalized === "disabled") return normalized;
  return active ? "active" : "disabled";
}

function toStaffAuthProfile(row: StaffAuthProfileRow): StaffAuthProfile {
  const active = row?.active !== false;
  const isActive = row?.is_active !== false;
  return {
    id: String(row?.id ?? ""),
    authUserId: String(row?.auth_user_id ?? row?.id ?? ""),
    email: String(row?.email ?? "").trim().toLowerCase(),
    fullName: String(row?.full_name ?? "").trim(),
    role: normalizeRoleKey(String(row?.role ?? "program-assistant") as AppRole),
    active,
    isActive,
    status: normalizeStatus(row?.status, active),
    invitedAt: clean(row?.invited_at) ?? null,
    passwordSetAt: clean(row?.password_set_at) ?? null,
    lastSignInAt: clean(row?.last_sign_in_at) ?? null,
    disabledAt: clean(row?.disabled_at) ?? null
  };
}

function isMissingRelationError(error: unknown, relationName: string) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [candidate.message, candidate.details, candidate.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    String(candidate.code ?? "") === "42P01" ||
    text.includes(`relation "${relationName.toLowerCase()}" does not exist`) ||
    text.includes(`could not find the table '${relationName.toLowerCase()}'`)
  );
}

async function getServiceClient() {
  return await createClient({ serviceRole: true });
}

async function getStaffAuthProfileById(staffUserId: string): Promise<StaffAuthProfile> {
  const supabase = await getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, auth_user_id, email, full_name, role, active, is_active, status, invited_at, password_set_at, last_sign_in_at, disabled_at"
    )
    .eq("id", staffUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load staff auth profile ${staffUserId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`Staff profile ${staffUserId} was not found.`);
  }

  return toStaffAuthProfile(data);
}

async function getStaffAuthProfileByEmail(email: string): Promise<StaffAuthProfile | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const supabase = await getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, auth_user_id, email, full_name, role, active, is_active, status, invited_at, password_set_at, last_sign_in_at, disabled_at"
    )
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to load staff auth profile by email: ${error.message}`);
  }
  if (!data) return null;
  return toStaffAuthProfile(data);
}

async function patchStaffAuthProfile(
  staffUserId: string,
  patch: Partial<{
    status: StaffAuthStatus;
    invited_at: string | null;
    password_set_at: string | null;
    last_sign_in_at: string | null;
    disabled_at: string | null;
    active: boolean;
    is_active: boolean;
  }>
) {
  const supabase = await getServiceClient();
  const nextPatch: Record<string, unknown> = {
    ...patch,
    updated_at: toEasternISO()
  };
  const { error } = await supabase.from("profiles").update(nextPatch).eq("id", staffUserId);
  if (error) {
    throw new Error(`Unable to update staff auth profile ${staffUserId}: ${error.message}`);
  }
}

async function insertAuditLog(input: {
  actorUserId: string | null;
  actorRole: AppRole | null;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
}) {
  await insertAuditLogEntry({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details,
    serviceRole: true
  });
}

async function insertStaffAuthEvent(input: {
  staffUserId: string;
  authUserId: string;
  actorUserId: string | null;
  eventType: StaffAuthEventType;
  details?: Record<string, unknown>;
}) {
  const supabase = await getServiceClient();
  const { error } = await supabase.from("staff_auth_events").insert({
    staff_user_id: input.staffUserId,
    auth_user_id: input.authUserId,
    actor_user_id: input.actorUserId,
    event_type: input.eventType,
    event_details: input.details ?? {}
  });
  if (error) {
    if (isMissingRelationError(error, "staff_auth_events")) {
      throw new Error(
        "Missing Supabase schema dependency public.staff_auth_events. Apply migration 0029_staff_auth_lifecycle.sql."
      );
    }
    throw new Error(`Unable to insert staff auth event (${input.eventType}): ${error.message}`);
  }
}

function resolveStaffSenderEmail() {
  return (
    normalizeEmail(process.env.CLINICAL_SENDER_EMAIL) ??
    normalizeEmail(process.env.DEFAULT_CLINICAL_SENDER_EMAIL) ??
    normalizeEmail(process.env.RESEND_FROM_EMAIL)
  );
}

async function sendStaffAuthEmail(input: {
  toEmail: string;
  recipientName: string;
  mode: StaffAuthEmailMode;
  actionUrl: string;
}) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) {
    throw new Error("Staff auth email delivery is not configured. Set RESEND_API_KEY.");
  }

  const senderEmail = resolveStaffSenderEmail();
  if (!senderEmail || !isEmail(senderEmail)) {
    throw new Error(
      "Staff auth sender email is missing or invalid. Set CLINICAL_SENDER_EMAIL (or DEFAULT_CLINICAL_SENDER_EMAIL/RESEND_FROM_EMAIL)."
    );
  }

  const template = buildStaffAuthEmailTemplate({
    recipientName: input.recipientName,
    actionUrl: input.actionUrl,
    mode: input.mode
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: buildDocumentCenterSenderHeader(senderEmail),
      to: [input.toEmail],
      subject: template.subject,
      html: template.html,
      text: template.text
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Unable to deliver staff auth email (${response.status}). ${detail}`.trim());
  }
}

function normalizeNextPath(nextPath: string) {
  const cleanPath = clean(nextPath) ?? "/";
  if (!cleanPath.startsWith("/")) {
    throw new Error(`Invalid internal redirect path "${nextPath}". Expected a root-relative path.`);
  }
  return cleanPath;
}

async function buildRecoveryActionLink(email: string, nextPath: string) {
  const supabase = await getServiceClient();
  const redirectTo = `${getPublicAppUrl()}/auth/confirm?next=${encodeURIComponent(normalizeNextPath(nextPath))}`;
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo
    }
  });

  if (error) {
    throw new Error(`Unable to generate auth recovery link for ${email}: ${error.message}`);
  }

  const actionLink = clean(data?.properties?.action_link ?? null);
  if (!actionLink) {
    throw new Error(`Supabase did not return an auth action link for ${email}.`);
  }

  return actionLink;
}

async function resolveActorRole(actorUserId: string | null): Promise<AppRole | null> {
  if (!actorUserId) return null;
  const actor = await getStaffAuthProfileById(actorUserId);
  return actor.role;
}

export async function sendStaffSetPasswordInvite(input: {
  staffUserId: string;
  actorUserId: string;
  mode: SendInviteMode;
}) {
  const staff = await getStaffAuthProfileById(input.staffUserId);
  if (!isEmail(staff.email)) {
    throw new Error(`Staff profile ${staff.id} is missing a valid email address.`);
  }

  const actionLink = await buildRecoveryActionLink(staff.email, "/auth/set-password");
  await sendStaffAuthEmail({
    toEmail: staff.email,
    recipientName: staff.fullName || "Team Member",
    mode: "set-password",
    actionUrl: actionLink
  });

  const now = toEasternISO();
  await patchStaffAuthProfile(staff.id, {
    status: "invited",
    invited_at: now,
    disabled_at: null
  });

  await insertStaffAuthEvent({
    staffUserId: staff.id,
    authUserId: staff.authUserId,
    actorUserId: input.actorUserId,
    eventType: input.mode,
    details: {
      delivery: "email",
      destination: staff.email
    }
  });

  await insertAuditLog({
    actorUserId: input.actorUserId,
    actorRole: await resolveActorRole(input.actorUserId),
    action: input.mode,
    entityType: "profile",
    entityId: staff.id,
    details: {
      email: staff.email,
      staffUserId: staff.id
    }
  });
}

export async function sendStaffPasswordReset(input: {
  staffUserId: string;
  actorUserId: string | null;
  source: "admin" | "self-service";
}) {
  const staff = await getStaffAuthProfileById(input.staffUserId);
  if (!isEmail(staff.email)) {
    throw new Error(`Staff profile ${staff.id} is missing a valid email address.`);
  }

  const actionLink = await buildRecoveryActionLink(staff.email, "/auth/reset-password");
  await sendStaffAuthEmail({
    toEmail: staff.email,
    recipientName: staff.fullName || "Team Member",
    mode: "reset-password",
    actionUrl: actionLink
  });

  await insertStaffAuthEvent({
    staffUserId: staff.id,
    authUserId: staff.authUserId,
    actorUserId: input.actorUserId,
    eventType: "password_reset_requested",
    details: {
      source: input.source,
      delivery: "email",
      destination: staff.email
    }
  });

  await insertAuditLog({
    actorUserId: input.actorUserId,
    actorRole: await resolveActorRole(input.actorUserId),
    action: "password_reset_requested",
    entityType: "profile",
    entityId: staff.id,
    details: {
      email: staff.email,
      staffUserId: staff.id,
      source: input.source
    }
  });
}

export async function requestStaffPasswordResetByEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized || !isEmail(normalized)) return;
  const staff = await getStaffAuthProfileByEmail(normalized);
  if (!staff) return;
  await sendStaffPasswordReset({
    staffUserId: staff.id,
    actorUserId: null,
    source: "self-service"
  });
}

export async function completeStaffPasswordUpdateFromSession(input: {
  mode: "set-password" | "reset-password";
  password: string;
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user?.id) {
    throw new Error("No authenticated user was found for password update.");
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: input.password
  });
  if (updateError) {
    throw new Error(updateError.message);
  }

  const staff = await getStaffAuthProfileById(user.id);
  const now = toEasternISO();
  const nextStatus: StaffAuthStatus = staff.status === "disabled" ? "disabled" : "active";
  await patchStaffAuthProfile(staff.id, {
    status: nextStatus,
    password_set_at: now,
    last_sign_in_at: now
  });

  const eventType: StaffAuthEventType =
    input.mode === "set-password" ? "password_set" : "password_reset_completed";

  await insertStaffAuthEvent({
    staffUserId: staff.id,
    authUserId: staff.authUserId,
    actorUserId: staff.id,
    eventType,
    details: {
      mode: input.mode
    }
  });

  await insertAuditLog({
    actorUserId: staff.id,
    actorRole: staff.role,
    action: eventType,
    entityType: "profile",
    entityId: staff.id,
    details: {
      email: staff.email
    }
  });
}

export async function setStaffLoginDisabled(input: {
  staffUserId: string;
  actorUserId: string;
  disabled: boolean;
}) {
  if (input.disabled && input.staffUserId === input.actorUserId) {
    throw new Error("You cannot disable your own login while signed in.");
  }

  const staff = await getStaffAuthProfileById(input.staffUserId);
  const nextStatus: StaffAuthStatus = input.disabled
    ? "disabled"
    : staff.passwordSetAt
      ? "active"
      : "invited";
  await patchStaffAuthProfile(staff.id, {
    status: nextStatus,
    disabled_at: input.disabled ? toEasternISO() : null
  });

  const eventType: StaffAuthEventType = input.disabled ? "login_disabled" : "login_enabled";
  await insertStaffAuthEvent({
    staffUserId: staff.id,
    authUserId: staff.authUserId,
    actorUserId: input.actorUserId,
    eventType
  });

  await insertAuditLog({
    actorUserId: input.actorUserId,
    actorRole: await resolveActorRole(input.actorUserId),
    action: eventType,
    entityType: "profile",
    entityId: staff.id,
    details: {
      email: staff.email
    }
  });
}

