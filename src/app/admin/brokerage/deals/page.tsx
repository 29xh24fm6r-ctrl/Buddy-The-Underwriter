import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { loadLastEvents } from "../_components/loadLastEvents";
import { StuckTable, type StuckRow } from "../_components/StuckTable";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set(["brokerage_anonymous", "brokerage_claimed"]);

export default async function BrokerageDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ origin?: string }>;
}) {
  const sp = await searchParams;
  const origin = sp.origin && ALLOWED_ORIGINS.has(sp.origin)
    ? sp.origin
    : "brokerage_anonymous";

  let brokerageBankId: string | null = null;
  let tenantError: string | null = null;
  try {
    brokerageBankId = await getBrokerageBankId();
  } catch (e) {
    tenantError = (e as Error)?.message ?? String(e);
  }

  const sb = supabaseAdmin();
  const { data: deals, error } = brokerageBankId
    ? await sb
        .from("deals")
        .select("id, display_name, borrower_email, created_at")
        .eq("bank_id", brokerageBankId)
        .eq("origin", origin)
        .order("created_at", { ascending: true })
        .limit(50)
    : { data: null, error: null };

  const dealList = (deals ?? []) as Array<{
    id: string;
    display_name: string | null;
    borrower_email: string | null;
    created_at: string;
  }>;

  const lastEvents = await loadLastEvents(dealList.map((d) => d.id));
  const now = new Date().valueOf();

  const rows: StuckRow[] = dealList.map((d) => {
    const created = new Date(d.created_at).getTime();
    return {
      id: d.id,
      display_name: d.display_name,
      age_iso: d.created_at,
      age_seconds: Math.max(0, Math.floor((now - created) / 1000)),
      last_event_action: lastEvents.get(d.id) ?? null,
    };
  });

  const otherOrigin =
    origin === "brokerage_anonymous" ? "brokerage_claimed" : "brokerage_anonymous";

  return (
    <main className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Brokerage deals — <code className="text-base">{origin}</code>
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Oldest first, capped at 50. Click the deal id for cockpit access.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href={`/admin/brokerage/deals?origin=${otherOrigin}`}
            className="underline"
          >
            {otherOrigin}
          </Link>
          <Link href="/admin/brokerage/listings" className="underline">
            Back to overview
          </Link>
        </div>
      </header>

      {tenantError && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          Tenant: {tenantError}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          {error.message}
        </div>
      )}

      <StuckTable rows={rows} emptyLabel={`No ${origin} deals.`} />
    </main>
  );
}
