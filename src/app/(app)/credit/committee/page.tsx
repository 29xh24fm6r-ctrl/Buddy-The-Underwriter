/**
 * /credit/committee — Credit Committee View
 *
 * SPEC-COMMITTEE-READY-FLOW-1 — Fix 3 (revised per addendum).
 *
 * Renders the existing CreditCommitteeClient table UI with real deals
 * scoped to the banker's current bank, replacing the prior Stitch iframe
 * that surfaced the "Project Atlas" design mock. UI is unchanged — only
 * the data source moved from iframe to native query.
 */
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { dealLabel } from "@/lib/deals/dealLabel";
import {
  CreditCommitteeClient,
  type CreditCommitteeDealRow,
} from "@/components/committee/CreditCommitteeClient";

export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  ready: "Ready for Committee",
  underwriting: "In Underwriting",
};

type CommitteeRawDeal = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  borrower_name: string | null;
  name: string | null;
  legal_name: string | null;
  stage: string | null;
  deal_type: string | null;
};

export default async function Page() {
  const bankPick = await tryGetCurrentBankId();
  if (!bankPick.ok) redirect("/select-bank");
  const bankId = bankPick.bankId;
  const sb = supabaseAdmin();

  const { data: committeeDeals } = await sb
    .from("deals")
    .select(
      `
        id, display_name, nickname, borrower_name, name, legal_name,
        stage, deal_type,
        deal_loan_requests(requested_amount, product_type),
        financial_snapshots(snapshot_json, created_at)
      `,
    )
    .eq("bank_id", bankId)
    .in("stage", ["ready", "underwriting"])
    .order("updated_at", { ascending: false });

  const deals: CreditCommitteeDealRow[] = (
    (committeeDeals ?? []) as unknown as CommitteeRawDeal[]
  ).map((d) => ({
    id: d.id,
    name:
      dealLabel({
        id: d.id,
        display_name: d.display_name,
        nickname: d.nickname,
        borrower_name: d.borrower_name,
        name: d.name,
        legal_name: d.legal_name,
      }) || "",
    borrower: d.borrower_name ?? d.name ?? "—",
    stageLabel: STAGE_LABELS[d.stage ?? ""] ?? d.stage ?? "—",
  }));

  return <CreditCommitteeClient deals={deals} />;
}
