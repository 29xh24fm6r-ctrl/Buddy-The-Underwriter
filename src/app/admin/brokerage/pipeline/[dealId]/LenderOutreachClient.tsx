"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";

type Profile = { id: string; organization?: { name?: string | null } | null };
type Submission = { id: string; deal_id: string; lender_profile_id: string; status: string; sent_at: string | null; responded_at: string | null; decline_reason: string | null; notes: string | null; lender?: { name?: string | null } | null };

const statuses = ["planned", "sent", "reviewing", "interested", "term_sheet", "approved", "declined", "withdrawn", "lost"];
const declineReasons = ["Credit", "Cash flow", "Collateral", "Equity injection", "Industry", "Management experience", "Loan size", "Geography", "Policy", "Incomplete package", "Timing", "Other"];
const endpoint = "/api/admin/brokerage/crm/organizations/buyers";

export default function LenderOutreachClient({ dealId }: { dealId: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rows, setRows] = useState<Submission[]>([]);
  const [status, setStatus] = useState("planned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(endpoint, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not load lender relationships.");
    setProfiles(data.profiles ?? []);
    setRows((data.submissions ?? []).filter((row: Submission) => row.deal_id === dealId));
  }, [dealId]);

  useEffect(() => {
    let active = true;
    void load().catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [load]);

  async function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
    const res = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save lender activity.");
    return data;
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const lenderProfileId = String(fd.get("lenderProfileId") ?? "");
    const declineReason = String(fd.get("declineReason") ?? "");
    const notes = String(fd.get("notes") ?? "");
    try {
      let existing = rows.find((row) => row.lender_profile_id === lenderProfileId);
      const wasExisting = Boolean(existing);
      if (!existing) {
        const created = await request("POST", { action: "create_submission", dealId, lenderProfileId, status: status === "planned" ? "planned" : "sent", notes });
        existing = created.submission;
      }
      if (wasExisting || status !== existing?.status) await request("PATCH", { id: existing?.id, status, declineReason, notes });
      form.reset(); setStatus("planned"); await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const field = { padding: "8px 9px", borderRadius: 5, border: `1px solid ${c.borderStrong}`, background: c.inkHeader, color: c.paper };
  return <div>
    {profiles.length === 0 && <div style={{ marginBottom: 12, padding: 12, border: `1px solid ${c.border}`, borderRadius: 6, color: c.textMuted, fontSize: 12 }}>Add at least one bank relationship in <Link href="/admin/brokerage/crm/buyers" style={{ color: c.brassBright }}>Bank Buyers</Link> before recording a share.</div>}
    <form onSubmit={save} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.2fr", gap: 10, padding: 14, border: `1px solid ${c.border}`, borderRadius: 7, background: c.card }}>
      <select name="lenderProfileId" required style={field} defaultValue=""><option value="" disabled>Select bank relationship…</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.organization?.name ?? "Unnamed bank"}</option>)}</select>
      <select name="status" value={status} onChange={e => setStatus(e.target.value)} style={field}>{statuses.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select>
      <select name="declineReason" required={status === "declined"} disabled={status !== "declined"} style={field}><option value="">Reason if bank says no…</option>{declineReasons.map(r => <option key={r} value={r}>{r}</option>)}</select>
      <input name="notes" placeholder="Response and follow-up notes" maxLength={4000} style={{ ...field, gridColumn: "1 / 3" }} />
      {error && <div role="alert" style={{ gridColumn: "1 / -1", color: c.brick, fontSize: 12 }}>{error}</div>}
      <button disabled={busy || profiles.length === 0} style={{ justifySelf: "start", border: 0, borderRadius: 5, padding: "9px 14px", background: c.brass, color: c.brassOnBrass, fontWeight: 700 }}>{busy ? "Saving…" : "Save lender activity"}</button>
    </form>
    <div style={{ marginTop: 14, border: `1px solid ${c.border}`, borderRadius: 7, overflow: "hidden" }}>
      {rows.length === 0 ? <div style={{ padding: 22, color: c.textMuted, fontSize: 12 }}>No lender shares recorded yet.</div> : rows.map(r => <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 2fr", gap: 12, padding: "11px 13px", borderBottom: `1px solid ${c.divider}`, color: c.textSecondary, fontSize: 11.5 }}><strong style={{ color: c.paper }}>{r.lender?.name ?? "Unknown bank"}</strong><span>{r.status.replaceAll("_", " ")}</span><span>{r.decline_reason ?? "—"}</span><span>{r.notes ?? "—"}</span></div>)}
    </div>
  </div>;
}
