import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildCarePlanNurseSignaturePersistence,
  isAuthorizedCarePlanSignerRole
} from "@/lib/services/care-plan-nurse-esign-core";

test("typed signature placeholder text is removed from Care Plan forms", () => {
  const source = readFileSync("components/forms/care-plan-forms.tsx", "utf8");
  assert.equal(source.toLowerCase().includes("replace typed signature"), false);
  assert.equal(source.toLowerCase().includes("pdf/e-sign integration"), false);
  assert.equal(source.includes("placeholder=\"Type full legal name\""), false);
  assert.equal(source.includes("EsignaturePad"), true);
});

test("care plan actions require a captured signature image payload", () => {
  const source = readFileSync("app/care-plan-actions.ts", "utf8");
  assert.equal(source.includes("signatureImageDataUrl: z.string().min(1)"), true);
  assert.equal(source.includes("signatureImageDataUrl: payload.data.signatureImageDataUrl"), true);
});

test("care plan actions only report committed success when the service marked a partial commit", () => {
  const source = readFileSync("app/care-plan-actions.ts", "utf8");
  assert.equal(source.includes("function getCommittedCarePlanId"), true);
  assert.equal(source.includes("candidate.partiallyCommitted !== true"), true);
  assert.equal(source.includes('error: error instanceof Error ? error.message : "Unable to review care plan."'), true);
  assert.equal(source.includes('error: error instanceof Error ? error.message : "Unable to sign care plan."'), true);
});

test("authorized nurse role can produce canonical care-plan nurse e-sign persistence payload", () => {
  assert.equal(isAuthorizedCarePlanSignerRole("nurse"), true);

  const signed = buildCarePlanNurseSignaturePersistence({
    carePlanId: "care-plan-1",
    memberId: "member-1",
    actor: {
      id: "user-1",
      fullName: "Nurse Full Name",
      role: "nurse",
      signoffName: "Nurse Full Name, RN"
    },
    attested: true,
    signedAt: "2026-03-12T10:00:00.000Z",
    completionDate: "2026-03-12"
  });

  assert.equal(signed.state.status, "signed");
  assert.equal(signed.state.signedByUserId, "user-1");
  assert.equal(signed.state.signedByName, "Nurse Full Name, RN");
  assert.equal(signed.signatureRow.signed_by_user_id, "user-1");
  assert.equal(signed.carePlanUpdate.nurse_signed_by_user_id, "user-1");
});

test("authorized admin role can produce canonical care-plan nurse e-sign persistence payload", () => {
  assert.equal(isAuthorizedCarePlanSignerRole("admin"), true);

  const signed = buildCarePlanNurseSignaturePersistence({
    carePlanId: "care-plan-2",
    memberId: "member-2",
    actor: {
      id: "user-2",
      fullName: "Admin User",
      role: "admin"
    },
    attested: true,
    signedAt: "2026-03-12T10:05:00.000Z",
    completionDate: "2026-03-12"
  });

  assert.equal(signed.state.signedByName, "Admin User");
  assert.equal(signed.state.signatureMetadata.signerRole, "admin");
});

test("unauthorized roles cannot sign care plans", () => {
  assert.equal(isAuthorizedCarePlanSignerRole("manager"), false);
  assert.throws(
    () =>
      buildCarePlanNurseSignaturePersistence({
        carePlanId: "care-plan-3",
        memberId: "member-3",
        actor: {
          id: "user-3",
          fullName: "Manager User",
          role: "manager"
        },
        attested: true,
        signedAt: "2026-03-12T10:10:00.000Z",
        completionDate: "2026-03-12"
      }),
    /Only nurse or admin users/
  );
});

test("signer identity resolves from authenticated actor, not client-submitted free text", () => {
  const signed = buildCarePlanNurseSignaturePersistence({
    carePlanId: "care-plan-4",
    memberId: "member-4",
    actor: {
      id: "user-4",
      fullName: "Session Nurse",
      role: "nurse",
      signoffName: "Session Nurse, LPN"
    },
    attested: true,
    signedAt: "2026-03-12T10:15:00.000Z",
    completionDate: "2026-03-12",
    metadata: {
      clientSubmittedSigner: "Bad Actor Name"
    }
  });

  assert.equal(signed.state.signedByName, "Session Nurse, LPN");
  assert.notEqual(signed.state.signedByName, "Bad Actor Name");
});

test("signed state is consistent across canonical care-plan persistence payloads", () => {
  const signed = buildCarePlanNurseSignaturePersistence({
    carePlanId: "care-plan-5",
    memberId: "member-5",
    actor: {
      id: "user-5",
      fullName: "Clinical Nurse",
      role: "nurse"
    },
    attested: true,
    signedAt: "2026-03-12T10:20:00.000Z",
    completionDate: "2026-03-12",
    signatureArtifactStoragePath: "members/member-5/care-plans/care-plan-5/signed.pdf",
    signatureArtifactMemberFileId: "mf_123"
  });

  assert.equal(signed.signatureRow.care_plan_id, signed.state.carePlanId);
  assert.equal(signed.signatureRow.signed_at, signed.state.signedAt);
  assert.equal(signed.carePlanUpdate.nurse_signature_status, "signed");
  assert.equal(signed.carePlanUpdate.nurse_signed_by_name, signed.state.signedByName);
  assert.equal(signed.carePlanUpdate.completed_by, signed.state.signedByName);
  assert.equal(signed.state.signatureArtifactStoragePath, "members/member-5/care-plans/care-plan-5/signed.pdf");
  assert.equal(signed.state.signatureArtifactMemberFileId, "mf_123");
});
