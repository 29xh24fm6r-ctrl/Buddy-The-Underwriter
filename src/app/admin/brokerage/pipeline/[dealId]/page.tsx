import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import LenderOutreachClient from "./LenderOutreachClient";

export default async function BrokerageDealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params; const bankId = await getBrokerageBankId();
  const { data: deal } = await supabaseAdmin().from("deals").select("id,display_name,name,borrower_name,loan_amount,external_deal_source").eq("id", dealId).eq("bank_id", bankId).maybeSingle();
  if (!deal) notFound(); const name = deal.display_name || deal.name || "Untitled deal";
  return <div style={{ padding: "20px 24px 48px" }}>
    <Link href="/admin/brokerage/pipeline" style={{ color: c.brassBright, fontSize: 11, textDecoration: "none" }}>← Deals</Link>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", margin: "16px 0 24px" }}><div><h1 style={{ margin: 0, color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 26 }}>{name}</h1><div style={{ color: c.textMuted, fontSize: 12 }}>{deal.borrower_name} · {deal.external_deal_source === "brokerage_self_sourced_package" ? "Self-sourced package" : "Brokerage deal"}</div></div><Link href={`/deals/${dealId}/cockpit`} style={{ padding: "9px 13px", borderRadius: 5, background: c.brass, color: c.brassOnBrass, fontWeight: 700, fontSize: 12, textDecoration: "none" }}>Open documents & underwriting →</Link></div>
    <h2 style={{ color: c.paper, fontSize: 16, margin: "0 0 10px" }}>Lender sharing & responses</h2>
    <p style={{ color: c.textMuted, fontSize: 11.5, margin: "0 0 14px" }}>Record each bank only after the package is actually shared. Update the same entry as the bank responds; a decline requires a reason.</p>
    <LenderOutreachClient dealId={dealId} />
  </div>;
}
