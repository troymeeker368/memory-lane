import "server-only";

import { Buffer } from "node:buffer";

export async function asUploadedImageDataUrl(formData: FormData, key: string, fallback: string | null) {
  const file = formData.get(key);
  if (file instanceof File && file.size > 0 && file.type.startsWith("image/")) {
    const bytes = Buffer.from(await file.arrayBuffer());
    return `data:${file.type};base64,${bytes.toString("base64")}`;
  }
  return fallback;
}
