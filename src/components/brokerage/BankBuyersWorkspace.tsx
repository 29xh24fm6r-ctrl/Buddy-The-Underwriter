"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { CrmTabs } from "@/components/brokerage/CrmTabs";
import { crmColors as c, fmtMoney } from "@/components/brokerage/tokens";

const STATUS_LABELS: Record<string, string> = { planned: "Planned", sent: "Sent", reviewing: "Reviewing", interested: "Interested", term_sheet: "Term sheet", approved: "Approved", declined: "Declined", withdrawn: "Withdrawn", lost: "Lost", closed: "Closed" };
const ACTIVE = new Set(["planned", "sent", "reviewing", "interested", "term_sheet", "approved"]);

function field(): CSSProperties { return { width: "100%", background: c.ink, border: `1px solid ${c.border}`, color: c.paper, borderRadius: 5, padding: "9px 10px", fontSize: 12 }; }
function label(name: string, child: React.ReactNode) { return <label style={{ display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}><span>{name}</span>{child}</label>; }
function dateInput(days = 3) { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 16); }

export function BankBuyersWorkspace() {
  const [data, setData] = useState<any>({ profiles: [], submissions: [], deals: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"bank" | "submission" | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("active");
  const [dealSearch, setDealSearch] = useState("");
  const [bank, setBank] = useState<any>({ name: "", marketplaceRole: "", marketplaceAccessStatus: "not_invited", marketplaceOnboardingNotes: "", relationshipStatus: "prospect", lenderType: "bank", sba7a: true, sba504: false, conventional: false, minLoanAmount: "", maxLoanAmount: "", minDscr: "1.25", maxLtv: "0.90", minimumFico: "", industries: "", excludedIndustries: "", geographies: "Nationwide", collateralPreferences: "", dealPreferences: "", responseSlaDays: "3", referralFeeBps: "", websiteUrl: "", phone: "", city: "", state: "", notes: "", contactFirstName: "", contactLastName: "", contactEmail: "", contactPhone: "", contactJobTitle: "SBA Business Development Officer" });
  const [submission, setSubmission] = useState<any>({ entryMode: "existing", dealId: "", externalDealName: "", borrowerName: "", productType: "SBA_7A", dealState: "", externalDealSource: "", externalReference: "", lenderProfileId: "", bankerPersonId: "", status: "sent", amountSent: "", sentAt: dateInput(0), nextFollowUpAt: dateInput(), fitRationale: "", notes: "" });

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/brokerage/crm/organizations/buyers");
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Load failed");
      setData(j);
      setError(null);
      return j;
    } catch (e: any) {
      setError(e.message ?? "Load failed");
      return null;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const organizationId = params.get("organizationId");
    if (params.get("new") !== "submission" || !organizationId) {
      void load();
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/admin/brokerage/crm/organizations/buyers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ensure_buyer_relationship", organizationId }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error ?? "Unable to prepare bank relationship");
        const refreshed = await load();
        if (!refreshed) return;
        const preparedProfile = refreshed.profiles.find((profile: any) => profile.id === result.profile.id);
        const soleBankerId = preparedProfile?.contacts?.length === 1 ? preparedProfile.contacts[0].id : "";
        setSubmission((current: any) => ({ ...current, lenderProfileId: result.profile.id, bankerPersonId: soleBankerId }));
        setMode("submission");
        window.history.replaceState({}, "", "/admin/brokerage/crm/buyers");
      } catch (e: any) {
        setError(e.message ?? "Unable to prepare bank relationship");
        setLoading(false);
      }
    })();
    // Run once for the deep-linked organization supplied by the organization workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const visible = useMemo(() => data.submissions.filter((s: any) => filter === "all" || (filter === "active" ? ACTIVE.has(s.status) : s.status === filter)), [data.submissions, filter]);
  const selectedProfile = data.profiles.find((p: any) => p.id === submission.lenderProfileId);
  const visibleDeals = useMemo(() => {
    const query = dealSearch.trim().toLowerCase();
    return data.deals.filter((deal: any) => {
      const name = String(deal.display_name || deal.borrower_name || deal.name || "");
      if (deal.is_test || name.startsWith("[QA]")) return false;
      return !query || [name, deal.borrower_name, deal.product_type, deal.state, deal.external_reference]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [data.deals, dealSearch]);

  async function post(payload: any) {
    setSaving(true); setError(null);
    try { const r = await fetch("/api/admin/brokerage/crm/organizations/buyers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error ?? "Save failed"); setMode(null); await load(); }
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
    try { const r = await fetch("/api/admin/brokerage/crm/organizations/buyers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error); await load(); }
    catch (e: any) { setError(e.message ?? "Update failed"); }
    finally { setSaving(false); }
  }

  const tile = (name: string, value: string, color: string = c.brass) => <div style={{ background: c.card, border: `1px solid ${c.border}`, borderLeft: `3px solid ${color}`, padding: "13px 15px", borderRadius: 7 }}><div style={{ color: c.textMuted, fontSize: 10.5 }}>{name}</div><div style={{ color: c.paper, fontFamily: "var(--font-brokerage-mono)", fontSize: 22, marginTop: 5 }}>{value}</div></div>;

  return <div style={{ padding: "18px 24px 42px" }}>
    <CrmTabs />
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", marginBottom: 16 }}><div><h1 style={{ margin: 0, color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 22 }}>Bank buyer network</h1><p style={{ margin: "5px 0 0", color: c.textMuted, fontSize: 12 }}>Know every bank, banker, appetite, deal sent, decision, and dollar closed.</p></div><div style={{ display: "flex", gap: 8 }}><button onClick={() => setMode("bank")} style={{ ...field(), width: "auto", cursor: "pointer" }}>+ Bank & banker</button><button onClick={() => setMode("submission")} disabled={!data.profiles.length} style={{ ...field(), width: "auto", borderColor: c.brass, color: c.brassBright, cursor: "pointer" }}>+ Send a deal</button></div></div>
    {error && <div style={{ padding: 11, border: `1px solid ${c.brick}`, color: c.brick, borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{error}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10, marginBottom: 18 }}>{tile("Bank relationships", String(data.summary?.bankBuyers ?? "—"))}{tile("Marketplace active", String(data.summary?.marketplaceActive ?? "—"), c.sage)}{tile("Active placements", String(data.summary?.activeSubmissions ?? "—"), c.sage)}{tile("Banks interested", String(data.summary?.interestedCount ?? "—"), c.sage)}{tile("Closed volume", data.summary ? fmtMoney(data.summary.closedVolume) : "—", c.brassBright)}{tile("Follow-ups overdue", String(data.summary?.overdueFollowUps ?? "—"), data.summary?.overdueFollowUps ? c.brick : c.textFaint)}</div>

    {mode === "bank" && <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 18 }}><h2 style={{ margin: "0 0 14px", fontSize: 15, color: c.paper }}>Add a bank relationship</h2><p style={{ margin: "-7px 0 14px", color: c.textMuted, fontSize: 11.5 }}>Create one bank record, add the banker, and optionally classify marketplace participation. Appetite can be learned later.</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
      {label("Bank name *", <input style={field()} value={bank.name} onChange={e => setBank({...bank,name:e.target.value})}/>)}{label("Relationship", <select style={field()} value={bank.relationshipStatus} onChange={e => setBank({...bank,relationshipStatus:e.target.value})}><option value="prospect">Prospect</option><option value="qualified">Qualified</option><option value="active">Active</option><option value="preferred">Preferred</option><option value="paused">Paused</option><option value="inactive">Inactive</option></select>)}{label("Marketplace role (optional)", <select style={field()} value={bank.marketplaceRole} onChange={e => setBank({...bank,marketplaceRole:e.target.value})}><option value="">Not participating</option><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="buyer_seller">Buyer & seller</option><option value="viewer">Viewer</option></select>)}{label("Marketplace access", <select style={field()} value={bank.marketplaceAccessStatus} onChange={e => setBank({...bank,marketplaceAccessStatus:e.target.value})}><option value="not_invited">Not invited</option><option value="invited">Invited</option><option value="onboarding">Onboarding</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option></select>)}{label("Minimum deal", <input style={field()} type="number" value={bank.minLoanAmount} onChange={e => setBank({...bank,minLoanAmount:e.target.value})}/>)}{label("Maximum deal", <input style={field()} type="number" value={bank.maxLoanAmount} onChange={e => setBank({...bank,maxLoanAmount:e.target.value})}/>)}
      {label("Minimum DSCR", <input style={field()} type="number" step=".01" value={bank.minDscr} onChange={e => setBank({...bank,minDscr:e.target.value})}/>)}{label("Maximum LTV (0.90 = 90%)", <input style={field()} type="number" step=".01" value={bank.maxLtv} onChange={e => setBank({...bank,maxLtv:e.target.value})}/>)}{label("Minimum FICO", <input style={field()} type="number" value={bank.minimumFico} onChange={e => setBank({...bank,minimumFico:e.target.value})}/>)}{label("Response SLA (days)", <input style={field()} type="number" value={bank.responseSlaDays} onChange={e => setBank({...bank,responseSlaDays:e.target.value})}/>)}
      {label("Geographies", <input style={field()} value={bank.geographies} onChange={e => setBank({...bank,geographies:e.target.value})} placeholder="GA, FL, Nationwide"/>)}{label("Preferred industries", <input style={field()} value={bank.industries} onChange={e => setBank({...bank,industries:e.target.value})} placeholder="Manufacturing, hospitality"/>)}{label("Excluded industries", <input style={field()} value={bank.excludedIndustries} onChange={e => setBank({...bank,excludedIndustries:e.target.value})}/>)}{label("Referral fee (bps)", <input style={field()} type="number" value={bank.referralFeeBps} onChange={e => setBank({...bank,referralFeeBps:e.target.value})}/>)}
      {label("Banker first name", <input style={field()} value={bank.contactFirstName} onChange={e => setBank({...bank,contactFirstName:e.target.value})}/>)}{label("Banker last name", <input style={field()} value={bank.contactLastName} onChange={e => setBank({...bank,contactLastName:e.target.value})}/>)}{label("Banker email", <input style={field()} type="email" value={bank.contactEmail} onChange={e => setBank({...bank,contactEmail:e.target.value})}/>)}{label("Banker phone", <input style={field()} value={bank.contactPhone} onChange={e => setBank({...bank,contactPhone:e.target.value})}/>)}
      <label style={{ gridColumn: "span 4", display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>Deal preferences / credit box<textarea style={{ ...field(), minHeight: 70 }} value={bank.dealPreferences} onChange={e => setBank({...bank,dealPreferences:e.target.value})}/></label>
      <div style={{ gridColumn: "span 4", display: "flex", gap: 16, color: c.textSecondary, fontSize: 12 }}><label><input type="checkbox" checked={bank.sba7a} onChange={e => setBank({...bank,sba7a:e.target.checked})}/> SBA 7(a)</label><label><input type="checkbox" checked={bank.sba504} onChange={e => setBank({...bank,sba504:e.target.checked})}/> SBA 504</label><label><input type="checkbox" checked={bank.conventional} onChange={e => setBank({...bank,conventional:e.target.checked})}/> Conventional</label></div>
    </div><div style={{ marginTop: 14, display: "flex", gap: 8 }}><button disabled={saving || !bank.name.trim()} onClick={() => post({action:"create_buyer",...bank})} style={{ ...field(), width: "auto", background: c.brass, color: c.brassOnBrass }}>Save bank buyer</button><button onClick={() => setMode(null)} style={{ ...field(), width: "auto" }}>Cancel</button></div></section>}

    {mode === "submission" && <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 18 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15, color: c.paper }}>Record a deal sent to a bank</h2>
      <p style={{ margin: "0 0 14px", color: c.textMuted, fontSize: 11.5 }}>Use an existing Buddy deal or create a lightweight CRM-only record for a deal received outside Buddy SBA.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button" onClick={()=>setSubmission({...submission,entryMode:"existing"})} style={{ ...field(), width: "auto", background: submission.entryMode==="existing"?c.brass:c.card, color: submission.entryMode==="existing"?c.brassOnBrass:c.paper }}>Existing Buddy deal</button>
        <button type="button" onClick={()=>setSubmission({...submission,entryMode:"external",dealId:""})} style={{ ...field(), width: "auto", background: submission.entryMode==="external"?c.brass:c.card, color: submission.entryMode==="external"?c.brassOnBrass:c.paper }}>Enter off-platform deal</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
        {submission.entryMode==="existing" ? <>
          {label("Find a Buddy deal", <input aria-label="Search Buddy deals" style={field()} placeholder="Search by borrower, business, program, state, or reference…" value={dealSearch} onChange={e=>setDealSearch(e.target.value)}/>)}
          {label("Deal *", <select style={field()} value={submission.dealId} onChange={e => { const d=data.deals.find((x:any)=>x.id===e.target.value); setSubmission({...submission,dealId:e.target.value,amountSent:d?.loan_amount ?? ""}); }}><option value="">{visibleDeals.length ? "Select a deal" : "No matching deals"}</option>{visibleDeals.map((d:any)=><option key={d.id} value={d.id}>{d.display_name||d.borrower_name||d.name||"Untitled"} · {fmtMoney(Number(d.loan_amount||0))}</option>)}</select>)}
          {label("Amount sent", <input style={field()} type="number" min="0" value={submission.amountSent} onChange={e=>setSubmission({...submission,amountSent:e.target.value})}/>)}
        </> : <>
          {label("Deal / business name *", <input style={field()} placeholder="Example: Main Street Dental acquisition" value={submission.externalDealName} onChange={e=>setSubmission({...submission,externalDealName:e.target.value})}/>)}
          {label("Borrower or reference name", <input style={field()} placeholder="Optional" value={submission.borrowerName} onChange={e=>setSubmission({...submission,borrowerName:e.target.value})}/>)}
          {label("Loan program", <select style={field()} value={submission.productType} onChange={e=>setSubmission({...submission,productType:e.target.value})}><option value="SBA_7A">SBA 7(a)</option><option value="SBA_504">SBA 504</option><option value="SBA_EXPRESS">SBA Express</option><option value="TERM_LOAN">Conventional term loan</option><option value="LINE_OF_CREDIT">Line of credit</option><option value="CRE_OWNER_OCCUPIED">Owner-occupied CRE</option><option value="CRE_INVESTOR">Investor CRE</option></select>)}
          {label("Requested amount *", <input style={field()} type="number" min="1" value={submission.amountSent} onChange={e=>setSubmission({...submission,amountSent:e.target.value})}/>)}
          {label("Property / business state", <input style={field()} maxLength={2} placeholder="GA" value={submission.dealState} onChange={e=>setSubmission({...submission,dealState:e.target.value.toUpperCase()})}/>)}
          {label("How you received it", <input style={field()} placeholder="Banker handoff, referral partner…" value={submission.externalDealSource} onChange={e=>setSubmission({...submission,externalDealSource:e.target.value})}/>)}
          {label("External reference", <input style={field()} placeholder="Optional file or source ID" value={submission.externalReference} onChange={e=>setSubmission({...submission,externalReference:e.target.value})}/>)}
        </>}
        {label("Bank buyer *", <select style={field()} value={submission.lenderProfileId} onChange={e => { const profile=data.profiles.find((item:any)=>item.id===e.target.value); const bankerPersonId=profile?.contacts?.length===1?profile.contacts[0].id:""; setSubmission({...submission,lenderProfileId:e.target.value,bankerPersonId}); }}><option value="">Select a bank</option>{data.profiles.map((p:any)=><option key={p.id} value={p.id}>{p.organization?.name ?? "Unnamed bank"}</option>)}</select>)}
        {label("Banker", <select style={field()} value={submission.bankerPersonId} onChange={e=>setSubmission({...submission,bankerPersonId:e.target.value})}><option value="">Unassigned</option>{(selectedProfile?.contacts??[]).map((p:any)=><option key={p.id} value={p.id}>{[p.first_name,p.last_name].filter(Boolean).join(" ")||p.email}</option>)}</select>)}
        {label("Date sent", <input style={field()} type="datetime-local" value={submission.sentAt} onChange={e=>setSubmission({...submission,sentAt:e.target.value})}/>)}
        {label("Follow up", <input style={field()} type="datetime-local" value={submission.nextFollowUpAt} onChange={e=>setSubmission({...submission,nextFollowUpAt:e.target.value})}/>)}
        <label style={{ gridColumn: "1/-1", display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>Why this bank fits<textarea style={{ ...field(), minHeight: 55 }} placeholder="Optional matching rationale" value={submission.fitRationale} onChange={e=>setSubmission({...submission,fitRationale:e.target.value})}/></label>
        <label style={{ gridColumn: "1/-1", display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>Notes<textarea style={{ ...field(), minHeight: 65 }} placeholder="What was sent, relationship context, and next steps…" value={submission.notes} onChange={e=>setSubmission({...submission,notes:e.target.value})}/></label>
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button disabled={saving||!submission.lenderProfileId||(submission.entryMode==="existing"?!submission.dealId:(!submission.externalDealName.trim()||!Number(submission.amountSent)))} onClick={()=>post({action:submission.entryMode==="external"?"create_external_submission":"create_submission",...submission})} style={{ ...field(), width: "auto", background: c.brass, color: c.brassOnBrass }}>Record as sent</button>
        <button onClick={()=>setMode(null)} style={{ ...field(), width: "auto" }}>Cancel</button>
      </div>
    </section>}

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 14 }}>
      <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}><div style={{ padding: "11px 14px", borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.paper }}>Bank network</div>{data.profiles.length===0?<div style={{ padding: 22, color: c.textMuted, fontSize: 12 }}>Add each bank once, then associate its bankers, marketplace role, optional appetite, and deal history.</div>:data.profiles.map((p:any)=><Link href={`/admin/brokerage/crm/${p.organization_id}`} key={p.id} style={{ display: "block", padding: "11px 14px", borderBottom: `1px solid ${c.divider}`, textDecoration: "none" }}><div style={{ color: c.paper, fontSize: 12.5, fontWeight: 600 }}>{p.organization?.name}</div><div style={{ color: c.textMuted, fontSize: 10.5, marginTop: 3 }}>{p.marketplace_role ? `Marketplace ${String(p.marketplace_role).replaceAll("_"," & ")} · ${String(p.marketplace_access_status || "not_invited").replaceAll("_"," ")}` : "Not in marketplace"} · {p.contacts.length} banker{p.contacts.length===1?"":"s"} · {p.submissions.length} deal{p.submissions.length===1?"":"s"} · {p.relationship_status}</div><div style={{ color: c.textSecondary, fontSize: 10.5, marginTop: 3 }}>{[p.sba_7a_appetite&&"7(a)",p.sba_504_appetite&&"504",p.conventional_appetite&&"Conventional"].filter(Boolean).join(" · ")||"Appetite not set"}</div></Link>)}</section>
      <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}><div style={{ padding: "9px 12px", borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ color: c.paper, fontSize: 13 }}>Deal distribution ledger</strong><select style={{ ...field(), width: 135 }} value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Active</option><option value="all">All</option>{Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
        {loading?<div style={{ padding: 28, color: c.textMuted }}>Loading…</div>:visible.length===0?<div style={{ padding: 28, color: c.textMuted, fontSize: 12 }}>No matching deal submissions.</div>:visible.map((s:any)=><div key={s.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr .8fr .8fr 145px", gap: 10, padding: "11px 12px", borderBottom: `1px solid ${c.divider}`, alignItems: "center" }}><div><div style={{ color: c.paper, fontSize: 12, fontWeight: 600 }}>{s.deal?.display_name||s.deal?.borrower_name||s.deal?.name||"Untitled deal"}</div><div style={{ color: c.textMuted, fontSize: 10.5 }}>{fmtMoney(Number(s.amount_sent||0))}</div></div><div style={{ color: c.textSecondary, fontSize: 11.5 }}>{s.lender?.name||"Unknown bank"}</div><div style={{ color: c.textMuted, fontSize: 10.5 }}>{s.sent_at?new Date(s.sent_at).toLocaleDateString():"Not sent"}</div><div style={{ color: s.next_follow_up_at&&new Date(s.next_follow_up_at)<new Date()?c.brick:c.textMuted, fontSize: 10.5 }}>{s.next_follow_up_at?new Date(s.next_follow_up_at).toLocaleDateString():"No follow-up"}</div><select disabled={saving} style={field()} value={s.status} onChange={e=>changeStatus(s,e.target.value)}>{Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>)}
      </section>
    </div>
  </div>;
}
