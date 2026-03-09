"use client";

import { Mail, Phone } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { createLeadQuickContactActivityAction } from "@/app/sales-actions";
import { Button } from "@/components/ui/button";

function toTelHref(phone: string | null | undefined) {
  const raw = (phone ?? "").trim();
  if (!raw) return null;

  const startsPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  return `tel:${startsPlus ? "+" : ""}${digits}`;
}

function toMailHref(email: string | null | undefined, memberName: string) {
  const raw = (email ?? "").trim();
  if (!raw) return null;

  const subject = encodeURIComponent(`Memory Lane Follow-Up: ${memberName}`);
  return `mailto:${raw}?subject=${subject}`;
}

export function LeadContactQuickActions({
  leadId,
  memberName,
  caregiverEmail,
  caregiverPhone
}: {
  leadId: string;
  memberName: string;
  caregiverEmail?: string | null;
  caregiverPhone?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const telHref = useMemo(() => toTelHref(caregiverPhone), [caregiverPhone]);
  const mailHref = useMemo(() => toMailHref(caregiverEmail, memberName), [caregiverEmail, memberName]);

  const runQuickAction = (channel: "call" | "email", launchHref: string | null) => {
    if (!launchHref) return;

    const launched = window.open(launchHref, "_blank", "noopener,noreferrer");
    if (!launched) {
      setStatus("Popup was blocked. Please allow popups for this site and try again.");
    }

    startTransition(async () => {
      const response = await createLeadQuickContactActivityAction({ leadId, channel });
      if (response.error) {
        setStatus(`Error: ${response.error}`);
      } else {
        setStatus(channel === "call" ? "Call activity logged." : "Email activity logged.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-12 min-w-[10.5rem] gap-2"
          title="Logs a lead activity and opens your default phone app."
          disabled={isPending || !telHref}
          onClick={() => runQuickAction("call", telHref)}
        >
          <Phone className="h-4 w-4" />
          Call Lead
        </Button>
        <Button
          type="button"
          className="h-12 min-w-[10.5rem] gap-2"
          title="Logs a lead activity and opens your default email app."
          disabled={isPending || !mailHref}
          onClick={() => runQuickAction("email", mailHref)}
        >
          <Mail className="h-4 w-4" />
          Email Lead
        </Button>
      </div>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
