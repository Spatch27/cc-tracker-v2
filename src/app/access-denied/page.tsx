import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { isClerkConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AccessDeniedPage() {
  const clerkReady = isClerkConfigured();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full rounded-xl border border-danger/30 bg-surface p-6 space-y-4">
        <div className="flex items-center gap-2 text-danger">
          <ShieldAlert className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Access Restricted</h1>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Your Google account is authenticated, but it is not listed in{" "}
          <code className="font-mono text-foreground">ALLOWED_FOUNDER_EMAILS</code>.
          Only Tim and Ben Scoggins are authorised to access the Committed
          Citizens Opportunity Tracker.
        </p>
        {clerkReady && (
          <SignOutButton>
            <button
              type="button"
              className="rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm font-medium hover:bg-border/40 transition-colors"
            >
              Sign out and switch Google account
            </button>
          </SignOutButton>
        )}
      </div>
    </div>
  );
}
