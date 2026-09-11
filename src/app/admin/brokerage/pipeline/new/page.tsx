import Link from "next/link";
import SelfSourcedDealForm from "./SelfSourcedDealForm";
import { crmColors as c } from "@/components/brokerage/tokens";

export default function NewSelfSourcedDealPage() {
  return <div className="sba-work-surface sba-deal-intake" style={{ padding: "24px 28px 48px" }}>
    <Link href="/admin/brokerage/pipeline" style={{ color: c.brassBright, fontSize: 11, textDecoration: "none" }}>← Deals</Link>
    <h1 style={{ color: c.paper, fontFamily: "var(--font-brokerage-display)", margin: "18px 0 6px", fontSize: 26 }}>Load a deal</h1>
    <p style={{ color: c.textMuted, fontSize: 12.5, margin: "0 0 24px", maxWidth: 700 }}>
      One form for every deal you enter by hand — your own, a partner&apos;s referral, or an off-platform file you only
      want to track. The financials upload with it, and the borrower&apos;s CRM record is created at the same time.
    </p>
    <SelfSourcedDealForm />
  </div>;
}
