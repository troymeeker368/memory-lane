import Image from "next/image";

import {
  DOCUMENT_CENTER_ADDRESS,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import { cn } from "@/lib/utils";

export function DocumentBrandHeader({
  title,
  metaLines = [],
  className
}: {
  title: string;
  metaLines?: string[];
  className?: string;
}) {
  return (
    <header className={cn("border-b border-black/20 pb-3", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Image src={DOCUMENT_CENTER_LOGO_PUBLIC_PATH} alt="Town Square logo" width={132} height={42} priority />
          <div className="pt-0.5">
            <p className="text-sm font-semibold">{DOCUMENT_CENTER_NAME}</p>
            <p className="text-xs">{DOCUMENT_CENTER_ADDRESS}</p>
            <p className="text-xs">{DOCUMENT_CENTER_PHONE}</p>
          </div>
        </div>
        <div className="text-left sm:flex-1 sm:px-2 sm:text-center">
          <p className="text-xl font-bold uppercase tracking-wide">{title}</p>
        </div>
        <div className="text-left text-xs sm:w-44 sm:text-right">
          {metaLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    </header>
  );
}
