import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listBrokerageTeam } from "@/lib/brokerage/team";
import { crmColors as c } from "@/components/brokerage/tokens";
import { INTAKE_MODE_LABELS } from "@/lib/dealStage/board";
import DealWorkspaceClient from "./DealWorkspaceClient";
import DealLifecycleControls from "./DealLifecycleControls";
import { canDeleteBrokerageCrmRecords } from "@/lib/auth/requireBrokerageStaff";

export const dynamic = "force-dynamic";

function money(amount: unknown): string {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? "$" + Math.round(n).toLocaleString("en-US") : "—";
}

export default async function BrokerageDealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const bankId = await getBrokerageBankId();

  const [{ data: deal }, team, auth, canManageDeal] = await Promise.all([
    supabaseAdmin()
      .from("deals")
      .select("id, display_name, name, borrower_name, loan_amount, state, product_type, intake_mode, crm_tracking_only, external_deal_source, archived_at")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle(),
    listBrokerageTeam(bankId),
    clerkAuth(),
    canDeleteBrokerageCrmRecords(),
  ]);
  if (!deal) notFound();

  const title = deal.display_name || deal.name || "Untitled deal";
  const intakeMode = deal.intake_mode ?? (deal.crm_tracking_only ? "tracking_only" : null);

  return (
    <div className="sba-work-surface sba-deal-workspace" style={{ padding: "24px 28px 48px" }}>
      <Link href={deal.archived_at ? "/admin/brokerage/pipeline?view=archived" : "/admin/brokerage/pipeline"} style={{ color: c.brassBright, fontSize: 11, textDecoration: "none" }}>← {deal.archived_at ? "Archived deals" : "Pipeline"}</Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", margin: "16px 0 22px" }}>
        <div>
          <h1 style={{ margin: 0, color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 26 }}>{title}</h1>
          <div style={{ color: c.textMuted, fontSize: 12, marginTop: 4 }}>
            {[
              deal.borrower_name,
              money(deal.loan_amount),
              deal.state,
              deal.product_type?.replaceAll("_", " "),
              intakeMode ? INTAKE_MODE_LABELS[intakeMode] ?? intakeMode : null,
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Link
          href={`/deals/${dealId}/cockpit`}
          style={{ padding: "9px 13px", borderRadius: 5, background: c.brass, color: c.brassOnBrass, fontWeight: 700, fontSize: 12, textDecoration: "none" }}
        >
          Documents &amp; underwriting →
        </Link>
      </div>

      <DealWorkspaceClient dealId={dealId} team={team} currentUserId={auth.userId ?? null} />
      {canManageDeal ? <DealLifecycleControls dealId={dealId} label={title} archivedAt={deal.archived_at ?? null} /> : null}
    </div>
  );
}
