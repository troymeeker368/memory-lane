const MAX_US_PHONE_DIGITS = 10;

function getDigits(value: string | null | undefined) {
  const rawDigits = String(value ?? "").replace(/\D/g, "");
  if (rawDigits.length === 11 && rawDigits.startsWith("1")) {
    return rawDigits.slice(1);
  }
  return rawDigits;
}

function format10DigitPhone(digits: string) {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function formatPhoneInput(value: string | null | undefined): string {
  const digits = getDigits(value).slice(0, MAX_US_PHONE_DIGITS);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return format10DigitPhone(digits);
}

export function normalizePhoneForStorage(value: string | null | undefined): string | null {
  const digits = getDigits(value).slice(0, MAX_US_PHONE_DIGITS);
  if (!digits) return null;
  return formatPhoneInput(digits);
}

export function formatPhoneDisplay(value: string | null | undefined, fallback = "-"): string {
  const formatted = formatPhoneInput(value);
  if (!formatted) return fallback;
  return formatted;
}

export function digitsOnlyPhone(value: string | null | undefined): string {
  return getDigits(value);
}
