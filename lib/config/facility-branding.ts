function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

const DEFAULT_FACILITY_LOGO_URL =
  "https://dcnyjtfyftamcdsaxrsz.supabase.co/storage/v1/object/public/Assets/TS%20logo_Innovative%20Adult%20Day-BLUE%20(2).png";

export const facilityBranding = {
  facilityName: "Town Square Fort Mill",
  facilityAddress: "368 Fort Mill Parkway, Suite 106, Fort Mill, SC 29715",
  facilityPhone: "803-591-9898",
  facilityLogoUrl: process.env.FACILITY_LOGO_URL
} as const;

export function resolveFacilityLogoUrl() {
  const configured = clean(facilityBranding.facilityLogoUrl);
  if (configured && /^https:\/\//i.test(configured)) return configured;
  return DEFAULT_FACILITY_LOGO_URL;
}

export function getFacilitySignatureLines() {
  const [addressLine1, ...rest] = facilityBranding.facilityAddress.split(",");
  const addressLine2 = rest.join(",").trim();
  return [facilityBranding.facilityName, addressLine1?.trim() ?? "", addressLine2, facilityBranding.facilityPhone].filter(
    Boolean
  );
}
