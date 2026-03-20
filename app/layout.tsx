import type React from "react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { DevSchemaSyncBanner } from "@/components/dev/dev-schema-sync-banner";
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
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <DevSchemaSyncBanner />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
