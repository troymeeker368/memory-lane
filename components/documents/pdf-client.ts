function dataUrlToBlob(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid PDF payload.");
  }

  const meta = dataUrl.slice(0, commaIndex);
  const base64 = dataUrl.slice(commaIndex + 1);
  const mimeMatch = /data:([^;]+);base64/i.exec(meta);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function downloadBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function printBlob(blob: Blob) {
  const blobUrl = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");

  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.src = blobUrl;

  const cleanup = () => {
    frame.remove();
    URL.revokeObjectURL(blobUrl);
  };

  frame.addEventListener(
    "load",
    () => {
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        cleanup();
        return;
      }

      frameWindow.addEventListener("afterprint", cleanup, { once: true });
      frameWindow.focus();
      frameWindow.print();
      window.setTimeout(cleanup, 60000);
    },
    { once: true }
  );

  document.body.appendChild(frame);
}

async function pdfUrlToBlob(url: string) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error("Unable to load PDF.");
  }
  return await response.blob();
}

export function triggerPdfDownload(dataUrl: string, fileName: string) {
  downloadBlob(dataUrlToBlob(dataUrl), fileName);
}

export function triggerPdfPrint(dataUrl: string) {
  printBlob(dataUrlToBlob(dataUrl));
}

export async function triggerPdfDownloadFromUrl(url: string, fileName: string) {
  downloadBlob(await pdfUrlToBlob(url), fileName);
}

export async function triggerPdfPrintFromUrl(url: string) {
  printBlob(await pdfUrlToBlob(url));
}
