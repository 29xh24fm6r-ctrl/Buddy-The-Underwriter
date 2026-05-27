/**
 * SPEC-BUDDY-HARD-STOP-AUDIT-AND-RECOVERY-1 #2:
 * Landing page for the "Configure Loan Products" affordance surfaced by
 * LoanRequestsSection when a bank has no enabled loan products.
 *
 * Renders the current bank-scoped + global catalog status so an admin can
 * see what's actually enabled today and which row needs editing. Full
 * CRUD remains a follow-up (the row writes go through the existing
 * loan_product_types and bank_loan_product_types tables); the page's job
 * here is to make the dead-end visible and walk a banker through what
 * "configure" actually means instead of leaving them stranded on the
 * disabled Add Request button.
 */

import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  GlassShell,
  GlassPageHeader,
  GlassInfoBox,
} from "@/components/layout";

export const dynamic = "force-dynamic";

type ProductRow = {
  product_key: string;
  display_name: string;
  enabled: boolean;
};

export default async function LoanProductsAdminPage() {
  const bankPick = await tryGetCurrentBankId();
  const bankId = bankPick.ok ? bankPick.bankId : null;
  const sb = supabaseAdmin();

  let bankName: string | null = null;
  let bankRows: ProductRow[] = [];
  if (bankId) {
    const { data: bankData } = await sb
      .from("banks")
      .select("name")
      .eq("id", bankId)
      .maybeSingle();
    bankName = (bankData as { name?: string } | null)?.name ?? null;

    const { data: overrides } = await sb
      .from("bank_loan_product_types")
      .select("product_key, display_name, enabled")
      .eq("bank_id", bankId);
    bankRows = (overrides as ProductRow[] | null) ?? [];
  }

  const { data: globalData } = await sb
    .from("loan_product_types")
    .select("product_key, display_name, enabled");
  const globalRows: ProductRow[] = (globalData as ProductRow[] | null) ?? [];

  const enabledBank = bankRows.filter((r) => r.enabled);
  const enabledGlobal = globalRows.filter((r) => r.enabled);

  return (
    <GlassShell>
      <GlassPageHeader
        title="Loan Products"
        subtitle={
          bankName
            ? `Configure available loan products for ${bankName}`
            : "Configure available loan products"
        }
      />

      <GlassInfoBox variant="info" className="mb-4">
        Loan requests can only be created for products that are enabled in this
        catalog. If a banker hits an empty Add Request button, either no
        bank-specific overrides are enabled or — when there are no overrides —
        the global catalog has no enabled rows.
      </GlassInfoBox>

      <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-2 text-sm font-semibold text-white">
          Bank-specific overrides ({bankRows.length} row
          {bankRows.length === 1 ? "" : "s"}, {enabledBank.length} enabled)
        </div>
        {bankRows.length === 0 ? (
          <div className="text-sm text-white/50">
            No bank-specific rows. This bank falls back to the global catalog
            below.
          </div>
        ) : (
          <ul className="text-sm text-white/70">
            {bankRows.map((r) => (
              <li key={r.product_key} className="flex justify-between gap-3 py-1">
                <span>{r.display_name || r.product_key}</span>
                <span className={r.enabled ? "text-green-300" : "text-white/40"}>
                  {r.enabled ? "enabled" : "disabled"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-2 text-sm font-semibold text-white">
          Global catalog ({globalRows.length} row
          {globalRows.length === 1 ? "" : "s"}, {enabledGlobal.length} enabled)
        </div>
        {globalRows.length === 0 ? (
          <div className="text-sm text-white/50">
            Global catalog is empty. Insert rows into{" "}
            <code className="rounded bg-white/10 px-1 py-0.5 text-xs">
              loan_product_types
            </code>{" "}
            to unblock all banks.
          </div>
        ) : (
          <ul className="text-sm text-white/70">
            {globalRows.map((r) => (
              <li key={r.product_key} className="flex justify-between gap-3 py-1">
                <span>{r.display_name || r.product_key}</span>
                <span className={r.enabled ? "text-green-300" : "text-white/40"}>
                  {r.enabled ? "enabled" : "disabled"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </GlassShell>
  );
}
