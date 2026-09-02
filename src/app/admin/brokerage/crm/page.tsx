"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { crmColors as c, fmtMoney } from "@/components/brokerage/tokens";
import { RefinedStamp } from "@/components/brokerage/StatusStamp";
import { CrmTabs } from "@/components/brokerage/CrmTabs";
import { useCrmExperience } from "@/components/brokerage/CrmExperienceProvider";
import { CrmHomeWorkbench as CrmToday } from "@/components/brokerage/CrmHomeWorkbench";
import { useCrmWorkspace } from "@/components/brokerage/CrmWorkspaceFrame";
import { CrmCompanyCards } from "@/components/brokerage/CrmCompanyCards";

/**
 * CRM command center — not a list, a dashboard. Summary tiles, a
 * needs-attention queue (relationships gone stale), a cross-organization
 * activity feed, an open-task queue, then the organizations themselves
 * with real signal on each row: health status derived from staleness,
 * and deals-referred / dollars-sourced via deals.referral_source_org_id
 * (migration crm_deal_attribution) — the piece that ties a relationship
 * to whether it's actually worth the time.
 */

type Organization = {
  id: string;
  name: string;
  organization_type: string;
  city: string | null;
  state: string | null;
  peopleCount: number;
  lastActivityAt: string | null;
  health: "active" | "cooling" | "cold" | "new";
  dealsReferredCount: number;
  dealsReferredValue: number;
  state_code: string | null;
  tags: string[] | null;
  relationship_tier: string | null;
  owner_clerk_user_id: string | null;
};

type TeamMember = { clerkUserId: string; firstName: string | null; lastName: string | null; email: string | null };

type Summary = {
  organizationCount: number;
  contactCount: number;
  dealsReferredCount: number;
  valueSourced: number;
  needsAttentionCount: number;
};

type FeedItem = {
  id: string;
  kind: string;
  title: string | null;
  happens_at: string;
  due_at: string | null;
  organizationId: string | null;
  organizationName: string | null;
};

/**
 * Column gap is load-bearing, not decoration: without it the right-aligned
 * Contacts column butted straight into the next header and the table read
 * "CONTACTSLAST TOUCH".
 */
const GRID = "minmax(0, 1.6fr) minmax(0, 1fr) 130px minmax(0, 1fr) 74px 96px 96px";
const GRID_GAP = 14;

const TYPE_LABELS: Record<string, string> = {
  referral_source: "Referral source",
  professional_partner: "Professional partner",
  borrower_business: "Borrower business",
  cpa_firm: "CPA firm",
  law_firm: "Law firm",
  lender: "Bank / Lender",
  insurance_provider: "Insurance provider",
  appraisal_firm: "Appraisal firm",
  environmental_firm: "Environmental firm",
  title_company: "Title company",
  franchise_organization: "Franchise organization",
  seller: "Seller",
  landlord: "Landlord",
  investor: "Investor",
  vendor: "Vendor",
  other: "Other",
};

const TIER_LABELS: Record<string, string> = {
  strategic: "Strategic",
  core: "Core",
  developing: "Developing",
  dormant: "Dormant",
};

const HEALTH_LABEL: Record<string, string> = {
  active: "active",
  cooling: "cooling",
  cold: "cold",
  new: "new",
};
const HEALTH_STATUS_KEY: Record<string, string> = {
  active: "active",
  cooling: "neutral",
  cold: "overdue",
  new: "neutral",
};

function inputStyle(): CSSProperties {
  return {
    background: c.ink,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: "8px 10px",
    color: c.paper,
    fontSize: 12,
    fontFamily: "var(--font-brokerage-sans)",
    width: "100%",
  };
}

