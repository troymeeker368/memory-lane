import { Card } from "@/components/ui/card";
import { MccDemographicsForm } from "@/components/forms/mcc-demographics-form";
import { MemberCommandCenterContactManagerShell } from "@/components/forms/member-command-center-shells";
import type { MemberCommandCenterDetail } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import {
  SectionHeading,
  boolLabel
} from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { formatOptionalDate } from "@/lib/utils";

export default function MemberCommandCenterDemographicsTab({
  canEdit,
  detail,
  profileUpdatedAt,
  profileUpdatedBy,
  contactsUpdatedAt,
  contactsUpdatedBy
}: {
  canEdit: boolean;
  detail: MemberCommandCenterDetail;
  profileUpdatedAt: string | null;
  profileUpdatedBy: string | null;
  contactsUpdatedAt: string | null;
  contactsUpdatedBy: string | null;
}) {
  return (
    <div className="space-y-4">
      <Card id="demographics">
        <SectionHeading title="Demographics" lastUpdatedAt={profileUpdatedAt} lastUpdatedBy={profileUpdatedBy} />
        {canEdit ? (
          <MccDemographicsForm
            key={`mcc-demographics-${detail.member.id}-${profileUpdatedAt ?? "na"}`}
            memberId={detail.member.id}
            memberDisplayName={detail.member.display_name}
            memberDob={detail.member.dob ?? ""}
            gender={detail.profile.gender ?? ""}
            streetAddress={detail.profile.street_address ?? ""}
            city={detail.profile.city ?? detail.member.city ?? ""}
            state={detail.profile.state ?? ""}
            zip={detail.profile.zip ?? ""}
            maritalStatus={detail.profile.marital_status ?? ""}
            primaryLanguage={detail.profile.primary_language ?? ""}
            secondaryLanguage={detail.profile.secondary_language ?? ""}
            religion={detail.profile.religion ?? ""}
            ethnicity={detail.profile.ethnicity ?? ""}
            isVeteran={detail.profile.is_veteran}
            veteranBranch={detail.profile.veteran_branch ?? ""}
          />
        ) : (
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <p>Name: {detail.member.display_name}</p>
            <p>DOB: {formatOptionalDate(detail.member.dob)}</p>
            <p>Gender: {detail.profile.gender ?? "-"}</p>
            <p>Address: {[detail.profile.street_address, detail.profile.city, detail.profile.state, detail.profile.zip].filter(Boolean).join(", ") || "-"}</p>
            <p>Marital: {detail.profile.marital_status ?? "-"}</p>
            <p>Primary Language: {detail.profile.primary_language ?? "-"}</p>
            <p>Secondary Language: {detail.profile.secondary_language ?? "-"}</p>
            <p>Religion: {detail.profile.religion ?? "-"}</p>
            <p>Ethnicity: {detail.profile.ethnicity ?? "-"}</p>
            <p>Veteran: {boolLabel(detail.profile.is_veteran)}</p>
            <p>Veteran Branch: {detail.profile.veteran_branch ?? "-"}</p>
          </div>
        )}
      </Card>

      <Card id="contacts">
        <SectionHeading title="Contacts" lastUpdatedAt={contactsUpdatedAt} lastUpdatedBy={contactsUpdatedBy} />
        <div className="mt-3">
          <MemberCommandCenterContactManagerShell
            key={`mcc-contacts-${detail.member.id}-${contactsUpdatedAt ?? "na"}`}
            memberId={detail.member.id}
            rows={detail.contacts}
            canEdit={canEdit}
          />
        </div>
      </Card>
    </div>
  );
}
