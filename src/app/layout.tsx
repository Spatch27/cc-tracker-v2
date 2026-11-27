import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Committed Citizens — Opportunity Tracker",
  description:
    "Two-founder workspace for CMO Breakfasts, Gold-list account intelligence, and governed outreach.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clerkReady = isClerkConfigured();

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {clerkReady ? <ClerkProvider>{children}</ClerkProvider> : children}
      </body>
    </html>
  );
}
