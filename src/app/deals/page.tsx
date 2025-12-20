// src/app/deals/page.tsx
import Link from "next/link";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const pick = await tryGetCurrentBankId();

  if (!pick.ok) {
    const reason = pick.reason;

    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <h1 className="text-3xl font-bold">Deals</h1>
        <p className="text-muted-foreground mt-2">
          {reason === "not_authenticated"
            ? "Sign in to continue."
            : reason === "multiple_memberships"
            ? "Select a bank workspace to continue."
            : reason === "no_memberships"
            ? "Create a bank or request access."
            : "We couldn't load your workspace right now."}
        </p>

        <div className="mt-6 rounded-2xl border p-5">
          <div className="text-sm font-semibold">Tenant Gate</div>
          <div className="text-sm text-muted-foreground mt-2 break-words">
            {reason === "profile_lookup_failed" ? (pick.detail ?? "profile_lookup_failed") : reason}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {reason === "not_authenticated" ? (
              <Link className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground" href="/sign-in">
                Sign in
              </Link>
            ) : reason === "multiple_memberships" ? (
              <Link className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground" href="/tenant/select">
                Select bank
              </Link>
            ) : (
              <>
                <Link className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground" href="/tenant/create">
                  Create bank
                </Link>
                <Link className="rounded-xl border px-4 py-2 text-sm font-semibold" href="/tenant/select">
                  Select bank
                </Link>
              </>
            )}

            <Link className="rounded-xl border px-4 py-2 text-sm font-semibold" href="/ops">
              Ops
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // If we get here, tenant is resolved (including auto-select)
  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Deals</h1>
          <p className="text-muted-foreground mt-1">
            Bank workspace: <span className="font-semibold">{pick.bankId}</span>
          </p>
        </div>

        <Link
          href="/deals/new"
          className="rounded-xl border px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground"
        >
          New Deal
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border p-6 text-sm text-muted-foreground">
        Deals list UI goes here (tenant-safe now).
      </div>
    </div>
  );
}
