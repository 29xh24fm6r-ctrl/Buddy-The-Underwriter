import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  listing_id: string;
  deal_id: string;
  status: string;
  claimed_at: string;
  decided_at: string | null;
  decided_reason: string | null;
};

export default async function LenderClaimsPage() {
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: claims, error } = await sb
    .from("marketplace_lender_claims")
    .select(
      "id, listing_id, deal_id, status, claimed_at, decided_at, decided_reason",
    )
    .eq("lender_bank_id", bankId)
    .order("claimed_at", { ascending: false })
    .limit(100);

  return (
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Claim history</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Every claim you placed on the brokerage marketplace.
        </p>
      </header>

      {error && (
        <div className="text-red-400 text-sm mb-4">Error: {error.message}</div>
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-neutral-400 border-b border-neutral-800">
            <th className="py-2 pr-4">Claimed</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Decided</th>
            <th className="py-2 pr-4">Reason</th>
            <th className="py-2 pr-4">Deal</th>
          </tr>
        </thead>
        <tbody>
          {(claims ?? []).map((c: Row) => (
            <tr key={c.id} className="border-b border-neutral-900">
              <td className="py-2 pr-4 text-neutral-400">
                {new Date(c.claimed_at).toLocaleString()}
              </td>
              <td className="py-2 pr-4">
                <StatusPill status={c.status} />
              </td>
              <td className="py-2 pr-4 text-neutral-400">
                {c.decided_at ? new Date(c.decided_at).toLocaleString() : "—"}
              </td>
              <td className="py-2 pr-4 text-neutral-400">
                {c.decided_reason ?? "—"}
              </td>
              <td className="py-2 pr-4">
                {c.status === "won" ? (
                  <Link
                    href={`/lender/deals/${c.deal_id}`}
                    className="underline text-blue-400"
                  >
                    Open deal
                  </Link>
                ) : (
                  <span className="font-mono text-xs text-neutral-500">
                    {c.deal_id.slice(0, 8)}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {(claims ?? []).length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-neutral-500">
                No claims yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const color: Record<string, string> = {
    claimed: "bg-blue-800/40 text-blue-300",
    won: "bg-green-800/40 text-green-300",
    lost: "bg-neutral-800 text-neutral-400",
    relinquished: "bg-yellow-800/40 text-yellow-300",
    declined: "bg-neutral-800 text-neutral-400",
    expired: "bg-neutral-800 text-neutral-500",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs ${color[status] ?? "bg-neutral-800"}`}
    >
      {status}
    </span>
  );
}
