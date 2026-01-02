import Link from "next/link";

function clerkConfigured() {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  if (!pk) return false;
  if (pk.includes("placeholder")) return false;
  if (pk === "pk_test_placeholder") return false;
  return true;
}

export default function ContactPage() {
  const clerkOk = clerkConfigured();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
      <p className="mt-4 text-sm opacity-80">
        Questions, demos, partnerships — we'd love to talk.
      </p>

      <div className="mt-8 space-y-4 rounded-xl border p-6">
        <div>
          <div className="text-sm font-medium">Email</div>
          <div className="text-sm opacity-80">
            support@buddy.ai (replace with your real inbox)
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Schedule</div>
          <div className="text-sm opacity-80">
            Book a demo and we'll walk through Buddy's Loan Ops OS.
          </div>
        </div>

        <div className="pt-2">
          {clerkOk ? (
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Sign in to message us
            </Link>
          ) : (
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Back to home
            </Link>
          )}
        </div>

        {!clerkOk && (
          <p className="text-xs opacity-70">
            Auth is disabled in CI builds (placeholder Clerk keys). This page is
            intentionally prerender-safe.
          </p>
        )}
      </div>
    </main>
  );
}
