import type React from "react";
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Memory Lane",
  description: "Town Square Fort Mill"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const devSchemaSyncMessage =
    process.env.NODE_ENV === "production"
      ? null
      : (await import("@/lib/dev/schema-sync-health")).getDevSchemaSyncMessage();

  return (
    <html lang="en">
      <body>
        {devSchemaSyncMessage ? (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {devSchemaSyncMessage}
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
