"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { CrmTabs } from "@/components/brokerage/CrmTabs";
import { crmColors as c, fmtMoney } from "@/components/brokerage/tokens";

type Tab = "overview" | "people" | "marketplace" | "appetite" | "deals" | "activity";
type Json = Record<string, any>;

const STATUS: Record<string, string> = {
  planned: "Planned", sent: "Sent", reviewing: "In review", interested: "Interested",
  term_sheet: "Term sheet", approved: "Approved", declined: "Declined",
  withdrawn: "Withdrawn", lost: "Lost", closed: "Closed",
};
const ORG_TYPES = [
  ["lender", "Bank / Lender"], ["referral_source", "Referral source"],
  ["professional_partner", "Professional partner"], ["borrower_business", "Borrower business"],
  ["cpa_firm", "CPA firm"], ["law_firm", "Law firm"], ["insurance_provider", "Insurance provider"],
  ["appraisal_firm", "Appraisal firm"], ["environmental_firm", "Environmental firm"],
  ["title_company", "Title company"], ["franchise_organization", "Franchise organization"],
  ["seller", "Seller"], ["landlord", "Landlord"], ["investor", "Investor"], ["vendor", "Vendor"], ["other", "Other"],
];

function field(): CSSProperties {
  return { width: "100%", boxSizing: "border-box", background: c.ink, border: `1px solid ${c.border}`, borderRadius: 6, color: c.paper, padding: "9px 10px", fontSize: 12, fontFamily: "var(--font-brokerage-sans)" };
}
function label(title: string, child: ReactNode) {
  return <label style={{ display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>{title}{child}</label>;
}
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 9, overflow: "hidden" }}>
    <div style={{ padding: "12px 15px", borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <strong style={{ color: c.paper, fontSize: 13.5 }}>{title}</strong>{action}
    </div>
    <div style={{ padding: 15 }}>{children}</div>
  </section>;
}
function Button({ children, onClick, primary = false, disabled = false }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} style={{ background: primary ? c.brass : c.cardHover, border: `1px solid ${primary ? c.brass : c.borderStronger}`, color: primary ? c.brassOnBrass : c.paper, borderRadius: 6, padding: "8px 12px", fontWeight: 650, fontSize: 11.5, cursor: disabled ? "default" : "pointer", opacity: disabled ? .45 : 1 }}>{children}</button>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "20px 8px", textAlign: "center", color: c.textMuted, fontSize: 12, lineHeight: 1.6 }}>{children}</div>;
}
function personName(p: Json) { return [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unnamed contact"; }
function dealName(d: Json | null) { return d?.display_name || d?.borrower_name || d?.name || "Untitled deal"; }

export function OrganizationWorkspace({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Json | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [panel, setPanel] = useState<"contact" | "organization" | "marketplace" | "appetite" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState({ firstName: "", lastName: "", preferredName: "", jobTitle: "", role: "contact", email: "", phone: "", mobilePhone: "", linkedinUrl: "", communicationPreference: "email", notes: "" });
  const [orgForm, setOrgForm] = useState<Json>({});
  const [marketplace, setMarketplace] = useState<Json>({ marketplaceRole: "", marketplaceAccessStatus: "not_invited", marketplaceOnboardingNotes: "" });
  const [appetite, setAppetite] = useState<Json>({ relationshipStatus: "prospect", lenderType: "bank", sba7a: true, sba504: false, conventional: false, minLoanAmount: "", maxLoanAmount: "", minDscr: "", maxLtv: "", minimumFico: "", geographies: "", industries: "", excludedIndustries: "", collateralPreferences: "", dealPreferences: "", referralFeeBps: "", responseSlaDays: "" });
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/brokerage/crm/organizations/${orgId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Unable to load organization");
      const rolePeople = (json.peopleWithRoles || []).map((r: Json) => ({ ...r.person, job_title: r.job_title || r.person?.job_title, organization_role: r.role }));
      const byId = new Map<string, Json>();
      for (const p of [...(json.people || []), ...rolePeople]) if (p?.id) byId.set(p.id, { ...byId.get(p.id), ...p });
      json.people = Array.from(byId.values());
      setData(json);
      setOrgForm({
        name: json.organization.name || "", organizationType: json.organization.organization_type || "other",
        websiteUrl: json.organization.website_url || "", phone: json.organization.phone || "",
        addressLine1: json.organization.address_line1 || "", city: json.organization.city || "",
        state: json.organization.state || "", postalCode: json.organization.postal_code || "",
        notes: json.organization.notes || "",
      });
      if (json.lenderProfile) {
        const p = json.lenderProfile;
        setMarketplace({ marketplaceRole: p.marketplace_role || "", marketplaceAccessStatus: p.marketplace_access_status || "not_invited", marketplaceOnboardingNotes: p.marketplace_onboarding_notes || "" });
        setAppetite({
          relationshipStatus: p.relationship_status || "prospect", lenderType: p.lender_type || "bank",
          sba7a: p.sba_7a_appetite, sba504: p.sba_504_appetite, conventional: p.conventional_appetite,
          minLoanAmount: p.min_loan_amount ?? "", maxLoanAmount: p.max_loan_amount ?? "", minDscr: p.min_dscr ?? "",
          maxLtv: p.max_ltv ?? "", minimumFico: p.minimum_fico ?? "", geographies: (p.geographies || []).join(", "),
          industries: (p.industries || []).join(", "), excludedIndustries: (p.excluded_industries || []).join(", "),
          collateralPreferences: (p.collateral_preferences || []).join(", "), dealPreferences: p.deal_preferences || "",
          referralFeeBps: p.referral_fee_bps ?? "", responseSlaDays: p.response_sla_days ?? "",
        });
      }
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function saveContact() {
    if (!contact.firstName.trim() && !contact.lastName.trim() && !contact.email.trim()) return setError("Enter a name or email for the contact.");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...contact, organizationId: orgId, organizationRole: contact.role }) });
      const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error || "Unable to add contact");
      setContact({ firstName: "", lastName: "", preferredName: "", jobTitle: "", role: "contact", email: "", phone: "", mobilePhone: "", linkedinUrl: "", communicationPreference: "email", notes: "" });
      setPanel(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function saveOrganization() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/organizations/${orgId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(orgForm) });
      const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error || "Unable to update organization");
      setPanel(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function saveAppetite() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations/buyers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upsert_buyer_profile", organizationId: orgId, ...appetite }) });
      const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error || "Unable to save lending appetite");
      setPanel(null); setTab("appetite"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function saveMarketplace() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations/buyers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_marketplace_profile", organizationId: orgId, ...marketplace }) });
      const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error || "Unable to save marketplace participation");
      setPanel(null); setTab("marketplace"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function logNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "note", organizationId: orgId, title: note.slice(0, 80), properties: { body: note } }) });
      const json = await res.json(); if (!res.ok || !json.ok) throw new Error(json.error || "Unable to save note");
      setNote(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const org = data?.organization;
  const people = data?.people || [];
  const profile = data?.lenderProfile;
  const submissions = data?.lenderSubmissions || [];
  const isLender = org?.organization_type === "lender" || !!profile;
  const setup = useMemo(() => [
    { done: org?.organization_type && org.organization_type !== "other", label: "Identify organization type", action: () => setPanel("organization") },
    { done: people.length > 0, label: "Add a primary banker or contact", action: () => setPanel("contact") },
    { done: submissions.length > 0, label: "Send and track the first deal", href: `/admin/brokerage/crm/buyers?organizationId=${orgId}&new=submission` },
  ], [org, people.length, submissions.length]);
  const complete = setup.filter(x => x.done).length;

  if (!data && !error) return <div style={{ padding: 24, color: c.textMuted }}>Loading relationship workspace…</div>;
  if (!data) return <div style={{ padding: 24, color: c.brick }}>{error}</div>;

  const tabItems: Array<[Tab, string, number | null]> = [
    ["overview", "Overview", null], ["people", "People", people.length], ["marketplace", "Marketplace", null], ["appetite", "Lending appetite", null],
    ["deals", "Deals", submissions.length], ["activity", "Activity", data.activities?.length || 0],
  ];

  return <div style={{ padding: "18px 24px 48px", maxWidth: 1180 }}>
    <CrmTabs />
    <Link href="/admin/brokerage/crm" style={{ color: c.textMuted, fontSize: 11.5, textDecoration: "none" }}>← All organizations</Link>

    <div style={{ margin: "14px 0 18px", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 420px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 28 }}>{org.name}</h1>
          <span style={{ border: `1px solid ${isLender ? "rgba(184,144,91,.55)" : c.border}`, background: isLender ? "rgba(184,144,91,.1)" : c.card, color: isLender ? c.brassBright : c.textSecondary, borderRadius: 20, padding: "3px 8px", fontSize: 10.5 }}>
            {isLender ? "Bank / Lender" : (ORG_TYPES.find(x => x[0] === org.organization_type)?.[1] || "Organization")}
          </span>
          {profile?.marketplace_role && <span style={{ border: "1px solid rgba(92,139,111,.45)", background: "rgba(92,139,111,.1)", color: c.sage, borderRadius: 20, padding: "3px 8px", fontSize: 10.5 }}>{marketplaceRoleLabel(profile.marketplace_role)}</span>}
        </div>
        <div style={{ color: c.textMuted, fontSize: 12, marginTop: 6 }}>
          {[org.city, org.state].filter(Boolean).join(", ") || "Location not added"} · {people.length} contact{people.length === 1 ? "" : "s"}{profile ? ` · ${profile.relationship_status}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button onClick={() => setPanel("contact")} primary>+ Add banker / contact</Button>
        <Button onClick={() => setPanel("organization")}>Edit organization</Button>
        <Button onClick={() => setPanel("marketplace")}>{profile?.marketplace_role ? "Marketplace status" : "Add to marketplace"}</Button>
        <Button onClick={() => setPanel("appetite")}>{profile ? "Edit appetite" : "Set lending appetite"}</Button>
        <Link href={`/admin/brokerage/crm/buyers?organizationId=${orgId}&new=submission`} style={{ textDecoration: "none" }}><Button>Send a deal</Button></Link>
      </div>
    </div>

    {error && <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12 }}>{error}</div>}

    {complete < setup.length && <div style={{ background: "linear-gradient(100deg, rgba(184,144,91,.12), rgba(184,144,91,.035))", border: "1px solid rgba(184,144,91,.28)", borderRadius: 9, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}><strong style={{ color: c.paper, fontSize: 13 }}>Finish setting up this relationship</strong><span style={{ color: c.brassBright, fontSize: 11 }}>{complete} of {setup.length} complete</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
        {setup.map((s, i) => ("href" in s && s.href) ? <Link key={s.label} href={s.href} style={{ textDecoration: "none" }}><SetupItem {...s} index={i} /></Link> : <button key={s.label} onClick={s.action} style={{ padding: 0, border: 0, background: "none", textAlign: "left", cursor: "pointer" }}><SetupItem {...s} index={i} /></button>)}
      </div>
    </div>}

    <div style={{ display: "flex", gap: 4, overflowX: "auto", borderBottom: `1px solid ${c.border}`, marginBottom: 16 }}>
      {tabItems.map(([id, title, count]) => <button key={id} onClick={() => setTab(id)} style={{ whiteSpace: "nowrap", border: 0, borderBottom: `2px solid ${tab === id ? c.brassBright : "transparent"}`, background: "transparent", color: tab === id ? c.paper : c.textMuted, padding: "9px 12px", cursor: "pointer", fontSize: 11.5 }}>{title}{count !== null ? ` (${count})` : ""}</button>)}
    </div>

    {panel === "contact" && <ContactForm value={contact} setValue={setContact} busy={busy} save={saveContact} cancel={() => setPanel(null)} />}
    {panel === "marketplace" && <MarketplaceForm value={marketplace} setValue={setMarketplace} busy={busy} save={saveMarketplace} cancel={() => setPanel(null)} />}
    {panel === "organization" && <OrganizationForm value={orgForm} setValue={setOrgForm} busy={busy} save={saveOrganization} cancel={() => setPanel(null)} />}
    {panel === "appetite" && <AppetiteForm value={appetite} setValue={setAppetite} busy={busy} save={saveAppetite} cancel={() => setPanel(null)} />}

    {tab === "overview" && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <Card title="People at this organization" action={<button onClick={() => setPanel("contact")} style={{ border: 0, background: "none", color: c.brassBright, cursor: "pointer", fontSize: 11 }}>+ Add contact</button>}>
        {people.length ? people.slice(0, 4).map((p: Json) => <Person key={p.id} person={p} />) : <Empty>No contacts yet. Add the banker, credit officer, decision-maker, or referral contact you work with.</Empty>}
      </Card>
      <Card title="Marketplace participation" action={<button onClick={() => setPanel("marketplace")} style={{ border: 0, background: "none", color: c.brassBright, cursor: "pointer", fontSize: 11 }}>{profile?.marketplace_role ? "Edit" : "Set up"}</button>}>
        <MarketplaceSummary profile={profile} />
      </Card>
      <Card title="What this bank buys" action={<button onClick={() => setPanel("appetite")} style={{ border: 0, background: "none", color: c.brassBright, cursor: "pointer", fontSize: 11 }}>{profile ? "Edit" : "Set up"}</button>}>
        {profile ? <AppetiteSummary profile={profile} /> : <Empty>Capture loan size, programs, credit box, geography, industries, and response expectations.</Empty>}
      </Card>
      <Card title="Deal relationship">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          <Metric label="Sent" value={submissions.filter((x: Json) => x.status !== "planned").length} />
          <Metric label="Interested" value={submissions.filter((x: Json) => ["interested","term_sheet","approved","closed"].includes(x.status)).length} />
          <Metric label="Closed" value={submissions.filter((x: Json) => x.status === "closed").length} />
        </div>
      </Card>
      <Card title="Organization details">
        <Details org={org} />
      </Card>
    </div>}

    {tab === "people" && <Card title="Bankers and contacts" action={<Button onClick={() => setPanel("contact")} primary>+ Add contact</Button>}>
      {people.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10 }}>{people.map((p: Json) => <Person key={p.id} person={p} card />)}</div> : <Empty>No people are associated yet. Add a person here and Buddy will link them to {org.name} automatically.</Empty>}
    </Card>}

    {tab === "marketplace" && <Card title="Marketplace participation" action={<Button onClick={() => setPanel("marketplace")}>{profile?.marketplace_role ? "Edit participation" : "Add to marketplace"}</Button>}>
      <MarketplaceSummary profile={profile} expanded />
    </Card>}

    {tab === "appetite" && <Card title="Lending appetite" action={<Button onClick={() => setPanel("appetite")}>{profile ? "Edit appetite" : "Set up bank buyer"}</Button>}>
      {profile ? <AppetiteSummary profile={profile} expanded /> : <Empty>This organization is not configured as a bank buyer yet. “Set up bank buyer” converts it in place and keeps all existing contacts and history.</Empty>}
    </Card>}

    {tab === "deals" && <Card title="Deals sent to this bank" action={<Link href={`/admin/brokerage/crm/buyers?organizationId=${orgId}&new=submission`} style={{ textDecoration: "none" }}><Button primary>+ Send a deal</Button></Link>}>
      {!submissions.length ? <Empty>No deals sent yet. Appetite is optional—send the first deal now and add what this bank likes as you learn it.</Empty> : submissions.map((s: Json) => <div key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.5fr) minmax(100px,.7fr) minmax(90px,.6fr) minmax(90px,.6fr)", gap: 10, padding: "11px 0", borderBottom: `1px solid ${c.divider}`, alignItems: "center" }}>
        <div><div style={{ color: c.paper, fontWeight: 600, fontSize: 12.5 }}>{dealName(s.deal)}</div><div style={{ color: c.textMuted, fontSize: 10.5, marginTop: 3 }}>Sent {s.sent_at ? new Date(s.sent_at).toLocaleDateString() : "not yet"}</div></div>
        <div style={{ color: c.textSecondary, fontSize: 11.5 }}>{fmtMoney(Number(s.amount_sent || s.deal?.loan_amount || 0))}</div>
        <span style={{ color: ["interested","term_sheet","approved","closed"].includes(s.status) ? c.sage : c.textSecondary, fontSize: 11 }}>{STATUS[s.status] || s.status}</span>
        <div style={{ color: c.textMuted, fontSize: 10.5 }}>{s.status === "closed" ? fmtMoney(Number(s.closed_amount || 0)) : s.next_follow_up_at ? `Follow up ${new Date(s.next_follow_up_at).toLocaleDateString()}` : "No follow-up"}</div>
      </div>)}
    </Card>}

    {tab === "activity" && <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) minmax(280px,.7fr)", gap: 14 }}>
      <Card title="Add a note"><textarea style={{ ...field(), minHeight: 100, resize: "vertical" }} placeholder="What happened? Include context and next steps…" value={note} onChange={e => setNote(e.target.value)} /><div style={{ marginTop: 9 }}><Button onClick={logNote} primary disabled={busy || !note.trim()}>Save note</Button></div></Card>
      <Card title="Relationship history">{data.activities?.length ? data.activities.map((a: Json) => <div key={a.id} style={{ padding: "9px 0", borderBottom: `1px solid ${c.divider}` }}><div style={{ color: c.paper, fontSize: 11.5 }}>{a.title || a.kind}</div><div style={{ color: c.textMuted, fontSize: 10, marginTop: 3 }}>{new Date(a.happens_at).toLocaleString()}</div></div>) : <Empty>No activity yet.</Empty>}</Card>
    </div>}
  </div>;
}

function SetupItem({ done, label, index }: { done: boolean; label: string; index: number }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, background: done ? "rgba(92,139,111,.09)" : c.card, border: `1px solid ${done ? "rgba(92,139,111,.32)" : c.border}`, borderRadius: 6, padding: "9px 10px" }}><span style={{ width: 20, height: 20, display: "grid", placeItems: "center", borderRadius: "50%", background: done ? c.sage : c.borderStrong, color: done ? "#FFFFFF" : c.textSecondary, fontSize: 10, fontWeight: 700 }}>{done ? "✓" : index + 1}</span><span style={{ color: done ? c.textSecondary : c.paper, fontSize: 11 }}>{label}</span></div>;
}
function Person({ person: p, card = false }: { person: Json; card?: boolean }) {
  return <div style={{ padding: card ? 12 : "9px 0", border: card ? `1px solid ${c.border}` : 0, borderBottom: card ? undefined : `1px solid ${c.divider}`, borderRadius: card ? 7 : 0 }}>
    <div style={{ color: c.paper, fontSize: 12.5, fontWeight: 600 }}>{personName(p)}</div>
    <div style={{ color: c.textMuted, fontSize: 10.5, marginTop: 3 }}>{[p.job_title, p.organization_role?.replaceAll("_", " ")].filter(Boolean).join(" · ") || "Role not added"}</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>{p.email && <a href={`mailto:${p.email}`} style={{ color: c.brassBright, fontSize: 10.5 }}>{p.email}</a>}{(p.mobile_phone || p.phone) && <a href={`tel:${p.mobile_phone || p.phone}`} style={{ color: c.textSecondary, fontSize: 10.5 }}>{p.mobile_phone || p.phone}</a>}</div>
  </div>;
}
function Metric({ label: name, value }: { label: string; value: number }) { return <div style={{ background: c.ink, border: `1px solid ${c.border}`, borderRadius: 7, padding: 11 }}><div style={{ color: c.textMuted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 1 }}>{name}</div><div style={{ color: c.paper, fontFamily: "var(--font-brokerage-mono)", fontSize: 20, marginTop: 5 }}>{value}</div></div>; }
function Details({ org }: { org: Json }) { return <div style={{ display: "grid", gap: 9, fontSize: 11.5 }}>{[["Website", org.website_url],["Phone",org.phone],["Address",[org.address_line1,org.city,org.state,org.postal_code].filter(Boolean).join(", ")],["Notes",org.notes]].map(([k,v]) => <div key={k} style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 10 }}><span style={{ color: c.textMuted }}>{k}</span><span style={{ color: v ? c.textSecondary : c.textFaint }}>{v || "Not added"}</span></div>)}</div>; }
function marketplaceRoleLabel(role?: string) {
  return ({ buyer: "Marketplace Buyer", seller: "Marketplace Seller", buyer_seller: "Marketplace Buyer & Seller", viewer: "Marketplace Viewer" } as Record<string, string>)[role || ""] || "Not participating";
}
function MarketplaceSummary({ profile: p, expanded = false }: { profile?: Json; expanded?: boolean }) {
  const role = marketplaceRoleLabel(p?.marketplace_role);
  const access = (p?.marketplace_access_status || "not_invited").replaceAll("_", " ");
  return <div style={{ display: "grid", gap: 9 }}>
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10 }}><span style={{ color: c.textMuted, fontSize: 10.5 }}>Marketplace role</span><span style={{ color: p?.marketplace_role ? c.sage : c.textSecondary, fontSize: 11.5 }}>{role}</span></div>
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10 }}><span style={{ color: c.textMuted, fontSize: 10.5 }}>Access</span><span style={{ color: c.textSecondary, fontSize: 11.5, textTransform: "capitalize" }}>{access}</span></div>
    {expanded && <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10 }}><span style={{ color: c.textMuted, fontSize: 10.5 }}>Onboarding notes</span><span style={{ color: c.textSecondary, fontSize: 11.5 }}>{p?.marketplace_onboarding_notes || "No onboarding notes."}</span></div>}
    {!p?.marketplace_role && <div style={{ color: c.textMuted, fontSize: 11, lineHeight: 1.55 }}>Use this single bank record for marketplace access and brokerage relationships. No duplicate organization is needed.</div>}
  </div>;
}
function AppetiteSummary({ profile: p, expanded = false }: { profile: Json; expanded?: boolean }) {
  const programs = [p.sba_7a_appetite && "SBA 7(a)", p.sba_504_appetite && "SBA 504", p.conventional_appetite && "Conventional"].filter(Boolean);
  const rows = [["Programs", programs.join(", ") || "Not set"],["Loan size", p.min_loan_amount || p.max_loan_amount ? `${p.min_loan_amount ? fmtMoney(Number(p.min_loan_amount)) : "Any"} – ${p.max_loan_amount ? fmtMoney(Number(p.max_loan_amount)) : "Any"}` : "Not set"],["Credit box", [p.min_dscr && `DSCR ≥ ${p.min_dscr}`,p.max_ltv && `LTV ≤ ${Math.round(Number(p.max_ltv) * 100)}%`,p.minimum_fico && `FICO ≥ ${p.minimum_fico}`].filter(Boolean).join(" · ") || "Not set"],["Geography",(p.geographies||[]).join(", ")||"Not set"],["Industries",(p.industries||[]).join(", ")||"Not set"],["Excluded",(p.excluded_industries||[]).join(", ")||"None"],["Response target",p.response_sla_days ? `${p.response_sla_days} days` : "Not set"],["Deal preferences",p.deal_preferences||"Not set"]];
  return <div style={{ display: "grid", gridTemplateColumns: expanded ? "repeat(auto-fit,minmax(240px,1fr))" : "1fr", gap: expanded ? 10 : 7 }}>{rows.slice(0, expanded ? rows.length : 5).map(([k,v]) => <div key={k} style={{ display: "grid", gridTemplateColumns: "95px 1fr", gap: 8, background: expanded ? c.ink : "transparent", border: expanded ? `1px solid ${c.border}` : 0, borderRadius: 6, padding: expanded ? 10 : 0 }}><span style={{ color: c.textMuted, fontSize: 10.5 }}>{k}</span><span style={{ color: c.textSecondary, fontSize: 11.5 }}>{v}</span></div>)}</div>;
}
function FormShell({ title, description, children, save, cancel, busy, saveLabel }: { title: string; description: string; children: ReactNode; save: () => void; cancel: () => void; busy: boolean; saveLabel: string }) {
  return <section style={{ background: c.card, border: "1px solid rgba(184,144,91,.4)", borderRadius: 9, padding: 16, marginBottom: 16 }}>
    <h2 style={{ color: c.paper, fontSize: 16, margin: 0 }}>{title}</h2><p style={{ color: c.textMuted, fontSize: 11.5, margin: "5px 0 15px" }}>{description}</p>{children}
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}><Button onClick={save} primary disabled={busy}>{busy ? "Saving…" : saveLabel}</Button><Button onClick={cancel}>Cancel</Button></div>
  </section>;
}
function ContactForm({ value: v, setValue: set, busy, save, cancel }: any) {
  return <FormShell title="Add a banker or contact" description="This person will be associated with this organization automatically." save={save} cancel={cancel} busy={busy} saveLabel="Add contact"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
    {label("First name", <input style={field()} value={v.firstName} onChange={e=>set({...v,firstName:e.target.value})}/>)}{label("Last name", <input style={field()} value={v.lastName} onChange={e=>set({...v,lastName:e.target.value})}/>)}{label("Preferred name", <input style={field()} value={v.preferredName} onChange={e=>set({...v,preferredName:e.target.value})}/>)}{label("Job title", <input style={field()} placeholder="SBA Business Development Officer" value={v.jobTitle} onChange={e=>set({...v,jobTitle:e.target.value})}/>)}
    {label("Relationship role", <select style={field()} value={v.role} onChange={e=>set({...v,role:e.target.value})}><option value="primary_contact">Primary contact</option><option value="decision_maker">Decision maker</option><option value="contact">Contact</option><option value="referral_contact">Referral contact</option><option value="billing_contact">Billing contact</option><option value="other">Other</option></select>)}{label("Preferred communication", <select style={field()} value={v.communicationPreference} onChange={e=>set({...v,communicationPreference:e.target.value})}><option value="email">Email</option><option value="phone">Phone</option><option value="sms">Text</option><option value="no_preference">No preference</option></select>)}
    {label("Email", <input type="email" style={field()} value={v.email} onChange={e=>set({...v,email:e.target.value})}/>)}{label("Office phone", <input style={field()} value={v.phone} onChange={e=>set({...v,phone:e.target.value})}/>)}{label("Mobile phone", <input style={field()} value={v.mobilePhone} onChange={e=>set({...v,mobilePhone:e.target.value})}/>)}{label("LinkedIn", <input style={field()} value={v.linkedinUrl} onChange={e=>set({...v,linkedinUrl:e.target.value})}/>)}
    <label style={{ gridColumn: "1/-1", display: "grid", gap: 5, color: c.textMuted, fontSize: 10.5 }}>Notes<textarea style={{...field(),minHeight:65}} placeholder="Coverage area, authority, preferences, relationship context…" value={v.notes} onChange={e=>set({...v,notes:e.target.value})}/></label>
  </div></FormShell>;
}
function OrganizationForm({ value: v, setValue: set, busy, save, cancel }: any) {
  return <FormShell title="Edit organization" description="Keep the entity record accurate. Choose Bank / lender to enable deal distribution." save={save} cancel={cancel} busy={busy} saveLabel="Save organization"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
    {label("Organization name", <input style={field()} value={v.name} onChange={e=>set({...v,name:e.target.value})}/>)}{label("Type", <select style={field()} value={v.organizationType} onChange={e=>set({...v,organizationType:e.target.value})}>{ORG_TYPES.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>)}{label("Website", <input style={field()} value={v.websiteUrl} onChange={e=>set({...v,websiteUrl:e.target.value})}/>)}{label("Main phone", <input style={field()} value={v.phone} onChange={e=>set({...v,phone:e.target.value})}/>)}
    {label("Street address", <input style={field()} value={v.addressLine1} onChange={e=>set({...v,addressLine1:e.target.value})}/>)}{label("City", <input style={field()} value={v.city} onChange={e=>set({...v,city:e.target.value})}/>)}{label("State", <input style={field()} value={v.state} onChange={e=>set({...v,state:e.target.value})}/>)}{label("Postal code", <input style={field()} value={v.postalCode} onChange={e=>set({...v,postalCode:e.target.value})}/>)}
    <label style={{ gridColumn:"1/-1",display:"grid",gap:5,color:c.textMuted,fontSize:10.5 }}>Relationship notes<textarea style={{...field(),minHeight:65}} value={v.notes} onChange={e=>set({...v,notes:e.target.value})}/></label>
  </div></FormShell>;
}
function MarketplaceForm({ value: v, setValue: set, busy, save, cancel }: any) {
  return <FormShell title="Marketplace participation" description="Classify how this bank uses the SBA marketplace. This is independent from lending appetite and can be changed at any time." save={save} cancel={cancel} busy={busy} saveLabel="Save marketplace status"><div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10 }}>
    {label("Marketplace role", <select style={field()} value={v.marketplaceRole} onChange={e=>set({...v,marketplaceRole:e.target.value})}><option value="">Not participating</option><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="buyer_seller">Buyer & seller</option><option value="viewer">Viewer</option></select>)}
    {label("Access status", <select style={field()} value={v.marketplaceAccessStatus} onChange={e=>set({...v,marketplaceAccessStatus:e.target.value})}><option value="not_invited">Not invited</option><option value="invited">Invited</option><option value="onboarding">Onboarding</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option></select>)}
    <label style={{gridColumn:"1/-1",display:"grid",gap:5,color:c.textMuted,fontSize:10.5}}>Onboarding notes<textarea style={{...field(),minHeight:70}} placeholder="Access owner, training status, marketplace permissions, next steps…" value={v.marketplaceOnboardingNotes} onChange={e=>set({...v,marketplaceOnboardingNotes:e.target.value})}/></label>
  </div></FormShell>;
}
function AppetiteForm({ value: v, setValue: set, busy, save, cancel }: any) {
  return <FormShell title="Define lending appetite" description="Optional: record what you know today and refine it as the bank reviews deals. Appetite is never required to send a deal." save={save} cancel={cancel} busy={busy} saveLabel="Save lending appetite"><div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10 }}>
    {label("Relationship stage",<select style={field()} value={v.relationshipStatus} onChange={e=>set({...v,relationshipStatus:e.target.value})}><option value="prospect">Prospect</option><option value="qualified">Qualified</option><option value="active">Active</option><option value="preferred">Preferred</option><option value="paused">Paused</option><option value="inactive">Inactive</option></select>)}{label("Lender type",<select style={field()} value={v.lenderType} onChange={e=>set({...v,lenderType:e.target.value})}><option value="bank">Bank</option><option value="credit_union">Credit union</option><option value="non_bank">Non-bank lender</option><option value="investor">Investor</option><option value="other">Other</option></select>)}{label("Minimum loan",<input type="number" style={field()} value={v.minLoanAmount} onChange={e=>set({...v,minLoanAmount:e.target.value})}/>)}{label("Maximum loan",<input type="number" style={field()} value={v.maxLoanAmount} onChange={e=>set({...v,maxLoanAmount:e.target.value})}/>)}{label("Minimum DSCR",<input type="number" step=".01" style={field()} value={v.minDscr} onChange={e=>set({...v,minDscr:e.target.value})}/>)}{label("Maximum LTV (decimal)",<input type="number" style={field()} value={v.maxLtv} onChange={e=>set({...v,maxLtv:e.target.value})}/>)}{label("Minimum FICO",<input type="number" style={field()} value={v.minimumFico} onChange={e=>set({...v,minimumFico:e.target.value})}/>)}{label("Response target (days)",<input type="number" style={field()} value={v.responseSlaDays} onChange={e=>set({...v,responseSlaDays:e.target.value})}/>)}
    <div style={{gridColumn:"1/-1",display:"flex",gap:18,flexWrap:"wrap",color:c.textSecondary,fontSize:11.5}}><label><input type="checkbox" checked={v.sba7a} onChange={e=>set({...v,sba7a:e.target.checked})}/> SBA 7(a)</label><label><input type="checkbox" checked={v.sba504} onChange={e=>set({...v,sba504:e.target.checked})}/> SBA 504</label><label><input type="checkbox" checked={v.conventional} onChange={e=>set({...v,conventional:e.target.checked})}/> Conventional</label></div>
    {label("Geographies (comma separated)",<input style={field()} value={v.geographies} onChange={e=>set({...v,geographies:e.target.value})}/>)}{label("Industries",<input style={field()} value={v.industries} onChange={e=>set({...v,industries:e.target.value})}/>)}{label("Excluded industries",<input style={field()} value={v.excludedIndustries} onChange={e=>set({...v,excludedIndustries:e.target.value})}/>)}{label("Collateral preferences",<input style={field()} value={v.collateralPreferences} onChange={e=>set({...v,collateralPreferences:e.target.value})}/>)}
    <label style={{gridColumn:"1/-1",display:"grid",gap:5,color:c.textMuted,fontSize:10.5}}>Deal preferences<textarea style={{...field(),minHeight:65}} placeholder="Owner experience, property types, franchises, special situations, structure notes…" value={v.dealPreferences} onChange={e=>set({...v,dealPreferences:e.target.value})}/></label>
  </div></FormShell>;
}
