import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { isClerkConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const clerkReady = isClerkConfigured();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      {clerkReady ? (
        <div className="space-y-4 text-center">
          <div className="mb-2">
            <h1 className="text-lg font-semibold">
              Committed Citizens Opportunity Tracker
            </h1>
            <p className="text-xs text-muted mt-1">
              Restricted to allowlisted founder Google accounts.
            </p>
          </div>
          <SignIn fallbackRedirectUrl="/" />
        </div>
      ) : (
        <div className="max-w-md w-full rounded-xl border border-border bg-surface p-6 space-y-3">
          <h1 className="text-lg font-semibold">Clerk Sign-In Not Configured</h1>
          <p className="text-sm text-muted">
            Add <code className="font-mono text-foreground">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>{" "}
            and <code className="font-mono text-foreground">CLERK_SECRET_KEY</code>{" "}
            to <code className="font-mono text-foreground">.env.local</code> (or provision via{" "}
            <code className="font-mono text-foreground">vercel integration add clerk</code>).
          </p>
          <Link
            href="/"
            className="inline-block text-sm text-accent hover:underline font-medium"
          >
            Return to Overview →
          </Link>
        </div>
      )}
    </div>
  );
}
