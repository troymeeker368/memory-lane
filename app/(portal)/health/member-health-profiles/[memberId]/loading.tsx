export default function MemberHealthProfileDetailLoading() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-white p-4">
        <p className="text-sm font-semibold text-brand">Loading member health profile</p>
        <p className="mt-1 text-sm text-muted">Fetching the clinical profile, related care plans, and supporting records.</p>
      </div>
    </div>
  );
}