function daysAgo(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: accent }} />
      <div style={{ fontSize: 11, color: c.textSecondary }}>{label}</div>
      <div style={{ fontFamily: "var(--font-brokerage-mono)", fontWeight: 600, fontSize: 24, color: c.paper, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export default function BrokerageCrmPage() {
  const { enabled, section } = useCrmExperience();
  const workspace = useCrmWorkspace();
  const [snapshotNow, setSnapshotNow] = useState(0);
  const [healthFilter, setHealthFilter] = useState(false);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [needsAttention, setNeedsAttention] = useState<Organization[]>([]);
  const [recentActivity, setRecentActivity] = useState<FeedItem[]>([]);
  const [openTasks, setOpenTasks] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [team, setTeam] = useState<TeamMember[]>([]);

  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);

  const displayActivity = useMemo(() => {
    const seen = new Set<string>();
    return recentActivity.filter((activity) => {
      const key = [activity.kind, activity.title, activity.organizationId].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [recentActivity]);

  const filteredOrgs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgs.filter((o) => {
      if (healthFilter && o.health !== "cold" && o.health !== "cooling") return false;
      if (typeFilter !== "all" && o.organization_type !== typeFilter) return false;
      if (tagFilter !== "all" && !(o.tags ?? []).includes(tagFilter)) return false;
      if (ownerFilter === "unassigned" && o.owner_clerk_user_id) return false;
      if (ownerFilter !== "all" && ownerFilter !== "unassigned" && o.owner_clerk_user_id !== ownerFilter) return false;
      if (!q) return true;
      return [o.name, o.city, o.state, o.state_code, TYPE_LABELS[o.organization_type], ...(o.tags ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [orgs, search, typeFilter, tagFilter, ownerFilter, healthFilter]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setOrgs(json.organizations ?? []);
      setSummary(json.summary ?? null);
      setNeedsAttention(json.needsAttention ?? []);
      setRecentActivity(json.recentActivity ?? []);
      setOpenTasks(json.openTasks ?? []);
      setSnapshotNow(Date.now());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // The roster names relationship owners. A failure here costs the owner
    // column its names, not the page.
    void fetch("/api/admin/brokerage/team")
      .then((res) => res.json())
      .then((json) => { if (json?.ok) setTeam(json.team ?? []); })
      .catch(() => {});
  }, [workspace?.revision]);

  const ownerName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of team) {
      map[m.clerkUserId] = [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email || "Teammate";
    }
    return map;
  }, [team]);

  const allTags = useMemo(
    () => Array.from(new Set(orgs.flatMap((o) => o.tags ?? []))).sort(),
    [orgs],
  );

  async function createOrg() {
    if (!name.trim() || !type) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, organizationType: type, city: city || null, state: state || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "create failed");
      setName("");
      setType("");
      setCity("");
      setState("");
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "create failed");
    } finally {
      setSaving(false);
    }
  }

  if (enabled && section === "today") {
    return <div style={{ padding: "18px 24px 40px" }}><CrmTabs /><CrmToday loading={loading} error={error} tasks={openTasks} relationships={needsAttention} activity={displayActivity} organizations={orgs} onRetry={() => void load()} now={snapshotNow} /></div>;
  }

  return (
    <div className={enabled ? "crm-experience" : undefined} style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Summary tiles */}
      {!enabled && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Tile label="Organizations" value={summary ? String(summary.organizationCount) : "—"} accent={c.brass} />
        <Tile label="Contacts" value={summary ? String(summary.contactCount) : "—"} accent={c.brass} />
        <Tile label="Deals sourced" value={summary ? String(summary.dealsReferredCount) : "—"} accent={c.sage} />
        <Tile label="Value sourced" value={summary ? fmtMoney(summary.valueSourced) : "—"} accent={c.sage} />
        <Tile label="Needs attention" value={summary ? String(summary.needsAttentionCount) : "—"} accent={summary && summary.needsAttentionCount > 0 ? c.brick : c.textFaint} />
      </div>

      {/* Needs attention + feeds */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14 }}>
            Needs attention
          </div>
          {needsAttention.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Nothing's gone cold — every relationship has recent activity.</div>
          ) : (
            needsAttention.map((o) => (
              <Link
                key={o.id}
                href={`/admin/brokerage/crm/${o.id}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 16px", borderBottom: `1px solid ${c.divider}`, textDecoration: "none", color: "inherit" }}
              >
                <div>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: c.paper }}>{o.name}</span>
                  <span style={{ fontSize: 11, color: c.textMuted }}> · last touch {daysAgo(o.lastActivityAt)}</span>
                </div>
                <RefinedStamp status={HEALTH_STATUS_KEY[o.health]} label={HEALTH_LABEL[o.health]} />
              </Link>
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14 }}>
              Open tasks
            </div>
            {openTasks.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: c.textMuted, textAlign: "center" }}>No open tasks.</div>
            ) : (
              openTasks.slice(0, 5).map((t) => (
                <div key={t.id} style={{ padding: "8px 16px", borderBottom: `1px solid ${c.divider}`, fontSize: 11.5 }}>
                  <span style={{ color: c.paper }}>{t.title ?? "Task"}</span>
                  {t.organizationName && <span style={{ color: c.textMuted }}> · {t.organizationName}</span>}
                </div>
              ))
            )}
          </div>
          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14 }}>
              Recent activity
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: c.textMuted, textAlign: "center" }}>No activity yet.</div>
            ) : (
              displayActivity.slice(0, 6).map((a) => {
                const content = (
                  <>
                    <span style={{ color: c.paper }}>{a.title ?? a.kind}</span>
                    {a.organizationName && <span style={{ color: c.textMuted }}> · {a.organizationName}</span>}
                    <span style={{ color: c.textFaint }}> · {daysAgo(a.happens_at)}</span>
                  </>
                );
                return a.organizationId ? (
                  <Link key={a.id} href={`/admin/brokerage/crm/${a.organizationId}`} style={{ display: "block", padding: "8px 16px", borderBottom: `1px solid ${c.divider}`, fontSize: 11.5, textDecoration: "none" }}>{content}</Link>
                ) : (
                  <div key={a.id} style={{ padding: "8px 16px", borderBottom: `1px solid ${c.divider}`, fontSize: 11.5 }}>{content}</div>
                );
              })
            )}
          </div>
        </div>
      </div>

      </>}
      <div className={enabled ? "crm-company-intro" : undefined} style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 className={enabled ? "crm-company-heading" : undefined} style={{ color: c.paper, fontFamily: "var(--font-brokerage-display)", fontSize: 18, fontWeight: 650 }}>{enabled ? "Your companies" : "Relationship directory"}</h1>
          <div style={{ color: c.textMuted, fontSize: 11.5, marginTop: 3 }}>Banks, bankers, referral partners, borrowers, and every organization you work with.</div>
        </div>
        <button
          className={enabled ? "crm-company-add" : undefined}
          onClick={() => setShowForm((s) => !s)}
          style={{
            background: `linear-gradient(150deg, ${c.brassBright}, ${c.brass})`,
            color: c.brassOnBrass,
            border: "none",
            borderRadius: 6,
            padding: "9px 15px",
            fontWeight: 600,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          {showForm ? "Cancel" : enabled ? "+ Add company" : "+ Add organization"}
        </button>
      </div>

      {enabled ? <div className="crm-quick-views" role="group" aria-label="Quick relationship filters">
        <button aria-pressed={!healthFilter && typeFilter === "all" && ownerFilter === "all" && tagFilter === "all" && !search} onClick={() => { setHealthFilter(false); setTypeFilter("all"); setOwnerFilter("all"); setTagFilter("all"); setSearch(""); }}>All companies</button>
        <button aria-pressed={healthFilter} onClick={() => setHealthFilter((value) => !value)}>Needs a check-in</button>
        <button aria-pressed={typeFilter === "referral_source"} onClick={() => setTypeFilter((value) => value === "referral_source" ? "all" : "referral_source")}>Referral sources</button>
        <button aria-pressed={ownerFilter === "unassigned"} onClick={() => setOwnerFilter((value) => value === "unassigned" ? "all" : "unassigned")}>Unassigned</button>
      </div> : null}
      <div style={{ display: "grid", gridTemplateColumns: enabled ? "repeat(auto-fit, minmax(180px, 1fr))" : "minmax(200px, 1.4fr) repeat(auto-fit, minmax(150px, .5fr))", gap: 10, marginBottom: 12 }}>
        <input aria-label="Search relationships" style={inputStyle()} placeholder="Search organizations, cities, tags, or types…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by organization type" style={inputStyle()} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">All relationship types</option>{Object.entries(TYPE_LABELS).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>
        <select aria-label="Filter by relationship owner" style={inputStyle()} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">Any owner</option>
          <option value="unassigned">Unowned</option>
          {team.map((m) => <option key={m.clerkUserId} value={m.clerkUserId}>{ownerName[m.clerkUserId]}</option>)}
        </select>
        {allTags.length > 0 && (
          <select aria-label="Filter by tag" style={inputStyle()} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="all">Any tag</option>
            {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        )}
      </div>

      {showForm && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <input style={inputStyle()} placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label="Relationship type" style={inputStyle()} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="" disabled>Choose relationship type…</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input style={inputStyle()} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
            <input style={inputStyle()} placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <button
            onClick={createOrg}
            disabled={saving || !name.trim() || !type}
            style={{
              marginTop: 12,
              background: c.borderStrong,
              color: c.paper,
              border: `1px solid ${c.borderStronger}`,
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              opacity: saving || !name.trim() || !type ? 0.4 : 1,
            }}
          >
            {saving ? "Saving…" : "Save organization"}
          </button>
        </div>
      )}

      {/* Organizations table */}
      {enabled && !loading && !error ? <p className="crm-panel-hint" role="status">Showing {filteredOrgs.length} of {orgs.length} companies. Filters combine; choose All companies to reset.</p> : null}
      {enabled ? <CrmCompanyCards companies={filteredOrgs} owners={ownerName} loading={loading} error={error} onRetry={load} /> : <div>
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            columnGap: GRID_GAP,
            padding: "9px 16px",
            borderBottom: `1px solid ${c.borderStrong}`,
            background: c.inkHeader,
            fontFamily: "var(--font-brokerage-mono)",
            fontSize: 9.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.textFaint,
          }}
        >
          <div>Organization</div>
          <div>Type</div>
          <div>Owner</div>
          <div>Deals sourced</div>
          <div style={{ textAlign: "right" }}>Contacts</div>
          <div>Last touch</div>
          <div>Health</div>
        </div>

        {loading ? (
          <div style={{ padding: "54px 20px", textAlign: "center", color: c.textMuted, fontSize: 12 }}>Loading…</div>
        ) : filteredOrgs.length === 0 ? (
          <div style={{ padding: "54px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>◇</div>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontSize: 16, color: c.textSecondary, marginBottom: 4 }}>
              {enabled && error ? "Directory unavailable" : enabled && orgs.length > 0 ? "No companies match these filters" : "No organizations yet"}
            </div>
            <div style={{ fontSize: 12, color: c.textMuted }}>{enabled && error ? "Try reloading to retrieve your current records." : enabled && orgs.length > 0 ? "Choose All companies to clear your search and filters." : "Add a bank, referral partner, borrower business, or other organization to get started."}</div>
          </div>
        ) : (
          filteredOrgs.map((o) => (
            <Link
              key={o.id}
              href={`/admin/brokerage/crm/${o.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                columnGap: GRID_GAP,
                padding: "12px 16px",
                borderBottom: `1px solid ${c.divider}`,
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: c.paper, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {o.name}
                  {o.relationship_tier && (
                    <span style={{ color: c.brass, fontSize: 10, fontWeight: 500 }}> · {TIER_LABELS[o.relationship_tier] ?? o.relationship_tier}</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: c.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[o.city, o.state_code ?? o.state].filter(Boolean).join(", ") || "No location"}
                  {(o.tags ?? []).length > 0 && ` · ${(o.tags ?? []).join(", ")}`}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: c.textSecondary }}>{TYPE_LABELS[o.organization_type] ?? o.organization_type}</div>
              <div style={{ fontSize: 11, color: o.owner_clerk_user_id ? c.textSecondary : c.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {o.owner_clerk_user_id ? (ownerName[o.owner_clerk_user_id] ?? "Assigned") : "Unowned"}
              </div>
              <div style={{ fontSize: 11.5, color: c.textSecondary }}>
                {o.dealsReferredCount > 0 ? (
                  <>
                    {o.dealsReferredCount} · <span style={{ fontFamily: "var(--font-brokerage-mono)", color: c.brassBright }}>{fmtMoney(o.dealsReferredValue)}</span>
                  </>
                ) : (
                  "—"
                )}
              </div>
              <div style={{ textAlign: "right", fontFamily: "var(--font-brokerage-mono)", fontSize: 12.5, color: c.brassBright }}>
                {o.peopleCount}
              </div>
              <div style={{ fontSize: 11, color: c.textMuted, fontFamily: "var(--font-brokerage-mono)" }}>{daysAgo(o.lastActivityAt)}</div>
              <div>
                <RefinedStamp status={HEALTH_STATUS_KEY[o.health]} label={HEALTH_LABEL[o.health]} />
              </div>
            </Link>
          ))
        )}
      </div>
      </div>
      }
    </div>
  );
}
