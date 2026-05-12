import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

type Listing = {
  id: string;
  deal_id: string;
  status: string;
  sba_program: string;
  loan_amount: number;
  term_months: number;
  score: number;
  band: string;
  published_rate_bps: number;
  kfs: Record<string, unknown>;
  preview_opens_at: string;
  claim_opens_at: string;
  claim_closes_at: string;
  matched_lender_bank_ids: string[];
};

export default async function LenderListingsPage() {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: listings, error } = await sb
    .from("marketplace_listings")
    .select(
      "id, deal_id, status, sba_program, loan_amount, term_months, score, band, published_rate_bps, kfs, preview_opens_at, claim_opens_at, claim_closes_at, matched_lender_bank_ids",
    )
    .in("status", ["previewing", "claiming", "awaiting_borrower_pick"])
    .contains("matched_lender_bank_ids", [bankId])
    .order("preview_opens_at", { ascending: false })
    .limit(50);

  const { data: myClaims } = await sb
    .from("marketplace_lender_claims")
    .select("listing_id, status")
    .eq("lender_bank_id", bankId);

  const claimMap = new Map<string, string>();
  (myClaims ?? []).forEach((c) => claimMap.set(c.listing_id, c.status));

  return (
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Marketplace queue</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Sealed deals matched to your programs. Up to 3 lenders can claim each
          deal. The borrower picks the winner.
        </p>
      </header>

      {error && (
        <div className="text-red-400 text-sm mb-4">Error: {error.message}</div>
      )}

      <div className="space-y-4">
        {(listings ?? []).map((l: Listing) => {
          const myStatus = claimMap.get(l.id);
          const canClaim =
            l.status === "claiming" &&
            new Date(l.claim_opens_at) <= new Date() &&
            new Date(l.claim_closes_at) >= new Date() &&
            !myStatus;
          return (
            <article
              key={l.id}
              className="rounded-md border border-neutral-800 bg-neutral-900 p-5"
            >
              <header className="flex items-baseline justify-between mb-3">
                <div>
                  <span className="text-xs uppercase tracking-wide text-neutral-400">
                    {l.sba_program} · {l.band}
                  </span>
                  <h2 className="text-lg font-medium">
                    ${Number(l.loan_amount).toLocaleString()} · {l.term_months}{" "}
                    months
                  </h2>
                </div>
                <div className="text-right text-xs text-neutral-400">
                  <div>score {l.score}</div>
                  <div>+{l.published_rate_bps} bps over prime</div>
                </div>
              </header>

              <KfsPreview kfs={l.kfs} />

              <footer className="mt-4 flex items-center gap-3 text-xs">
                <span className="text-neutral-400">
                  preview: {new Date(l.preview_opens_at).toLocaleString()} · claim
                  closes: {new Date(l.claim_closes_at).toLocaleString()}
                </span>
                <span className="ml-auto">
                  {myStatus ? (
                    <span className="px-3 py-1 rounded bg-neutral-800 text-neutral-300">
                      Your status: {myStatus}
                    </span>
                  ) : canClaim ? (
                    <ClaimButton listingId={l.id} />
                  ) : (
                    <span className="px-3 py-1 rounded bg-neutral-800 text-neutral-500">
                      {l.status === "previewing" ? "preview" : "closed"}
                    </span>
                  )}
                </span>
                {myStatus === "won" && (
                  <Link
                    href={`/lender/deals/${l.deal_id}`}
                    className="px-3 py-1 rounded bg-green-700 text-white"
                  >
                    Open deal
                  </Link>
                )}
              </footer>
            </article>
          );
        })}
        {(listings ?? []).length === 0 && (
          <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
            No matched listings right now.
          </div>
        )}
      </div>
    </main>
  );
}

function KfsPreview({ kfs }: { kfs: Record<string, unknown> }) {
  const entries = Object.entries(kfs ?? {}).slice(0, 6);
  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">No KFS available.</p>;
  }
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 py-0.5 border-b border-neutral-800/60">
          <dt className="text-neutral-400">{k}</dt>
          <dd className="text-neutral-100 truncate max-w-[60%] text-right">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ClaimButton({ listingId }: { listingId: string }) {
  return (
    <form action={`/api/lender/listings/${listingId}/claim`} method="post">
      <button
        type="submit"
        className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500"
      >
        Claim
      </button>
    </form>
  );
}
