export const DOCUMENT_CENTER_NAME = "Town Square Fort Mill";
export const DOCUMENT_CENTER_ADDRESS_LINE_1 = "368 Fort Mill Parkway, Suite 106";
export const DOCUMENT_CENTER_ADDRESS_LINE_2 = "Fort Mill, SC 29715";
export const DOCUMENT_CENTER_ADDRESS = `${DOCUMENT_CENTER_ADDRESS_LINE_1}, ${DOCUMENT_CENTER_ADDRESS_LINE_2}`;
export const DOCUMENT_CENTER_PHONE = "803-591-9898";
export const DOCUMENT_CENTER_LOGO_PUBLIC_PATH = "/TS logo_Innovative Adult Day-BLUE (2).png";
export const DOCUMENT_CENTER_LOGO_PUBLIC_URL =
  "https://dcnyjtfyftamcdsaxrsz.supabase.co/storage/v1/object/public/Assets/TS%20logo_Innovative%20Adult%20Day-BLUE%20(2).png";

export const DOCUMENT_CENTER_SIGNATURE_LINES = [
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_ADDRESS_LINE_1,
  DOCUMENT_CENTER_ADDRESS_LINE_2,
  DOCUMENT_CENTER_PHONE
] as const;

export function getDocumentCenterSignatureHtml() {
  return DOCUMENT_CENTER_SIGNATURE_LINES.map((line) => line).join("<br/>");
}

export function getDocumentCenterSignatureText() {
  return DOCUMENT_CENTER_SIGNATURE_LINES.join("\n");
}

export function buildDocumentCenterSenderHeader(senderEmail: string) {
  return `${DOCUMENT_CENTER_NAME} <${senderEmail}>`;
}
