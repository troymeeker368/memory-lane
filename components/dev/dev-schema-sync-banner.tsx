export async function DevSchemaSyncBanner() {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const { getDevSchemaSyncMessage } = await import("@/lib/dev/schema-sync-health");
  const message = getDevSchemaSyncMessage();

  if (!message) {
    return null;
  }

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {message}
    </div>
  );
}
