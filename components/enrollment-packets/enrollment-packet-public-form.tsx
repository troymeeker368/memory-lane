"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";

import {
  savePublicEnrollmentPacketProgressAction,
  submitPublicEnrollmentPacketAction
} from "@/app/sign/enrollment-packet/[token]/actions";
import { EnrollmentPacketPublicFormAgreements } from "@/components/enrollment-packets/enrollment-packet-public-form-agreements";
import { EnrollmentPacketPublicFormLegal } from "@/components/enrollment-packets/enrollment-packet-public-form-legal";
import { formatPhoneInput } from "@/lib/phone";
import {
  ENROLLMENT_PACKET_ADL_AMBULATION_OPTIONS,
  ENROLLMENT_PACKET_ADL_BATHING_OPTIONS,
  ENROLLMENT_PACKET_ADL_DRESSING_OPTIONS,
  ENROLLMENT_PACKET_ADL_EATING_OPTIONS,
  ENROLLMENT_PACKET_ADL_TOILETING_OPTIONS,
  ENROLLMENT_PACKET_ADL_TRANSFER_OPTIONS,
  ENROLLMENT_PACKET_BEHAVIORAL_OPTIONS,
  ENROLLMENT_PACKET_CONTINENCE_OPTIONS,
  ENROLLMENT_PACKET_LIVING_SITUATION_OPTIONS,
  ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS,
  ENROLLMENT_PACKET_VETERAN_BRANCH_OPTIONS
} from "@/lib/services/enrollment-packet-public-options";
import { ENROLLMENT_PACKET_UPLOAD_FIELDS } from "@/lib/services/enrollment-packet-public-uploads";
import {
  validateEnrollmentPacketCompletion
} from "@/lib/services/enrollment-packet-public-validation";
import {
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakeArrayKey,
  type EnrollmentPacketIntakeFieldKey,
  type EnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakeTextKey
} from "@/lib/services/enrollment-packet-intake-payload";

type PublicEnrollmentPacketFields = {
  requestedDays: string[];
  transportation: string | null;
  communityFee: number;
  dailyRate: number;
  caregiverName: string | null;
  caregiverPhone: string | null;
  caregiverEmail: string | null;
  caregiverAddressLine1: string | null;
  caregiverAddressLine2: string | null;
  caregiverCity: string | null;
  caregiverState: string | null;
  caregiverZip: string | null;
  secondaryContactName: string | null;
  secondaryContactPhone: string | null;
  secondaryContactEmail: string | null;
  secondaryContactRelationship: string | null;
  notes: string | null;
  intakePayload: EnrollmentPacketIntakePayload;
};

type UploadKey = (typeof ENROLLMENT_PACKET_UPLOAD_FIELDS)[number]["key"];
type UploadState = Record<UploadKey, File[]>;

const ADL_FIELD_LABELS: Record<string, string> = {
  adlMobilityLevel: "Ambulation",
  adlTransferLevel: "Transfers",
  adlToiletingLevel: "Toileting",
  adlBathingLevel: "Bathing",
  adlDressingLevel: "Dressing",
  adlEatingLevel: "Eating"
};

const ADL_FIELD_OPTIONS: Partial<Record<EnrollmentPacketIntakeTextKey, string[]>> = {
  adlMobilityLevel: ENROLLMENT_PACKET_ADL_AMBULATION_OPTIONS,
  adlTransferLevel: ENROLLMENT_PACKET_ADL_TRANSFER_OPTIONS,
  adlToiletingLevel: ENROLLMENT_PACKET_ADL_TOILETING_OPTIONS,
  adlBathingLevel: ENROLLMENT_PACKET_ADL_BATHING_OPTIONS,
  adlDressingLevel: ENROLLMENT_PACKET_ADL_DRESSING_OPTIONS,
  adlEatingLevel: ENROLLMENT_PACKET_ADL_EATING_OPTIONS
};

