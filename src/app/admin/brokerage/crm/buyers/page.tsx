"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { CrmTabs } from "@/components/brokerage/CrmTabs";
import { brokerageColors as c, fmtMoney } from "@/components/brokerage/tokens";

const STATUS_LABELS: Record<string, string> = { planned: "Planned", sent: "Sent", reviewing: "Reviewing", interested: "Interested", term_sheet: "Term sheet", approved: "Approved", declined: "Declined", withdrawn: "Withdrawn", lost: "Lost", closed: "Closed" };
const ACTIVE = new Set(["planned", "sent", "reviewing", "interested", "term_sheet", "approved"]);

function field(): CSSProperties { return { width: "100%", background: c.ink, border: `1px solid ${c.border}`, color: c.paper, borderRadius: 5, padding: "9px 10px", fontSize: 12 }; }
function label(name: string, child: React.ReactNode) { return <label style={{ display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}><span>{name}</span>{child}</label>; }
function dateInput(days = 3) { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 16); }

export default function BankBuyersPage() {
  const [data, setData] = useState<any>({ profiles: [], submissions: [], deals: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"bank" | "submission" | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("active");
  const [bank, setBank] = useState<any>({ name: "", relationshipStatus: "prospect", lenderType: "bank", sba7a: true, sba504: false, conventional: false, minLoanAmount: "", maxLoanAmount: "", minDscr: "1.25", maxLtv: "0.90", minimumFico: "", industries: "", excludedIndustries: "", geographies: "Nationwide", collateralPreferences: "", dealPreferences: "", responseSlaDays: "3", referralFeeBps: "", websiteUrl: "", phone: "", city: "", state: "", notes: "", contactFirstName: "", contactLastName: "", contactEmail: "", contactPhone: "", contactJobTitle: "SBA Business Development Officer" });
  const [submission, setSubmission] = useState<any>({ dealId: "", lenderProfileId: "", bankerPersonId: "", status: "sent", amountSent: "", nextFollowUpAt: dateInput(), fitRationale: "", notes: "" });

  async function load() {
    setLoading(true);
    try { const r = await fetch("/api/admin/brokerage/crm/buyers"); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error ?? "Load failed"); setData(j); setError(null); }
    catch (e: any) { setError(e.message ?? "Load failed"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const visible = useMemo(() => data.submissions.filter((s: any) => filter === "all" || (filter === "active" ? ACTIVE.has(s.status) : s.status === filter)), [data.submissions, filter]);
  const selectedProfile = data.profiles.find((p: any) => p.id === submission.lenderProfileId);

  async function post(payload: any) {
    setSaving(true); setError(null);
    try { const r = await fetch("/api/admin/brokerage/crm/buyers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error ?? "Save failed"); setMode(null); await load(); }
    catch (e: any) { setError(e.message ?? "Save failed"); }
    finally { setSaving(false); }
  }
  async function changeStatus(row: any, status: string) {
    const payload: any = { id: row.id, status };
    if (status === "declined") { const reason = window.prompt("Why did the bank decline this deal?"); if (!reason) return; payload.declineReason = reason; }
    if (status === "lost") { const reason = window.prompt("Why was this opportunity lost?"); if (!reason) return; payload.lostReason = reason; }
    if (status === "approved") { const amount = window.prompt("Approved amount", String(row.amount_sent ?? "")); if (amount == null) return; payload.approvedAmount = Number(amount); }
    if (status === "closed") { const amount = window.prompt("Final closed amount", String(row.approved_amount ?? row.amount_sent ?? "")); if (!amount) return; payload.closedAmount = Number(amount); payload.closedAt = new Date().toISOString(); }
    setSaving(true);
    try { const r = await fetch("/api/admin/brokerage/crm/buyers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error); await load(); }
    catch (e: any) { setError(e.message ?? "Update failed"); }
    finally { setSaving(false); }
  }

  const tile = (name: string, value: string, color: string = c.brass) => <div style={{ background: c.card, border: `1px solid ${c.border}`, borderLeft: `3px solid ${color}`, padding: "13px 15px", borderRadius: 7 }}><div style={{ color: c.textMuted, fontSize: 10.5 }}>{name}</div><div style={{ color: c.paper, fontFamily: "var(--font-brokerage-mono)", fontSize: 22, marginTop: 5 }}>{value}</div></div>;

  return <div style={{ padding: "18px 24px 42px" }}>
    <CrmTabs />
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", marginBottom: 16 }}><div><h1 style={{ margin: 0, color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 22 }}>Bank buyer network</h1><p style={{ margin: "5px 0 0", color: c.textMuted, fontSize: 12 }}>Know every bank, banker, appetite, deal sent, decision, and dollar closed.</p></div><div style={{ display: "flex", gap: 8 }}><button onClick={() => setMode("bank")} style={{ ...field(), width: "auto", cursor: "pointer" }}>+ Bank & banker</button><button onClick={() => setMode("submission")} disabled={!data.profiles.length} style={{ ...field(), width: "auto", borderColor: c.brass, color: c.brassBright, cursor: "pointer" }}>+ Send a deal</button></div></div>
    {error && <div style={{ padding: 11, border: `1px solid ${c.brick}`, color: c.brick, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{error}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(120px,1fr))", gap: 10, marginBottom: 18 }}>{tile("Bank buyers", String(data.summary?.bankBuyers ?? "—"))}{tile("Active placements", String(data.summary?.activeSubmissions ?? "—"), c.sage)}{tile("Banks interested", String(data.summary?.interestedCount ?? "—"), c.sage)}{tile("Interest rate", data.summary?.interestRate == null ? "—" : `${Math.round(data.summary.interestRate * 100)}%`, c.sage)}{tile("Closed volume", data.summary ? fmtMoney(data.summary.closedVolume) : "—", c.brassBright)}{tile("Follow-ups overdue", String(data.summary?.overdueFollowUps ?? "—"), data.summary?.overdueFollowUps ? c.brick : c.textFaint)}</div>

    {mode === "bank" && <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 18 }}><h2 style={{ margin: "0 0 14px", fontSize: 15, color: c.paper }}>Add a bank and its primary banker</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
      {label("Bank name *", <input style={field()} value={bank.name} onChange={e => setBank({...bank,name:e.target.value})}/>)}{label("Relationship", <select style={field()} value={bank.relationshipStatus} onChange={e => setBank({...bank,relationshipStatus:e.target.value})}><option value="prospect">Prospect</option><option value="active">Active</option><option value="paused">Paused</option><option value="inactive">Inactive</option></select>)}{label("Minimum deal", <input style={field()} type="number" value={bank.minLoanAmount} onChange={e => setBank({...bank,minLoanAmount:e.target.value})}/>)}{label("Maximum deal", <input style={field()} type="number" value={bank.maxLoanAmount} onChange={e => setBank({...bank,maxLoanAmount:e.target.value})}/>)}
      {label("Minimum DSCR", <input style={field()} type="number" step=".01" value={bank.minDscr} onChange={e => setBank({...bank,minDscr:e.target.value})}/>)}{label("Maximum LTV (0.90 = 90%)", <input style={field()} type="number" step=".01" value={bank.maxLtv} onChange={e => setBank({...bank,maxLtv:e.target.value})}/>)}{label("Minimum FICO", <input style={field()} type="number" value={bank.minimumFico} onChange={e => setBank({...bank,minimumFico:e.target.value})}/>)}{label("Response SLA (days)", <input style={field()} type="number" value={bank.responseSlaDays} onChange={e => setBank({...bank,responseSlaDays:e.target.value})}/>)}
      {label("Geographies", <input style={field()} value={bank.geographies} onChange={e => setBank({...bank,geographies:e.target.value})} placeholder="GA, FL, Nationwide"/>)}{label("Preferred industries", <input style={field()} value={bank.industries} onChange={e => setBank({...bank,industries:e.target.value})} placeholder="Manufacturing, hospitality"/>)}{label("Excluded industries", <input style={field()} value={bank.excludedIndustries} onChange={e => setBank({...bank,excludedIndustries:e.target.value})}/>)}{label("Referral fee (bps)", <input style={field()} type="number" value={bank.referralFeeBps} onChange={e => setBank({...bank,referralFeeBps:e.target.value})}/>)}
      {label("Banker first name", <input style={field()} value={bank.contactFirstName} onChange={e => setBank({...bank,contactFirstName:e.target.value})}/>)}{label("Banker last name", <input style={field()} value={bank.contactLastName} onChange={e => setBank({...bank,contactLastName:e.target.value})}/>)}{label("Banker email", <input style={field()} type="email" value={bank.contactEmail} onChange={e => setBank({...bank,contactEmail:e.target.value})}/>)}{label("Banker phone", <input style={field()} value={bank.contactPhone} onChange={e => setBank({...bank,contactPhone:e.target.value})}/>)}
      <label style={{ gridColumn: "span 4", display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>Deal preferences / credit box<textarea style={{ ...field(), minHeight: 70 }} value={bank.dealPreferences} onChange={e => setBank({...bank,dealPreferences:e.target.value})}/></label>
      <div style={{ gridColumn: "span 4", display: "flex", gap: 16, color: c.textSecondary, fontSize: 12 }}><label><input type="checkbox" checked={bank.sba7a} onChange={e => setBank({...bank,sba7a:e.target.checked})}/> SBA 7(a)</label><label><input type="checkbox" checked={bank.sba504} onChange={e => setBank({...bank,sba504:e.target.checked})}/> SBA 504</label><label><input type="checkbox" checked={bank.conventional} onChange={e => setBank({...bank,conventional:e.target.checked})}/> Conventional</label></div>
    </div><div style={{ marginTop: 14, display: "flex", gap: 8 }}><button disabled={saving || !bank.name.trim()} onClick={() => post({action:"create_buyer",...bank})} style={{ ...field(), width: "auto", background: c.brass, color: c.brassOnBrass }}>Save bank buyer</button><button onClick={() => setMode(null)} style={{ ...field(), width: "auto" }}>Cancel</button></div></section>}

    {mode === "submission" && <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 18 }}><h2 style={{ margin: "0 0 14px", fontSize: 15, color: c.paper }}>Record a deal distribution</h2><div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr", gap: 10 }}>
      {label("Deal *", <select style={field()} value={submission.dealId} onChange={e => { const d=data.deals.find((x:any)=>x.id===e.target.value); setSubmission({...submission,dealId:e.target.value,amountSent:d?.loan_amount ?? ""}); }}><option value="">Select a deal</option>{data.deals.map((d:any)=><option key={d.id} value={d.id}>{d.display_name||d.borrower_name||d.name||"Untitled"} · {fmtMoney(Number(d.loan_amount||0))}</option>)}</select>)}
      {label("Bank buyer *", <select style={field()} value={submission.lenderProfileId} onChange={e => setSubmission({...submission,lenderProfileId:e.target.value,bankerPersonId:""})}><option value="">Select a bank</option>{data.profiles.map((p:any)=><option key={p.id} value={p.id}>{p.organization?.name ?? "Unnamed bank"}</option>)}</select>)}
      {label("Amount sent", <input style={field()} type="number" value={submission.amountSent} onChange={e=>setSubmission({...submission,amountSent:e.target.value})}/>)}{label("Follow up", <input style={field()} type="datetime-local" value={submission.nextFollowUpAt} onChange={e=>setSubmission({...submission,nextFollowUpAt:e.target.value})}/>)}
      {label("Banker", <select style={field()} value={submission.bankerPersonId} onChange={e=>setSubmission({...submission,bankerPersonId:e.target.value})}><option value="">Unassigned</option>{(selectedProfile?.contacts??[]).map((p:any)=><option key={p.id} value={p.id}>{[p.first_name,p.last_name].filter(Boolean).join(" ")||p.email}</option>)}</select>)}
      <label style={{ gridColumn: "span 3", display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>Why this bank fits<textarea style={{ ...field(), minHeight: 55 }} value={submission.fitRationale} onChange={e=>setSubmission({...submission,fitRationale:e.target.value})}/></label>
    </div><div style={{ marginTop: 14, display: "flex", gap: 8 }}><button disabled={saving||!submission.dealId||!submission.lenderProfileId} onClick={()=>post({action:"create_submission",...submission})} style={{ ...field(), width: "auto", background: c.brass, color: c.brassOnBrass }}>Record as sent</button><button onClick={()=>setMode(null)} style={{ ...field(), width: "auto" }}>Cancel</button></div></section>}

    <div style={{ display: "grid", gridTemplateColumns: "minmax(250px,.8fr) minmax(650px,2fr)", gap: 14 }}>
      <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}><div style={{ padding: "11px 14px", borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.paper }}>Bank network</div>{data.profiles.length===0?<div style={{ padding: 22, color: c.textMuted, fontSize: 12 }}>Add the banks and bankers who may buy Buddy SBA deals.</div>:data.profiles.map((p:any)=><Link href={`/admin/brokerage/crm/${p.organization_id}`} key={p.id} style={{ display: "block", padding: "11px 14px", borderBottom: `1px solid ${c.divider}`, textDecoration: "none" }}><div style={{ color: c.paper, fontSize: 12.5, fontWeight: 600 }}>{p.organization?.name}</div><div style={{ color: c.textMuted, fontSize: 10.5, marginTop: 3 }}>{p.contacts.length} banker{p.contacts.length===1?"":"s"} · {p.submissions.length} deal{p.submissions.length===1?"":"s"} · {p.relationship_status}</div><div style={{ color: c.textSecondary, fontSize: 10.5, marginTop: 3 }}>{[p.sba_7a_appetite&&"7(a)",p.sba_504_appetite&&"504",p.conventional_appetite&&"Conventional"].filter(Boolean).join(" · ")||"Appetite not set"}</div></Link>)}</section>
      <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}><div style={{ padding: "9px 12px", borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ color: c.paper, fontSize: 13 }}>Deal distribution ledger</strong><select style={{ ...field(), width: 135 }} value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Active</option><option value="all">All</option>{Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        {loading?<div style={{ padding: 28, color: c.textMuted }}>Loading…</div>:visible.length===0?<div style={{ padding: 28, color: c.textMuted, fontSize: 12 }}>No matching deal submissions.</div>:visible.map((s:any)=><div key={s.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr .8fr .8fr 145px", gap: 10, padding: "11px 12px", borderBottom: `1px solid ${c.divider}`, alignItems: "center" }}><div><div style={{ color: c.paper, fontSize: 12, fontWeight: 600 }}>{s.deal?.display_name||s.deal?.borrower_name||s.deal?.name||"Untitled deal"}</div><div style={{ color: c.textMuted, fontSize: 10.5 }}>{fmtMoney(Number(s.amount_sent||0))}</div></div><div style={{ color: c.textSecondary, fontSize: 11.5 }}>{s.lender?.name||"Unknown bank"}</div><div style={{ color: c.textMuted, fontSize: 10.5 }}>{s.sent_at?new Date(s.sent_at).toLocaleDateString():"Not sent"}</div><div style={{ color: s.next_follow_up_at&&new Date(s.next_follow_up_at)<new Date()?c.brick:c.textMuted, fontSize: 10.5 }}>{s.next_follow_up_at?new Date(s.next_follow_up_at).toLocaleDateString():"No follow-up"}</div><select disabled={saving} style={field()} value={s.status} onChange={e=>changeStatus(s,e.target.value)}>{Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>)}
      </section>
    </div>
  </div>;
}
