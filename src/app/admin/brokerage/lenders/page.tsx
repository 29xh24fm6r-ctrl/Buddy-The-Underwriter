import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type LenderProgram = {
  id: string;
  bank_id: string;
  lender_name: string;
  program_name: string | null;
  min_dscr: number | null;
  max_ltv: number | null;
  asset_types: string[] | null;
  geography: string[] | null;
  sba_only: boolean;
  score_threshold: number | null;
  notes: string | null;
};

export default async function AdminBrokerageLendersPage() {
  const sb = supabaseAdmin();

  const [{ data: programs }, { data: lenderBanks }] = await Promise.all([
    sb
      .from("lender_programs")
      .select(
        "id, bank_id, lender_name, program_name, min_dscr, max_ltv, asset_types, geography, sba_only, score_threshold, notes",
      )
      .order("lender_name", { ascending: true })
      .limit(200),
    sb
      .from("banks")
      .select("id, name, code, bank_kind")
      .eq("bank_kind", "commercial_bank")
      .order("name", { ascending: true }),
  ]);

  return (
    <main className="px-8 py-10 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Lender onboarding</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Brokerage-side admin: lender tenants and the programs Buddy matches
          against. Self-serve onboarding is not built yet — rows are seeded by
          ops via <code>/api/admin/brokerage/lenders</code>.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="text-lg font-medium mb-3">Lender banks</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-neutral-400 border-b border-neutral-800">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Bank id</th>
            </tr>
          </thead>
          <tbody>
            {(lenderBanks ?? []).map((b) => (
              <tr key={b.id} className="border-b border-neutral-900">
                <td className="py-2 pr-4">{b.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{b.code}</td>
                <td className="py-2 pr-4 font-mono text-xs text-neutral-500">
                  {b.id}
                </td>
              </tr>
            ))}
            {(lenderBanks ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-neutral-500">
                  No lender banks provisioned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Lender programs</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-neutral-400 border-b border-neutral-800">
              <th className="py-2 pr-4">Lender</th>
              <th className="py-2 pr-4">Program</th>
              <th className="py-2 pr-4">SBA only</th>
              <th className="py-2 pr-4">Min DSCR</th>
              <th className="py-2 pr-4">Max LTV</th>
              <th className="py-2 pr-4">Min score</th>
              <th className="py-2 pr-4">States</th>
              <th className="py-2 pr-4">NAICS prefix</th>
            </tr>
          </thead>
          <tbody>
            {(programs ?? []).map((p: LenderProgram) => (
              <tr key={p.id} className="border-b border-neutral-900">
                <td className="py-2 pr-4">{p.lender_name}</td>
                <td className="py-2 pr-4">{p.program_name ?? "—"}</td>
                <td className="py-2 pr-4">{p.sba_only ? "yes" : "no"}</td>
                <td className="py-2 pr-4">{p.min_dscr ?? "—"}</td>
                <td className="py-2 pr-4">{p.max_ltv ?? "—"}</td>
                <td className="py-2 pr-4">{p.score_threshold ?? "—"}</td>
                <td className="py-2 pr-4 text-xs">
                  {p.geography?.join(", ") ?? "—"}
                </td>
                <td className="py-2 pr-4 text-xs">
                  {p.asset_types?.join(", ") ?? "—"}
                </td>
              </tr>
            ))}
            {(programs ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-neutral-500">
                  No lender programs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