function emptyUploadState(): UploadState {
  return ENROLLMENT_PACKET_UPLOAD_FIELDS.reduce((acc, definition) => {
    acc[definition.key] = [];
    return acc;
  }, {} as UploadState);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function toInitialPayload(fields: PublicEnrollmentPacketFields): EnrollmentPacketIntakePayload {
  const memberName = [fields.intakePayload.memberLegalFirstName, fields.intakePayload.memberLegalLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const defaultResponsiblePartyName =
    fields.intakePayload.membershipGuarantorSignatureName ??
    fields.intakePayload.primaryContactName ??
    fields.caregiverName;

  return normalizeEnrollmentPacketIntakePayload({
    ...fields.intakePayload,
    requestedAttendanceDays: fields.requestedDays,
    membershipRequestedWeekdays: fields.requestedDays,
    transportationPreference: fields.transportation,
    transportationQuestionEnabled: "No",
    primaryContactName: fields.intakePayload.primaryContactName ?? fields.caregiverName,
    primaryContactPhone: fields.intakePayload.primaryContactPhone ?? fields.caregiverPhone,
    primaryContactEmail: fields.intakePayload.primaryContactEmail ?? fields.caregiverEmail,
    primaryContactAddress: fields.intakePayload.primaryContactAddress ?? fields.caregiverAddressLine1,
    primaryContactAddressLine1: fields.intakePayload.primaryContactAddressLine1 ?? fields.caregiverAddressLine1,
    primaryContactCity: fields.intakePayload.primaryContactCity ?? fields.caregiverCity,
    primaryContactState: fields.intakePayload.primaryContactState ?? fields.caregiverState,
    primaryContactZip: fields.intakePayload.primaryContactZip ?? fields.caregiverZip,
    secondaryContactName: fields.intakePayload.secondaryContactName ?? fields.secondaryContactName,
    secondaryContactPhone: fields.intakePayload.secondaryContactPhone ?? fields.secondaryContactPhone,
    secondaryContactEmail: fields.intakePayload.secondaryContactEmail ?? fields.secondaryContactEmail,
    secondaryContactRelationship: fields.intakePayload.secondaryContactRelationship ?? fields.secondaryContactRelationship,
    secondaryContactAddressLine1: fields.intakePayload.secondaryContactAddressLine1,
    secondaryContactCity: fields.intakePayload.secondaryContactCity,
    secondaryContactState: fields.intakePayload.secondaryContactState,
    secondaryContactZip: fields.intakePayload.secondaryContactZip,
    memberAddressLine1: fields.intakePayload.memberAddressLine1 ?? fields.caregiverAddressLine1,
    memberAddressLine2: fields.intakePayload.memberAddressLine2 ?? fields.caregiverAddressLine2,
    memberCity: fields.intakePayload.memberCity ?? fields.caregiverCity,
    memberState: fields.intakePayload.memberState ?? fields.caregiverState,
    memberZip: fields.intakePayload.memberZip ?? fields.caregiverZip,
    membershipDailyAmount:
      fields.intakePayload.membershipDailyAmount ?? (fields.dailyRate > 0 ? fields.dailyRate.toFixed(2) : null),
    communityFee: fields.intakePayload.communityFee ?? (fields.communityFee > 0 ? fields.communityFee.toFixed(2) : null),
    membershipMemberSignatureName: fields.intakePayload.membershipMemberSignatureName ?? (memberName || null),
    membershipGuarantorSignatureName: defaultResponsiblePartyName ?? null,
    exhibitAGuarantorSignatureName:
      fields.intakePayload.exhibitAGuarantorSignatureName ?? defaultResponsiblePartyName ?? null,
    additionalNotes: fields.intakePayload.additionalNotes ?? fields.notes
  });
}

function applySignatureDefaults(payload: EnrollmentPacketIntakePayload, typedName: string) {
  const signatureDate = todayDateString();
  const normalizedName = typedName.trim();
  const memberName = [payload.memberLegalFirstName, payload.memberLegalLastName].filter(Boolean).join(" ").trim();
  if (!normalizedName) return payload;

  const patch: Partial<Record<EnrollmentPacketIntakeFieldKey, string | string[] | null>> = {
    guarantorSignatureName: payload.guarantorSignatureName ?? normalizedName,
    guarantorSignatureDate: payload.guarantorSignatureDate ?? signatureDate,
    privacyAcknowledgmentSignatureName: payload.privacyAcknowledgmentSignatureName ?? normalizedName,
    privacyAcknowledgmentSignatureDate: payload.privacyAcknowledgmentSignatureDate ?? signatureDate,
    rightsAcknowledgmentSignatureName: payload.rightsAcknowledgmentSignatureName ?? normalizedName,
    rightsAcknowledgmentSignatureDate: payload.rightsAcknowledgmentSignatureDate ?? signatureDate,
    ancillaryChargesAcknowledgmentSignatureName:
      payload.ancillaryChargesAcknowledgmentSignatureName ?? normalizedName,
    ancillaryChargesAcknowledgmentSignatureDate:
      payload.ancillaryChargesAcknowledgmentSignatureDate ?? signatureDate,
    photoConsentAcknowledgmentName: payload.photoConsentAcknowledgmentName ?? normalizedName,
    membershipMemberSignatureName: payload.membershipMemberSignatureName ?? memberName,
    membershipGuarantorSignatureName: payload.membershipGuarantorSignatureName ?? normalizedName,
    membershipMemberSignatureDate: payload.membershipMemberSignatureDate ?? signatureDate,
    exhibitAGuarantorSignatureName: payload.exhibitAGuarantorSignatureName ?? normalizedName,
    membershipGuarantorSignatureDate: payload.membershipGuarantorSignatureDate ?? signatureDate
  };

  return normalizeEnrollmentPacketIntakePayload({ ...payload, ...patch });
}

function textValue(payload: EnrollmentPacketIntakePayload, key: EnrollmentPacketIntakeTextKey) {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function arrayValue(payload: EnrollmentPacketIntakePayload, key: EnrollmentPacketIntakeArrayKey) {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const MISSING_ITEM_FIELD_KEY: Record<string, EnrollmentPacketIntakeFieldKey> = {
  "Member name": "memberLegalFirstName",
  "Member DOB": "memberDob",
  "Member gender": "memberGender",
  "Member street address": "memberAddressLine1",
  "Member city/town": "memberCity",
  "Member state": "memberState",
  "Member ZIP code": "memberZip",
  "Primary contact name": "primaryContactName",
  "Primary contact relationship": "primaryContactRelationship",
  "Primary contact phone": "primaryContactPhone",
  "Primary contact email": "primaryContactEmail",
  "Primary contact street address": "primaryContactAddressLine1",
  "Primary contact city/town": "primaryContactCity",
  "Primary contact state": "primaryContactState",
  "Primary contact ZIP code": "primaryContactZip",
  "Secondary contact name": "secondaryContactName",
  "Secondary contact relationship": "secondaryContactRelationship",
  "Secondary contact phone": "secondaryContactPhone",
  "Secondary contact email": "secondaryContactEmail",
  "Secondary contact street address": "secondaryContactAddressLine1",
  "Secondary contact city/town": "secondaryContactCity",
  "Secondary contact state": "secondaryContactState",
  "Secondary contact ZIP code": "secondaryContactZip",
  "PCP name": "pcpName",
  "PCP address": "pcpAddress",
  "PCP phone": "pcpPhone",
  "Pharmacy name": "pharmacy",
  "Pharmacy address": "pharmacyAddress",
  "Pharmacy phone": "pharmacyPhone",
  "Requested start date": "requestedStartDate",
  "Total initial enrollment amount": "totalInitialEnrollmentAmount",
  "Payment method selection": "paymentMethodSelection",
  "Branch of service": "branchOfService",
  "Tricare number": "tricareNumber",
  "Medication names": "medicationNamesDuringDay",
  "Oxygen flow rate": "oxygenFlowRate",
  "History of falls": "fallsHistory",
  "Falls within last 3 months": "fallsWithinLast3Months",
  "Pet names": "petNames",
  "Dentures selection (upper/lower)": "dentureTypes",
  "Bank name": "bankName",
  "Routing number": "bankAba",
  "Account number": "bankAccountNumber",
  "Card number": "cardNumber",
  "Card expiration": "cardExpiration",
  "Card CVV": "cardCvv",
  "Card billing street address": "cardBillingAddressLine1",
  "Card billing city/town": "cardBillingCity",
  "Card billing state": "cardBillingState",
  "Card billing ZIP code": "cardBillingZip",
  "Membership member signature name": "membershipMemberSignatureName",
  "Membership member signature date": "membershipMemberSignatureDate",
  "Membership responsible party / guarantor signature name": "membershipGuarantorSignatureName",
  "Exhibit A responsible party / guarantor acknowledgement name": "exhibitAGuarantorSignatureName",
  "Privacy Practices acknowledgement": "privacyPracticesAcknowledged",
  "Statement of Rights acknowledgement": "statementOfRightsAcknowledged",
  "Photo Consent acknowledgement": "photoConsentAcknowledged",
  "Ancillary Charges acknowledgement": "ancillaryChargesAcknowledged",
  "Photo consent selection": "photoConsentChoice"
};

export function EnrollmentPacketPublicForm({
  token,
  fields
}: {
  token: string;
  fields: PublicEnrollmentPacketFields;
}) {
  const [payload, setPayload] = useState<EnrollmentPacketIntakePayload>(() => toInitialPayload(fields));
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [attested, setAttested] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [caregiverTypedName, setCaregiverTypedName] = useState(payload.primaryContactName ?? "");
  const [uploads, setUploads] = useState<UploadState>(() => emptyUploadState());
  const [touchedFields, setTouchedFields] = useState<Set<string>>(() => new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [expandedLegalSections, setExpandedLegalSections] = useState<Record<string, boolean>>({
    privacy: false,
    rights: false,
    photo: false,
    ancillary: false
  });

  const completion = useMemo(
    () =>
      validateEnrollmentPacketCompletion({
        payload
      }),
    [payload]
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const strokeStartedRef = useRef(false);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoSaveRef = useRef(false);

  const missingFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    completion.missingItems.forEach((item) => {
      if (item === "Member name") {
        keys.add("memberLegalFirstName");
        keys.add("memberLegalLastName");
      }
      const key = MISSING_ITEM_FIELD_KEY[item];
      if (key) keys.add(key);
    });
    return keys;
  }, [completion.missingItems]);

  const progressSections = useMemo(() => {
    const missing = completion.missingItems;
    const hasAny = (patterns: RegExp[]) => missing.some((item) => patterns.some((pattern) => pattern.test(item)));
    const memberInfoDone = !hasAny([/^Member /]);
    const contactsDone = !hasAny([/^Primary contact /, /^Secondary contact /]);
    const medicalDone = !hasAny([/^PCP /, /^Pharmacy /, /^Branch of service$/, /^Tricare number$/, /^Medication names$/, /^Oxygen flow rate$/, /^History of falls$/, /^Falls within last 3 months$/]);
    const functionalDone = !hasAny([/^Dentures selection/, /^Pet names$/]);
    const legalDone = !hasAny([/acknowledgement/i, /Photo consent selection/, /Payment method selection/, /Card /, /Routing number/, /Account number/, /Bank name/, /Membership /, /^Exhibit A /]);
    const signatureDone = completion.isComplete && caregiverTypedName.trim().length > 0 && hasSignature && attested;
    return [
      { id: "member", label: "Member Information", complete: memberInfoDone },
      { id: "contacts", label: "Contacts", complete: contactsDone },
      { id: "medical", label: "Medical Information", complete: medicalDone },
      { id: "functional", label: "Functional Status", complete: functionalDone },
      { id: "legal", label: "Legal Agreements", complete: legalDone },
      { id: "signature", label: "Final Signature", complete: signatureDone }
    ];
  }, [attested, caregiverTypedName, completion.isComplete, completion.missingItems, hasSignature]);

  const completionPercent = useMemo(() => {
    const completeCount = progressSections.filter((section) => section.complete).length;
    return Math.round((completeCount / progressSections.length) * 100);
  }, [progressSections]);

  const markTouched = (key: EnrollmentPacketIntakeFieldKey) => {
    setTouchedFields((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  const fieldError = (key: EnrollmentPacketIntakeFieldKey, fallbackLabel: string) => {
    if (!missingFieldKeys.has(key)) return null;
    if (!submitAttempted && !touchedFields.has(key)) return null;
    return `${fallbackLabel} is required.`;
  };

  const controlClassName = (key: EnrollmentPacketIntakeFieldKey, fallbackLabel: string) =>
    `h-11 w-full rounded-lg border px-3 ${fieldError(key, fallbackLabel) ? "border-red-500 bg-red-50" : "border-border"}`;

  const scrollToField = (key: EnrollmentPacketIntakeFieldKey) => {
    const element = document.getElementById(`field-${key}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    if ("focus" in element && typeof (element as HTMLInputElement).focus === "function") {
      (element as HTMLInputElement).focus();
    }
  };

  const scrollToFirstMissingField = () => {
    for (const item of completion.missingItems) {
      const key = MISSING_ITEM_FIELD_KEY[item];
      if (!key) continue;
      scrollToField(key);
      break;
    }
  };

  const persistProgressRef = useRef<(
    sourcePayload: EnrollmentPacketIntakePayload,
    mode: "auto" | "manual"
  ) => Promise<void>>(async () => {});
  persistProgressRef.current = async (sourcePayload: EnrollmentPacketIntakePayload, mode: "auto" | "manual") => {
    const formData = new FormData();
    appendCommonFields(formData, sourcePayload);
    const result = await savePublicEnrollmentPacketProgressAction(formData);
    if (!result.ok) {
      setAutosaveStatus("error");
      if (mode === "manual") setStatus(result.error);
      return;
    }
    const now = new Date();
    setAutosaveStatus("saved");
    setLastSavedAt(now.toLocaleString());
    if (mode === "manual") setStatus("Progress saved.");
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#1f2937";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);

  useEffect(() => {
    if (payload.cardUsePrimaryContactAddress !== "Yes") return;
    setPayload((current) =>
      normalizeEnrollmentPacketIntakePayload({
        ...current,
        cardBillingAddressLine1: current.primaryContactAddressLine1,
        cardBillingCity: current.primaryContactCity,
        cardBillingState: current.primaryContactState,
        cardBillingZip: current.primaryContactZip
      })
    );
  }, [
    payload.cardUsePrimaryContactAddress,
    payload.primaryContactAddressLine1,
    payload.primaryContactCity,
    payload.primaryContactState,
    payload.primaryContactZip
  ]);

  const setText = (key: EnrollmentPacketIntakeTextKey, value: string) => {
    setPayload((current) => normalizeEnrollmentPacketIntakePayload({ ...current, [key]: value }));
  };

  const setAck = (key: EnrollmentPacketIntakeTextKey, checked: boolean) => {
    setText(key, checked ? "Acknowledged" : "");
  };

  const setExpandedLegalSection = (section: "privacy" | "rights" | "photo" | "ancillary", open: boolean) => {
    setExpandedLegalSections((current) => ({ ...current, [section]: open }));
  };

  const toggleArray = (key: EnrollmentPacketIntakeArrayKey, option: string, checked: boolean) => {
    setPayload((current) => {
      const selected = new Set(arrayValue(current, key));
      if (checked) selected.add(option);
      else selected.delete(option);
      return normalizeEnrollmentPacketIntakePayload({ ...current, [key]: Array.from(selected) });
    });
  };

  const appendCommonFields = (formData: FormData, sourcePayload: EnrollmentPacketIntakePayload) => {
    formData.set("token", token);
    formData.set("intakePayload", JSON.stringify(sourcePayload));
    formData.set("caregiverName", sourcePayload.primaryContactName ?? "");
    formData.set("caregiverPhone", sourcePayload.primaryContactPhone ?? "");
    formData.set("caregiverEmail", sourcePayload.primaryContactEmail ?? "");
    formData.set("primaryContactAddress", sourcePayload.primaryContactAddressLine1 ?? sourcePayload.primaryContactAddress ?? "");
    formData.set("primaryContactAddressLine1", sourcePayload.primaryContactAddressLine1 ?? "");
    formData.set("primaryContactCity", sourcePayload.primaryContactCity ?? "");
    formData.set("primaryContactState", sourcePayload.primaryContactState ?? "");
    formData.set("primaryContactZip", sourcePayload.primaryContactZip ?? "");
    formData.set("caregiverAddressLine1", sourcePayload.memberAddressLine1 ?? "");
    formData.set("caregiverAddressLine2", sourcePayload.memberAddressLine2 ?? "");
    formData.set("caregiverCity", sourcePayload.memberCity ?? "");
    formData.set("caregiverState", sourcePayload.memberState ?? "");
    formData.set("caregiverZip", sourcePayload.memberZip ?? "");
    formData.set("secondaryContactName", sourcePayload.secondaryContactName ?? "");
    formData.set("secondaryContactPhone", sourcePayload.secondaryContactPhone ?? "");
    formData.set("secondaryContactEmail", sourcePayload.secondaryContactEmail ?? "");
    formData.set("secondaryContactRelationship", sourcePayload.secondaryContactRelationship ?? "");
    formData.set("secondaryContactAddress", sourcePayload.secondaryContactAddressLine1 ?? sourcePayload.secondaryContactAddress ?? "");
    formData.set("secondaryContactAddressLine1", sourcePayload.secondaryContactAddressLine1 ?? "");
    formData.set("secondaryContactCity", sourcePayload.secondaryContactCity ?? "");
    formData.set("secondaryContactState", sourcePayload.secondaryContactState ?? "");
    formData.set("secondaryContactZip", sourcePayload.secondaryContactZip ?? "");
    formData.set("notes", sourcePayload.additionalNotes ?? "");
  };

  const saveProgress = () => {
    setStatus(null);
    setAutosaveStatus("saving");
    void persistProgressRef.current(payload, "manual");
  };

  const submitPacket = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSubmitAttempted(true);
    if (!completion.isComplete) {
      setStatus(`Complete required fields before signing: ${completion.missingItems.join(", ")}.`);
      scrollToFirstMissingField();
      return;
    }
    if (!caregiverTypedName.trim()) {
      setStatus("Typed caregiver signature name is required.");
      return;
    }
    if (!hasSignature) {
      setStatus("Please draw your signature before submitting.");
      return;
    }
    if (!attested) {
      setStatus("Please confirm signature attestation before submitting.");
      return;
    }

    const signatureImageDataUrl = canvas.toDataURL("image/png");
    const payloadToSubmit = applySignatureDefaults(payload, caregiverTypedName);
    setStatus(null);

    startTransition(async () => {
      const formData = new FormData();
      appendCommonFields(formData, payloadToSubmit);
      formData.set("caregiverTypedName", caregiverTypedName);
      formData.set("caregiverSignatureImageDataUrl", signatureImageDataUrl);
      formData.set("attested", "true");

      ENROLLMENT_PACKET_UPLOAD_FIELDS.forEach((uploadField) => {
        uploads[uploadField.key].forEach((file) => formData.append(uploadField.key, file));
      });

      const result = await submitPublicEnrollmentPacketAction(formData);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }

      setPayload(payloadToSubmit);
      setIsSubmitted(true);
      setStatus("Enrollment packet submitted successfully.");
    });
  };

  useEffect(() => {
    if (!shouldAutoSaveRef.current) {
      shouldAutoSaveRef.current = true;
      return;
    }
    if (isSubmitted) return;
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    setAutosaveStatus("saving");
    autosaveTimeoutRef.current = setTimeout(() => {
      void persistProgressRef.current(payload, "auto");
    }, 2500);

    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
  }, [isSubmitted, payload]);

  const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!canvas || !context || !point) return;
    drawingRef.current = true;
    strokeStartedRef.current = false;
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!context || !point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
    strokeStartedRef.current = true;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (strokeStartedRef.current) setHasSignature(true);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  if (isSubmitted) {
    return (
      <div className="space-y-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
        <h3 className="text-base font-semibold text-emerald-900">Enrollment Packet Submitted</h3>
        <p className="text-sm text-emerald-800">
          Thank you for completing the enrollment packet. Your information was submitted successfully.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-2 z-20 rounded-lg border border-border bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Packet progress</p>
          <p className="text-sm text-muted">{completionPercent}% complete</p>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-slate-200">
          <div className="h-2 rounded-full bg-brand transition-all" style={{ width: `${completionPercent}%` }} />
        </div>
        <div className="mt-2 grid gap-1 md:grid-cols-3">
          {progressSections.map((section) => (
            <p key={section.id} className={`text-xs ${section.complete ? "text-emerald-700" : "text-slate-600"}`}>
              {section.complete ? "✓" : "○"} {section.label}
            </p>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-slate-50 p-3 text-sm">
        <p><span className="font-semibold">Requested days:</span> {fields.requestedDays.length > 0 ? fields.requestedDays.join(", ") : "-"}</p>
        <p><span className="font-semibold">Daily rate:</span> ${fields.dailyRate.toFixed(2)}</p>
        <p><span className="font-semibold">Community fee:</span> ${fields.communityFee.toFixed(2)}</p>
        <p className="mt-1 text-xs text-muted">
          {autosaveStatus === "saving" ? "Saving draft..." : autosaveStatus === "error" ? "Autosave failed. Please use Save Progress." : "✓ Saved automatically"}
          {lastSavedAt ? ` | Last saved: ${lastSavedAt}` : ""}
        </p>
      </div>

      <p className="text-xs text-muted">Fields marked with <span className="font-semibold text-red-600">*</span> are required.</p>

      <Section title="1. Member Demographics">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">First name <span className="text-red-600">*</span></span><input id="field-memberLegalFirstName" className={controlClassName("memberLegalFirstName", "First name")} value={textValue(payload, "memberLegalFirstName")} onChange={(event) => setText("memberLegalFirstName", event.target.value)} onBlur={() => markTouched("memberLegalFirstName")} disabled={isPending} />{fieldError("memberLegalFirstName", "First name") ? <p className="text-xs text-red-600">{fieldError("memberLegalFirstName", "First name")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Last name <span className="text-red-600">*</span></span><input id="field-memberLegalLastName" className={controlClassName("memberLegalLastName", "Last name")} value={textValue(payload, "memberLegalLastName")} onChange={(event) => setText("memberLegalLastName", event.target.value)} onBlur={() => markTouched("memberLegalLastName")} disabled={isPending} />{fieldError("memberLegalLastName", "Last name") ? <p className="text-xs text-red-600">{fieldError("memberLegalLastName", "Last name")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Date of Birth <span className="text-red-600">*</span></span><input id="field-memberDob" type="date" className={controlClassName("memberDob", "Date of Birth")} value={textValue(payload, "memberDob")} onChange={(event) => setText("memberDob", event.target.value)} onBlur={() => markTouched("memberDob")} disabled={isPending} />{fieldError("memberDob", "Date of Birth") ? <p className="text-xs text-red-600">{fieldError("memberDob", "Date of Birth")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Gender <span className="text-red-600">*</span></span><select id="field-memberGender" className={controlClassName("memberGender", "Gender")} value={textValue(payload, "memberGender")} onChange={(event) => setText("memberGender", event.target.value)} onBlur={() => markTouched("memberGender")} disabled={isPending}><option value="">Select</option><option>Male</option><option>Female</option><option>Non-binary</option><option>Prefer not to say</option></select>{fieldError("memberGender", "Gender") ? <p className="text-xs text-red-600">{fieldError("memberGender", "Gender")}</p> : null}</label>
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Street Address <span className="text-red-600">*</span></span><input id="field-memberAddressLine1" className={controlClassName("memberAddressLine1", "Street address")} value={textValue(payload, "memberAddressLine1")} onChange={(event) => setText("memberAddressLine1", event.target.value)} onBlur={() => markTouched("memberAddressLine1")} disabled={isPending} />{fieldError("memberAddressLine1", "Street address") ? <p className="text-xs text-red-600">{fieldError("memberAddressLine1", "Street address")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">City / Town <span className="text-red-600">*</span></span><input id="field-memberCity" className={controlClassName("memberCity", "City / Town")} value={textValue(payload, "memberCity")} onChange={(event) => setText("memberCity", event.target.value)} onBlur={() => markTouched("memberCity")} disabled={isPending} />{fieldError("memberCity", "City / Town") ? <p className="text-xs text-red-600">{fieldError("memberCity", "City / Town")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">State <span className="text-red-600">*</span></span><input id="field-memberState" className={controlClassName("memberState", "State")} value={textValue(payload, "memberState")} onChange={(event) => setText("memberState", event.target.value)} onBlur={() => markTouched("memberState")} disabled={isPending} />{fieldError("memberState", "State") ? <p className="text-xs text-red-600">{fieldError("memberState", "State")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">ZIP Code <span className="text-red-600">*</span></span><input id="field-memberZip" className={controlClassName("memberZip", "ZIP Code")} value={textValue(payload, "memberZip")} onChange={(event) => setText("memberZip", event.target.value)} onBlur={() => markTouched("memberZip")} disabled={isPending} />{fieldError("memberZip", "ZIP Code") ? <p className="text-xs text-red-600">{fieldError("memberZip", "ZIP Code")}</p> : null}</label>
        </div>
      </Section>

      <Section title="2. Primary Contact">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Name <span className="text-red-600">*</span></span><input id="field-primaryContactName" className={controlClassName("primaryContactName", "Primary contact name")} value={textValue(payload, "primaryContactName")} onChange={(event) => setText("primaryContactName", event.target.value)} onBlur={() => markTouched("primaryContactName")} disabled={isPending} />{fieldError("primaryContactName", "Primary contact name") ? <p className="text-xs text-red-600">{fieldError("primaryContactName", "Primary contact name")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Relationship <span className="text-red-600">*</span></span><input id="field-primaryContactRelationship" className={controlClassName("primaryContactRelationship", "Primary contact relationship")} value={textValue(payload, "primaryContactRelationship")} onChange={(event) => setText("primaryContactRelationship", event.target.value)} onBlur={() => markTouched("primaryContactRelationship")} disabled={isPending} />{fieldError("primaryContactRelationship", "Primary contact relationship") ? <p className="text-xs text-red-600">{fieldError("primaryContactRelationship", "Primary contact relationship")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Phone <span className="text-red-600">*</span></span><input id="field-primaryContactPhone" className={controlClassName("primaryContactPhone", "Primary contact phone")} value={textValue(payload, "primaryContactPhone")} onChange={(event) => setText("primaryContactPhone", formatPhoneInput(event.target.value))} onBlur={() => markTouched("primaryContactPhone")} disabled={isPending} />{fieldError("primaryContactPhone", "Primary contact phone") ? <p className="text-xs text-red-600">{fieldError("primaryContactPhone", "Primary contact phone")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Email <span className="text-red-600">*</span></span><input id="field-primaryContactEmail" type="email" className={controlClassName("primaryContactEmail", "Primary contact email")} value={textValue(payload, "primaryContactEmail")} onChange={(event) => setText("primaryContactEmail", event.target.value)} onBlur={() => markTouched("primaryContactEmail")} disabled={isPending} />{fieldError("primaryContactEmail", "Primary contact email") ? <p className="text-xs text-red-600">{fieldError("primaryContactEmail", "Primary contact email")}</p> : null}</label>
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Street Address <span className="text-red-600">*</span></span><input id="field-primaryContactAddressLine1" className={controlClassName("primaryContactAddressLine1", "Primary contact street address")} value={textValue(payload, "primaryContactAddressLine1")} onChange={(event) => setText("primaryContactAddressLine1", event.target.value)} onBlur={() => markTouched("primaryContactAddressLine1")} disabled={isPending} />{fieldError("primaryContactAddressLine1", "Primary contact street address") ? <p className="text-xs text-red-600">{fieldError("primaryContactAddressLine1", "Primary contact street address")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">City / Town <span className="text-red-600">*</span></span><input id="field-primaryContactCity" className={controlClassName("primaryContactCity", "Primary contact city/town")} value={textValue(payload, "primaryContactCity")} onChange={(event) => setText("primaryContactCity", event.target.value)} onBlur={() => markTouched("primaryContactCity")} disabled={isPending} />{fieldError("primaryContactCity", "Primary contact city/town") ? <p className="text-xs text-red-600">{fieldError("primaryContactCity", "Primary contact city/town")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">State <span className="text-red-600">*</span></span><input id="field-primaryContactState" className={controlClassName("primaryContactState", "Primary contact state")} value={textValue(payload, "primaryContactState")} onChange={(event) => setText("primaryContactState", event.target.value)} onBlur={() => markTouched("primaryContactState")} disabled={isPending} />{fieldError("primaryContactState", "Primary contact state") ? <p className="text-xs text-red-600">{fieldError("primaryContactState", "Primary contact state")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">ZIP Code <span className="text-red-600">*</span></span><input id="field-primaryContactZip" className={controlClassName("primaryContactZip", "Primary contact ZIP code")} value={textValue(payload, "primaryContactZip")} onChange={(event) => setText("primaryContactZip", event.target.value)} onBlur={() => markTouched("primaryContactZip")} disabled={isPending} />{fieldError("primaryContactZip", "Primary contact ZIP code") ? <p className="text-xs text-red-600">{fieldError("primaryContactZip", "Primary contact ZIP code")}</p> : null}</label>
        </div>
      </Section>

      <Section title="3. Secondary Contact">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Name <span className="text-red-600">*</span></span><input id="field-secondaryContactName" className={controlClassName("secondaryContactName", "Secondary contact name")} value={textValue(payload, "secondaryContactName")} onChange={(event) => setText("secondaryContactName", event.target.value)} onBlur={() => markTouched("secondaryContactName")} disabled={isPending} />{fieldError("secondaryContactName", "Secondary contact name") ? <p className="text-xs text-red-600">{fieldError("secondaryContactName", "Secondary contact name")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Relationship <span className="text-red-600">*</span></span><input id="field-secondaryContactRelationship" className={controlClassName("secondaryContactRelationship", "Secondary contact relationship")} value={textValue(payload, "secondaryContactRelationship")} onChange={(event) => setText("secondaryContactRelationship", event.target.value)} onBlur={() => markTouched("secondaryContactRelationship")} disabled={isPending} />{fieldError("secondaryContactRelationship", "Secondary contact relationship") ? <p className="text-xs text-red-600">{fieldError("secondaryContactRelationship", "Secondary contact relationship")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Phone <span className="text-red-600">*</span></span><input id="field-secondaryContactPhone" className={controlClassName("secondaryContactPhone", "Secondary contact phone")} value={textValue(payload, "secondaryContactPhone")} onChange={(event) => setText("secondaryContactPhone", formatPhoneInput(event.target.value))} onBlur={() => markTouched("secondaryContactPhone")} disabled={isPending} />{fieldError("secondaryContactPhone", "Secondary contact phone") ? <p className="text-xs text-red-600">{fieldError("secondaryContactPhone", "Secondary contact phone")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Email <span className="text-red-600">*</span></span><input id="field-secondaryContactEmail" type="email" className={controlClassName("secondaryContactEmail", "Secondary contact email")} value={textValue(payload, "secondaryContactEmail")} onChange={(event) => setText("secondaryContactEmail", event.target.value)} onBlur={() => markTouched("secondaryContactEmail")} disabled={isPending} />{fieldError("secondaryContactEmail", "Secondary contact email") ? <p className="text-xs text-red-600">{fieldError("secondaryContactEmail", "Secondary contact email")}</p> : null}</label>
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Street Address <span className="text-red-600">*</span></span><input id="field-secondaryContactAddressLine1" className={controlClassName("secondaryContactAddressLine1", "Secondary contact street address")} value={textValue(payload, "secondaryContactAddressLine1")} onChange={(event) => setText("secondaryContactAddressLine1", event.target.value)} onBlur={() => markTouched("secondaryContactAddressLine1")} disabled={isPending} />{fieldError("secondaryContactAddressLine1", "Secondary contact street address") ? <p className="text-xs text-red-600">{fieldError("secondaryContactAddressLine1", "Secondary contact street address")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">City / Town <span className="text-red-600">*</span></span><input id="field-secondaryContactCity" className={controlClassName("secondaryContactCity", "Secondary contact city/town")} value={textValue(payload, "secondaryContactCity")} onChange={(event) => setText("secondaryContactCity", event.target.value)} onBlur={() => markTouched("secondaryContactCity")} disabled={isPending} />{fieldError("secondaryContactCity", "Secondary contact city/town") ? <p className="text-xs text-red-600">{fieldError("secondaryContactCity", "Secondary contact city/town")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">State <span className="text-red-600">*</span></span><input id="field-secondaryContactState" className={controlClassName("secondaryContactState", "Secondary contact state")} value={textValue(payload, "secondaryContactState")} onChange={(event) => setText("secondaryContactState", event.target.value)} onBlur={() => markTouched("secondaryContactState")} disabled={isPending} />{fieldError("secondaryContactState", "Secondary contact state") ? <p className="text-xs text-red-600">{fieldError("secondaryContactState", "Secondary contact state")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">ZIP Code <span className="text-red-600">*</span></span><input id="field-secondaryContactZip" className={controlClassName("secondaryContactZip", "Secondary contact ZIP code")} value={textValue(payload, "secondaryContactZip")} onChange={(event) => setText("secondaryContactZip", event.target.value)} onBlur={() => markTouched("secondaryContactZip")} disabled={isPending} />{fieldError("secondaryContactZip", "Secondary contact ZIP code") ? <p className="text-xs text-red-600">{fieldError("secondaryContactZip", "Secondary contact ZIP code")}</p> : null}</label>
        </div>
      </Section>

      <Section title="4. Living Situation">
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
          {ENROLLMENT_PACKET_LIVING_SITUATION_OPTIONS.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "livingSituationOptions").includes(option)} onChange={(event) => toggleArray("livingSituationOptions", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <p className="text-xs font-semibold text-muted">Pets</p>
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-3">
          {["Dogs", "Cats", "Other"].map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "petTypes").includes(option)} onChange={(event) => toggleArray("petTypes", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
        {arrayValue(payload, "petTypes").length > 0 ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pet names</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "petNames")} onChange={(event) => setText("petNames", event.target.value)} disabled={isPending} /></label> : null}
      </Section>

      <Section title="5. Medical Information">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Referred by</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "referredBy")} onChange={(event) => setText("referredBy", event.target.value)} disabled={isPending} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">VA Benefits</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "vaBenefits")} onChange={(event) => setText("vaBenefits", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "vaBenefits") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Tricare Number</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "tricareNumber")} onChange={(event) => setText("tricareNumber", event.target.value)} disabled={isPending} /></label> : null}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Medication Needed During the Day</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "medicationNeededDuringDay")} onChange={(event) => setText("medicationNeededDuringDay", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "medicationNeededDuringDay") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Medication Names</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "medicationNamesDuringDay")} onChange={(event) => setText("medicationNamesDuringDay", event.target.value)} disabled={isPending} /></label> : null}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Uses Oxygen Daily</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "oxygenUse")} onChange={(event) => setText("oxygenUse", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "oxygenUse") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Oxygen Flow Rate</span><input className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "oxygenFlowRate")} onChange={(event) => setText("oxygenFlowRate", event.target.value)} disabled={isPending} /></label> : null}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">History of Falls</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "fallsHistory")} onChange={(event) => setText("fallsHistory", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "fallsHistory") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Any falls within the last 3 months?</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "fallsWithinLast3Months")} onChange={(event) => setText("fallsWithinLast3Months", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label> : null}
        </div>
      </Section>

      <Section title="6. Functional Status / ADLs">
        <div className="grid gap-3 md:grid-cols-2">
          {(
            [
              "adlMobilityLevel",
              "adlTransferLevel",
              "adlToiletingLevel",
              "adlBathingLevel",
              "adlDressingLevel",
              "adlEatingLevel"
            ] as EnrollmentPacketIntakeTextKey[]
          ).map((key) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">{ADL_FIELD_LABELS[key]}</span>
              <select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, key)} onChange={(event) => setText(key, event.target.value)} disabled={isPending}><option value="">Select</option>{(ADL_FIELD_OPTIONS[key] ?? []).map((option) => <option key={option}>{option}</option>)}</select>
            </label>
          ))}
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Does the participant wear dentures?</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "dentures")} onChange={(event) => setText("dentures", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Hearing</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "hearingStatus")} onChange={(event) => setText("hearingStatus", event.target.value)} disabled={isPending}><option value="">Select</option><option>Normal hearing</option><option>Hearing aids</option></select></label>
        </div>
        {textValue(payload, "dentures") === "Yes" ? (
          <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
            {["Upper", "Lower"].map((option) => (
              <label key={option} className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={arrayValue(payload, "dentureTypes").includes(option)} onChange={(event) => toggleArray("dentureTypes", option, event.target.checked)} disabled={isPending} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        ) : null}
        <p className="text-xs font-semibold text-muted">Continence Status</p>
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
          {ENROLLMENT_PACKET_CONTINENCE_OPTIONS.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "continenceSelections").includes(option)} onChange={(event) => toggleArray("continenceSelections", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="7. Behavioral & Cognitive Status">
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
          {ENROLLMENT_PACKET_BEHAVIORAL_OPTIONS.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "behavioralObservations").includes(option)} onChange={(event) => toggleArray("behavioralObservations", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Memory stage</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "memoryStage")} onChange={(event) => setText("memoryStage", event.target.value)} disabled={isPending}><option value="">Select</option><option>No Cognitive Impairment</option><option>Mild</option><option>Moderate</option><option>Severe</option></select></label>
      </Section>
      <Section title="8. Recreation Interests">
        <div className="grid gap-2 rounded-lg border border-border bg-slate-50 p-3 sm:grid-cols-2">
          {ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS.map((option) => (
            <label key={option} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={arrayValue(payload, "recreationalInterests").includes(option)} onChange={(event) => toggleArray("recreationalInterests", option, event.target.checked)} disabled={isPending} />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="9. Veteran Status">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Is the participant a veteran?</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "veteranStatus")} onChange={(event) => setText("veteranStatus", event.target.value)} disabled={isPending}><option value="">Select</option><option>Yes</option><option>No</option></select></label>
          {textValue(payload, "veteranStatus") === "Yes" ? <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Veteran service branch</span><select className="h-11 w-full rounded-lg border border-border px-3" value={textValue(payload, "branchOfService")} onChange={(event) => setText("branchOfService", event.target.value)} disabled={isPending}><option value="">Select</option>{ENROLLMENT_PACKET_VETERAN_BRANCH_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label> : null}
        </div>
      </Section>

      <Section title="10. PCP & Pharmacy">
        <p className="text-sm text-muted">Please provide both pharmacy name and pharmacy address.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">PCP Name <span className="text-red-600">*</span></span><input id="field-pcpName" className={controlClassName("pcpName", "PCP name")} value={textValue(payload, "pcpName")} onChange={(event) => setText("pcpName", event.target.value)} onBlur={() => markTouched("pcpName")} disabled={isPending} />{fieldError("pcpName", "PCP name") ? <p className="text-xs text-red-600">{fieldError("pcpName", "PCP name")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">PCP Address <span className="text-red-600">*</span></span><input id="field-pcpAddress" className={controlClassName("pcpAddress", "PCP address")} value={textValue(payload, "pcpAddress")} onChange={(event) => setText("pcpAddress", event.target.value)} onBlur={() => markTouched("pcpAddress")} disabled={isPending} />{fieldError("pcpAddress", "PCP address") ? <p className="text-xs text-red-600">{fieldError("pcpAddress", "PCP address")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">PCP Phone <span className="text-red-600">*</span></span><input id="field-pcpPhone" className={controlClassName("pcpPhone", "PCP phone")} value={textValue(payload, "pcpPhone")} onChange={(event) => setText("pcpPhone", formatPhoneInput(event.target.value))} onBlur={() => markTouched("pcpPhone")} disabled={isPending} />{fieldError("pcpPhone", "PCP phone") ? <p className="text-xs text-red-600">{fieldError("pcpPhone", "PCP phone")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pharmacy Name <span className="text-red-600">*</span></span><input id="field-pharmacy" className={controlClassName("pharmacy", "Pharmacy name")} value={textValue(payload, "pharmacy")} onChange={(event) => setText("pharmacy", event.target.value)} onBlur={() => markTouched("pharmacy")} disabled={isPending} />{fieldError("pharmacy", "Pharmacy name") ? <p className="text-xs text-red-600">{fieldError("pharmacy", "Pharmacy name")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pharmacy Address <span className="text-red-600">*</span></span><input id="field-pharmacyAddress" className={controlClassName("pharmacyAddress", "Pharmacy address")} value={textValue(payload, "pharmacyAddress")} onChange={(event) => setText("pharmacyAddress", event.target.value)} onBlur={() => markTouched("pharmacyAddress")} disabled={isPending} />{fieldError("pharmacyAddress", "Pharmacy address") ? <p className="text-xs text-red-600">{fieldError("pharmacyAddress", "Pharmacy address")}</p> : null}</label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Pharmacy Phone <span className="text-red-600">*</span></span><input id="field-pharmacyPhone" className={controlClassName("pharmacyPhone", "Pharmacy phone")} value={textValue(payload, "pharmacyPhone")} onChange={(event) => setText("pharmacyPhone", formatPhoneInput(event.target.value))} onBlur={() => markTouched("pharmacyPhone")} disabled={isPending} />{fieldError("pharmacyPhone", "Pharmacy phone") ? <p className="text-xs text-red-600">{fieldError("pharmacyPhone", "Pharmacy phone")}</p> : null}</label>
        </div>
      </Section>

      <EnrollmentPacketPublicFormAgreements
        payload={payload}
        isPending={isPending}
        uploads={uploads}
        setUploads={setUploads}
        markTouched={markTouched}
        fieldError={fieldError}
        controlClassName={controlClassName}
        setText={setText}
      />

      <EnrollmentPacketPublicFormLegal
        payload={payload}
        completion={completion}
        isPending={isPending}
        caregiverTypedName={caregiverTypedName}
        setCaregiverTypedName={setCaregiverTypedName}
        submitAttempted={submitAttempted}
        hasSignature={hasSignature}
        attested={attested}
        setAttested={setAttested}
        expandedLegalSections={expandedLegalSections}
        setExpandedLegalSection={setExpandedLegalSection}
        setText={setText}
        setAck={setAck}
        markTouched={markTouched}
        fieldError={fieldError}
        controlClassName={controlClassName}
        scrollToFirstMissingField={scrollToFirstMissingField}
        canvasRef={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        clearSignature={clearSignature}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold" onClick={saveProgress} disabled={isPending}>{isPending ? "Saving..." : "Save Progress"}</button>
        {completion.isComplete ? <button type="button" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white" onClick={submitPacket} disabled={isPending}>{isPending ? "Submitting..." : "Sign and Submit Packet"}</button> : null}
      </div>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
