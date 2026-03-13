"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { sendEnrollmentPacketAction } from "@/app/sales-actions";
import { Button } from "@/components/ui/button";

const WEEKDAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

type LeadOption = {
  id: string;
  memberName: string;
  caregiverEmail: string | null;
  linkedMemberId: string | null;
};

type MemberOption = {
  id: string;
  displayName: string;
};

export function SalesEnrollmentPacketStandaloneAction({
  leads,
  members
}: {
  leads: LeadOption[];
  members: MemberOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [leadId, setLeadId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [caregiverEmail, setCaregiverEmail] = useState("");
  const [requestedDays, setRequestedDays] = useState<string[]>(["Monday", "Wednesday", "Friday"]);
  const [transportation, setTransportation] = useState("Door to Door");
  const [communityFee, setCommunityFee] = useState("0");
  const [dailyRate, setDailyRate] = useState("0");
  const [optionalMessage, setOptionalMessage] = useState("");
  const router = useRouter();

  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead] as const)), [leads]);

  const toggleRequestedDay = (day: string) => {
    setRequestedDays((current) => {
      if (current.includes(day)) {
        return current.filter((item) => item !== day);
      }
      return [...current, day];
    });
  };

  const onLeadChange = (nextLeadId: string) => {
    setLeadId(nextLeadId);
    const nextLead = leadById.get(nextLeadId);
    setCaregiverEmail(nextLead?.caregiverEmail ?? "");
    if (nextLead?.linkedMemberId) {
      setMemberId(nextLead.linkedMemberId);
    }
  };

  const onSend = () => {
    if (requestedDays.length === 0) {
      setStatus("Select at least one requested day.");
      return;
    }
    const parsedCommunityFee = Number(communityFee);
    const parsedDailyRate = Number(dailyRate);
    if (!Number.isFinite(parsedCommunityFee) || parsedCommunityFee < 0) {
      setStatus("Community fee must be 0 or greater.");
      return;
    }
    if (!Number.isFinite(parsedDailyRate) || parsedDailyRate < 0) {
      setStatus("Daily rate must be 0 or greater.");
      return;
    }

    setStatus(null);
    startTransition(async () => {
      const result = await sendEnrollmentPacketAction({
        leadId,
        memberId,
        caregiverEmail,
        requestedDays,
        transportation,
        communityFee: parsedCommunityFee,
        dailyRate: parsedDailyRate,
        optionalMessage
      });
      if (!result.ok) {
        setStatus(result.error);
        if ("redirectTo" in result && result.redirectTo) {
          router.push(result.redirectTo);
        }
        return;
      }
      setStatus("Enrollment packet sent.");
      setIsOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => setIsOpen(true)} disabled={isPending}>
        Send Enrollment Packet
      </Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}

      {isOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[95vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold">Send Enrollment Packet (Sales)</h3>
            <p className="mt-1 text-sm text-muted">
              Select a lead/member context and provide packet values before sending.
            </p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Lead (Optional)</span>
                <select
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={leadId}
                  onChange={(event) => onLeadChange(event.target.value)}
                  disabled={isPending}
                >
                  <option value="">Standalone (no lead)</option>
                  {leads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.memberName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Member</span>
                <select
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={memberId}
                  onChange={(event) => setMemberId(event.target.value)}
                  disabled={isPending}
                >
                  <option value="">Select member</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-semibold text-muted">Caregiver Email</span>
                <input
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={caregiverEmail}
                  onChange={(event) => setCaregiverEmail(event.target.value)}
                  disabled={isPending}
                />
              </label>

              <div className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-semibold text-muted">Requested Days</span>
                <div className="flex flex-wrap gap-2 rounded-lg border border-border p-2">
                  {WEEKDAY_OPTIONS.map((day) => (
                    <label key={day} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={requestedDays.includes(day)}
                        onChange={() => toggleRequestedDay(day)}
                        disabled={isPending}
                      />
                      <span>{day}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Transportation</span>
                <select
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={transportation}
                  onChange={(event) => setTransportation(event.target.value)}
                  disabled={isPending}
                >
                  <option value="Door to Door">Door to Door</option>
                  <option value="Bus Stop">Bus Stop</option>
                  <option value="No Transportation">No Transportation</option>
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Community Fee</span>
                <input
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={communityFee}
                  onChange={(event) => setCommunityFee(event.target.value)}
                  disabled={isPending}
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Daily Rate</span>
                <input
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={dailyRate}
                  onChange={(event) => setDailyRate(event.target.value)}
                  disabled={isPending}
                />
              </label>

              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-semibold text-muted">Optional Message</span>
                <textarea
                  className="min-h-[90px] w-full rounded-lg border border-border px-3 py-2"
                  value={optionalMessage}
                  onChange={(event) => setOptionalMessage(event.target.value)}
                  disabled={isPending}
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
                onClick={onSend}
                disabled={isPending}
              >
                {isPending ? "Sending..." : "Send Packet"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
