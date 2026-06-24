import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Ops drilldown: borrower sessions started in the last 24h.
 *
 * Spec: SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.6.
 *
 * `borrower_session_tokens` stores only the hash; we list the deal_id
 * + created_at + claimed_email (if any) + age. No raw tokens are shown.
 */

type Row = {
  deal_id: string;
  created_at: string;
  last_seen_at: string;
  claimed_email: string | null;
};

export default async function BrokerageSessionsPage() {
  const sb = supabaseAdmin();
  const since24h = new Date(new Date().valueOf() - 24 * 3600 * 1000).toISOString();

  const { data, error } = await sb
    .from("borrower_session_tokens")
    .select("deal_id, created_at, last_seen_at, claimed_email")
    .gte("created_at", since24h)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Row[];
  const now = new Date().valueOf();

  return (
    <main className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Borrower sessions — 24h</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Newest first, capped at 50. Tokens are SHA-256; only the deal id is
            shown.
          </p>
        </div>
        <Link href="/admin/brokerage/listings" className="text-sm underline">
          Back to overview
        </Link>
      </header>

      {error && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          {error.message}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-500 text-sm">
          No borrower sessions in the last 24 hours.
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-neutral-400 border-b border-neutral-800">
              <th className="py-2 pr-4">Deal</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">Last seen</th>
              <th className="py-2 pr-4">Email</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ageSec = Math.floor(
                (now - new Date(r.created_at).getTime()) / 1000,
              );
              return (
                <tr key={r.deal_id} className="border-b border-neutral-900">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {r.deal_id.slice(0, 8)}
                  </td>
                  <td
                    className="py-2 pr-4 text-neutral-400"
                    title={r.created_at}
                  >
                    {formatAge(ageSec)} ago
                  </td>
                  <td className="py-2 pr-4 text-neutral-400">
                    {new Date(r.last_seen_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4">
                    {r.claimed_email ?? (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
