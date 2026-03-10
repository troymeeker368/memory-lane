"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { enrollMemberFromLeadAction } from "@/app/sales-actions";
import { Button } from "@/components/ui/button";

type EnrollMemberResponse = {
  ok?: boolean;
  error?: string;
  leadId?: string;
  memberId?: string;
};

export function EnrollMemberAction({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const response = (await enrollMemberFromLeadAction({ leadId })) as EnrollMemberResponse;
            if (response.error) {
              setStatus(`Error: ${response.error}`);
              return;
            }

            setStatus("Lead converted to active member.");
            if (response.memberId) {
              router.push(`/members/${response.memberId}`);
            } else {
              router.refresh();
            }
          })
        }
      >
        Enroll Member
      </Button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}

