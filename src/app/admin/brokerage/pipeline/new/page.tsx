import Link from "next/link";
import SelfSourcedDealForm from "./SelfSourcedDealForm";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export default function NewSelfSourcedDealPage() {
  return <div style={{ padding: "20px 24px 48px" }}>
    <Link href="/admin/brokerage/pipeline" style={{ color: c.brassBright, fontSize: 11, textDecoration: "none" }}>← Deals</Link>
    <h1 style={{ color: c.paper, fontFamily: "var(--font-brokerage-display)", margin: "18px 0 6px", fontSize: 26 }}>Load a self-sourced deal</h1>
    <p style={{ color: c.textMuted, fontSize: 12.5, margin: "0 0 24px", maxWidth: 700 }}>Create the record first, then add the package in its secure document workspace and track every lender share and response.</p>
    <SelfSourcedDealForm />
  </div>;
}
