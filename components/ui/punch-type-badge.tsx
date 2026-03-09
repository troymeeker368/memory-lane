import { cn } from "@/lib/utils";

export const CLOCK_IN_BUTTON_CLASS = "bg-[#99CC33] text-white hover:bg-[#89b82d]";
export const CLOCK_OUT_BUTTON_CLASS = "bg-[#B42318] text-white hover:bg-[#991f16]";

export function PunchTypeBadge({
  punchType,
  className
}: {
  punchType: "in" | "out";
  className?: string;
}) {
  const isIn = punchType === "in";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        isIn ? "bg-[#EAF6D7] text-[#4f7f10]" : "bg-[#FDE8E8] text-[#B42318]",
        className
      )}
    >
      {isIn ? "Clock In" : "Clock Out"}
    </span>
  );
}

export function PunchStatusBadge({ status }: { status: string }) {
  const lowered = status.toLowerCase();
  const isIn = lowered.includes("in");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        isIn ? "bg-[#EAF6D7] text-[#4f7f10]" : "bg-[#FDE8E8] text-[#B42318]"
      )}
    >
      {isIn ? "Clocked In" : "Clocked Out"}
    </span>
  );
}

