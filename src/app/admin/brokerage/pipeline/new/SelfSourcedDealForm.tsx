"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export default function SelfSourcedDealForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const fd = new FormData(event.currentTarget);
    const res = await fetch("/api/admin/brokerage/deals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(fd.entries())),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) { setError(data.error ?? "Could not create deal."); setBusy(false); return; }
    router.push(`/admin/brokerage/pipeline/${data.dealId}`);
  }

  const input = { width: "100%", padding: "10px 11px", borderRadius: 5, border: `1px solid ${c.borderStrong}`, background: c.inkHeader, color: c.paper };
  return <form onSubmit={submit} style={{ maxWidth: 680, display: "grid", gap: 16 }}>
    <label style={{ display: "grid", gap: 6, color: c.textSecondary, fontSize: 12 }}>Business or deal name<input name="businessName" required maxLength={160} style={input} /></label>
    <label style={{ display: "grid", gap: 6, color: c.textSecondary, fontSize: 12 }}>Primary borrower / guarantor name<input name="borrowerName" required maxLength={160} style={input} /></label>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <label style={{ display: "grid", gap: 6, color: c.textSecondary, fontSize: 12 }}>Requested loan amount<input name="loanAmount" type="number" min="1" max="100000000" step="1" required style={input} /></label>
      <label style={{ display: "grid", gap: 6, color: c.textSecondary, fontSize: 12 }}>Entity type<select name="entityType" style={input} defaultValue="Unknown"><option>Unknown</option><option>LLC</option><option>Corporation</option><option>Partnership</option><option>Sole Proprietorship</option></select></label>
    </div>
    <div style={{ padding: 12, border: `1px solid ${c.border}`, borderRadius: 6, color: c.textMuted, fontSize: 11.5, lineHeight: 1.5 }}>
      This creates a brokerage-private deal workspace. You will upload tax returns, personal financial statements, the credit memo, and other package documents in Buddy&apos;s existing protected document workspace next.
    </div>
    {error && <div role="alert" style={{ color: c.brick, fontSize: 12 }}>{error}</div>}
    <button disabled={busy} style={{ justifySelf: "start", border: 0, borderRadius: 5, padding: "10px 16px", background: c.brass, color: c.brassOnBrass, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>{busy ? "Creating…" : "Create deal workspace"}</button>
  </form>;
}
