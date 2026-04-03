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
      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start sm:gap-x-4 sm:gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="relative h-[42px] w-[160px] shrink-0">
            <Image
              src={DOCUMENT_CENTER_LOGO_PUBLIC_PATH}
              alt="Town Square logo"
              fill
              sizes="160px"
              className="object-contain object-left"
              priority
            />
          </div>
          <div className="min-w-0 pt-0.5 leading-5">
            <p className="text-sm font-semibold">{DOCUMENT_CENTER_NAME}</p>
            <p className="text-xs">{DOCUMENT_CENTER_ADDRESS}</p>
            <p className="text-xs">{DOCUMENT_CENTER_PHONE}</p>
          </div>
        </div>
        <div className="text-left sm:self-center sm:px-2 sm:text-center">
          <p className="text-xl font-bold uppercase tracking-wide">{title}</p>
        </div>
        <div className="text-left text-xs leading-5 sm:justify-self-end sm:text-right sm:whitespace-nowrap">
          {metaLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    </header>
  );
}
