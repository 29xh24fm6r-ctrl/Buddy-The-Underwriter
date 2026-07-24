"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { brokerageColors as c, fmtMoney } from "@/components/brokerage/tokens";
import { RefinedStamp } from "@/components/brokerage/StatusStamp";
import { CrmTabs } from "@/components/brokerage/CrmTabs";

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
};

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

const GRID = "1.5fr 1fr 1fr 100px 130px 120px";

const TYPE_LABELS: Record<string, string> = {
  referral_source: "Referral source",
  professional_partner: "Professional partner",
  borrower_business: "Borrower business",
  cpa_firm: "CPA firm",
  law_firm: "Law firm",
  lender: "Lender",
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
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [needsAttention, setNeedsAttention] = useState<Organization[]>([]);
  const [recentActivity, setRecentActivity] = useState<FeedItem[]>([]);
  const [openTasks, setOpenTasks] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState("referral_source");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);

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
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createOrg() {
    if (!name.trim()) return;
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

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <Tile label="Organizations" value={summary ? String(summary.organizationCount) : "—"} accent={c.brass} />
        <Tile label="Contacts" value={summary ? String(summary.contactCount) : "—"} accent={c.brass} />
        <Tile label="Deals sourced" value={summary ? String(summary.dealsReferredCount) : "—"} accent={c.sage} />
        <Tile label="Value sourced" value={summary ? fmtMoney(summary.valueSourced) : "—"} accent={c.sage} />
        <Tile label="Needs attention" value={summary ? String(summary.needsAttentionCount) : "—"} accent={summary && summary.needsAttentionCount > 0 ? c.brick : c.textFaint} />
      </div>

      {/* Needs attention + feeds */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, marginBottom: 20 }}>
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
              recentActivity.slice(0, 6).map((a) => (
                <div key={a.id} style={{ padding: "8px 16px", borderBottom: `1px solid ${c.divider}`, fontSize: 11.5 }}>
                  <span style={{ color: c.paper }}>{a.title ?? a.kind}</span>
                  {a.organizationName && <span style={{ color: c.textMuted }}> · {a.organizationName}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <button
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
          {showForm ? "Cancel" : "+ Add organization"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1fr 1fr", gap: 10 }}>
            <input style={inputStyle()} placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} />
            <select style={inputStyle()} value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <input style={inputStyle()} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
            <input style={inputStyle()} placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <button
            onClick={createOrg}
            disabled={saving || !name.trim()}
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
              opacity: saving || !name.trim() ? 0.4 : 1,
            }}
          >
            {saving ? "Saving…" : "Save organization"}
          </button>
        </div>
      )}

      {/* Organizations table */}
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
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
          <div>Deals sourced</div>
          <div style={{ textAlign: "right" }}>Contacts</div>
          <div>Last touch</div>
          <div>Health</div>
        </div>

        {loading ? (
          <div style={{ padding: "54px 20px", textAlign: "center", color: c.textMuted, fontSize: 12 }}>Loading…</div>
        ) : orgs.length === 0 ? (
          <div style={{ padding: "54px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 30, opacity: 0.35, marginBottom: 8 }}>◇</div>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontSize: 16, color: "#C9C3B6", marginBottom: 4 }}>
              No referral sources yet
            </div>
            <div style={{ fontSize: 12, color: c.textMuted }}>Add the CPAs, attorneys, and brokers who send you deals.</div>
          </div>
        ) : (
          orgs.map((o) => (
            <Link
              key={o.id}
              href={`/admin/brokerage/crm/${o.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                padding: "12px 16px",
                borderBottom: `1px solid ${c.divider}`,
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: c.paper }}>{o.name}</div>
              <div style={{ fontSize: 11.5, color: c.textSecondary }}>{TYPE_LABELS[o.organization_type] ?? o.organization_type}</div>
              <div style={{ fontSize: 11.5, color: "#C9C3B6" }}>
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
  );
}
