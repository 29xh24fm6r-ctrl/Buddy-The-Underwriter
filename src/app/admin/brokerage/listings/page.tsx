import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const STATUSES = [
  "pending_preview",
  "previewing",
  "claiming",
  "awaiting_borrower_pick",
  "picked",
  "expired",
  "relisted",
] as const;

type Listing = {
  id: string;
  deal_id: string;
  status: string;
  sba_program: string;
  loan_amount: number;
  score: number;
  band: string;
  preview_opens_at: string;
  claim_opens_at: string;
  claim_closes_at: string;
  matched_lender_bank_ids: string[];
};

export default async function AdminBrokerageListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const sb = supabaseAdmin();

  const status = sp.status && STATUSES.includes(sp.status as any) ? sp.status : null;

  let query = sb
    .from("marketplace_listings")
    .select(
      "id, deal_id, status, sba_program, loan_amount, score, band, preview_opens_at, claim_opens_at, claim_closes_at, matched_lender_bank_ids",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) query = query.eq("status", status);

  const { data: listings, error } = await query;

  return (
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Marketplace listings</h1>
        <p className="text-sm text-neutral-400 mt-1">
          All sealed packages currently on the brokerage marketplace.
        </p>
      </header>

      <div className="mb-4 flex gap-2 text-xs flex-wrap">
        <a
          href="/admin/brokerage/listings"
          className={`px-3 py-1 rounded border ${!status ? "border-blue-500 text-blue-400" : "border-neutral-700"}`}
        >
          All
        </a>
        {STATUSES.map((s) => (
          <a
            key={s}
            href={`/admin/brokerage/listings?status=${s}`}
            className={`px-3 py-1 rounded border ${status === s ? "border-blue-500 text-blue-400" : "border-neutral-700"}`}
          >
            {s}
          </a>
        ))}
      </div>

      {error && (
        <div className="text-red-400 text-sm mb-4">Error: {error.message}</div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-neutral-400 border-b border-neutral-800">
            <th className="py-2 pr-4">Deal</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Program</th>
            <th className="py-2 pr-4">Amount</th>
            <th className="py-2 pr-4">Score</th>
            <th className="py-2 pr-4">Band</th>
            <th className="py-2 pr-4">Matched</th>
            <th className="py-2 pr-4">Preview opens</th>
            <th className="py-2 pr-4">Claim closes</th>
          </tr>
        </thead>
        <tbody>
          {(listings ?? []).map((l: Listing) => (
            <tr key={l.id} className="border-b border-neutral-900">
              <td className="py-2 pr-4 font-mono text-xs">
                {l.deal_id.slice(0, 8)}
              </td>
              <td className="py-2 pr-4">{l.status}</td>
              <td className="py-2 pr-4 uppercase">{l.sba_program}</td>
              <td className="py-2 pr-4">${Number(l.loan_amount).toLocaleString()}</td>
              <td className="py-2 pr-4">{l.score}</td>
              <td className="py-2 pr-4">{l.band}</td>
              <td className="py-2 pr-4">{l.matched_lender_bank_ids?.length ?? 0}</td>
              <td className="py-2 pr-4 text-neutral-400">
                {new Date(l.preview_opens_at).toLocaleString()}
              </td>
              <td className="py-2 pr-4 text-neutral-400">
                {new Date(l.claim_closes_at).toLocaleString()}
              </td>
            </tr>
          ))}
          {(listings ?? []).length === 0 && (
            <tr>
              <td colSpan={9} className="py-8 text-center text-neutral-500">
                No listings.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
