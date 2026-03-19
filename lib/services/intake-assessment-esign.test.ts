import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  buildIntakeAssessmentSignaturePersistence,
  isAuthorizedIntakeAssessmentSignerRole
} from "@/lib/services/intake-assessment-esign-core";

test("typed signature placeholder text is removed from Intake Assessment form", () => {
  const source = readFileSync("components/forms/assessment-form.tsx", "utf8");
  assert.equal(source.toLowerCase().includes("replace typed signature"), false);
  assert.equal(source.toLowerCase().includes("pdf/e-sign integration"), false);
  assert.equal(source.includes("placeholder=\"Type full legal name\""), false);
  assert.equal(source.includes("EsignaturePad"), true);
});

test("intake assessment action requires a captured signature image payload", () => {
  const source = readFileSync("app/actions.ts", "utf8");
  assert.equal(source.includes("signatureImageDataUrl: z.string().min(1)"), true);
  assert.equal(source.includes("signatureImageDataUrl: payload.data.signatureImageDataUrl"), true);
});

test("authorized nurse role can produce canonical intake e-sign persistence payload", () => {
  assert.equal(isAuthorizedIntakeAssessmentSignerRole("nurse"), true);

  const signed = buildIntakeAssessmentSignaturePersistence({
    assessmentId: "assessment-1",
    memberId: "member-1",
    actor: {
      id: "user-1",
      fullName: "Nurse Full Name",
      role: "nurse",
      signoffName: "Nurse Full Name, RN"
    },
    attested: true,
    signedAt: "2026-03-12T10:00:00.000Z"
  });

  assert.equal(signed.state.status, "signed");
  assert.equal(signed.state.signedByUserId, "user-1");
  assert.equal(signed.state.signedByName, "Nurse Full Name, RN");
  assert.equal(signed.signatureRow.signed_by_user_id, "user-1");
  assert.equal(signed.assessmentUpdate.signed_by_user_id, "user-1");
});

test("authorized admin role can produce canonical intake e-sign persistence payload", () => {
  assert.equal(isAuthorizedIntakeAssessmentSignerRole("admin"), true);

  const signed = buildIntakeAssessmentSignaturePersistence({
    assessmentId: "assessment-2",
    memberId: "member-2",
    actor: {
      id: "user-2",
      fullName: "Admin User",
      role: "admin"
    },
    attested: true,
    signedAt: "2026-03-12T10:05:00.000Z"
  });

  assert.equal(signed.state.signedByName, "Admin User");
  assert.equal(signed.state.signatureMetadata.signerRole, "admin");
});

test("unauthorized roles cannot sign intake assessment", () => {
  assert.equal(isAuthorizedIntakeAssessmentSignerRole("manager"), false);
  assert.throws(
    () =>
      buildIntakeAssessmentSignaturePersistence({
        assessmentId: "assessment-3",
        memberId: "member-3",
        actor: {
          id: "user-3",
          fullName: "Manager User",
          role: "manager"
        },
        attested: true,
        signedAt: "2026-03-12T10:10:00.000Z"
      }),
    /Only nurse or admin users/
  );
});

test("signer identity resolves from authenticated actor, not client-submitted free text", () => {
  const signed = buildIntakeAssessmentSignaturePersistence({
    assessmentId: "assessment-4",
    memberId: "member-4",
    actor: {
      id: "user-4",
      fullName: "Session Nurse",
      role: "nurse",
      signoffName: "Session Nurse, LPN"
    },
    attested: true,
    signedAt: "2026-03-12T10:15:00.000Z",
    metadata: {
      clientSubmittedSigner: "Bad Actor Name"
    }
  });

  assert.equal(signed.state.signedByName, "Session Nurse, LPN");
  assert.notEqual(signed.state.signedByName, "Bad Actor Name");
});

test("signed state is consistent across canonical persistence/read payloads", () => {
  const signed = buildIntakeAssessmentSignaturePersistence({
    assessmentId: "assessment-5",
    memberId: "member-5",
    actor: {
      id: "user-5",
      fullName: "Clinical Nurse",
      role: "nurse"
    },
    attested: true,
    signedAt: "2026-03-12T10:20:00.000Z",
    signatureArtifactStoragePath: "members/member-5/assessment/assessment-5/signed.pdf",
    signatureArtifactMemberFileId: "mf_123"
  });

  assert.equal(signed.signatureRow.assessment_id, signed.state.assessmentId);
  assert.equal(signed.assessmentUpdate.signed_by, signed.state.signedByName);
  assert.equal(signed.signatureRow.signed_at, signed.state.signedAt);
  assert.equal(signed.state.signatureArtifactStoragePath, "members/member-5/assessment/assessment-5/signed.pdf");
  assert.equal(signed.state.signatureArtifactMemberFileId, "mf_123");
  assert.equal(signed.assessmentUpdate.signature_status, "signed");
});
