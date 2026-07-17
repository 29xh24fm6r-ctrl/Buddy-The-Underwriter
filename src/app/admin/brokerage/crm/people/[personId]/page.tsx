"use client";

import { useEffect, useState, use as usePromise } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";

type Person = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  contact_status: "active" | "inactive" | "do_not_contact";
  notes: string | null;
};

type OrgRole = {
  id: string;
  organization_id: string;
  role: string;
  job_title: string | null;
  is_primary_contact: boolean;
  is_decision_maker: boolean;
  is_active: boolean;
};

type DealRole = {
  id: string;
  deal_id: string;
  role: string;
  organizationName: string | null;
};

type Activity = {
  id: string;
  kind: string;
  happens_at: string;
  title: string | null;
};

function inputStyle(): CSSProperties {
  return {
    background: c.ink,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: "8px 10px",
    color: c.paper,
    fontSize: 12,
    width: "100%",
  };
}

export default function CrmPersonDetailPage({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = usePromise(params);

  const [person, setPerson] = useState<Person | null>(null);
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});
  const [dealRoles, setDealRoles] = useState<DealRole[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showLink, setShowLink] = useState(false);
  const [linkOrgId, setLinkOrgId] = useState("");
  const [linkRole, setLinkRole] = useState("contact");
  const [linking, setLinking] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/people/${personId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setPerson(json.person);
      setOrgRoles(json.organizationRoles ?? []);
      setDealRoles(json.dealRoles ?? []);
      setActivities(json.activities ?? []);
      setError(null);

      const ids: string[] = Array.from(new Set((json.organizationRoles ?? []).map((r: OrgRole) => r.organization_id)));
      if (ids.length > 0) {
        const results = await Promise.all(
          ids.map((id) => fetch(`/api/admin/brokerage/crm/organizations/${id}`).then((r) => r.json()).catch(() => null)),
        );
        const map: Record<string, string> = {};
        results.forEach((r, i) => {
          if (r?.ok) map[ids[i]] = r.organization.name;
        });
        setOrgNames(map);
      }
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  async function linkToOrg() {
    if (!linkOrgId.trim()) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/people/${personId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: linkOrgId.trim(), role: linkRole }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "link failed");
      setLinkOrgId("");
      setShowLink(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "link failed");
    } finally {
      setLinking(false);
    }
  }

  async function unlink(roleId: string) {
    try {
      const res = await fetch(`/api/admin/brokerage/crm/people/${personId}?roleId=${roleId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "unlink failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "unlink failed");
    }
  }

  if (loading) return <div style={{ padding: "18px 24px", color: c.textMuted, fontSize: 12 }}>Loading…</div>;
  if (error || !person) {
    return (
      <div style={{ padding: "18px 24px" }}>
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6 }}>
          {error ?? "Person not found"}
        </div>
      </div>
    );
  }

  const name = person.preferred_name || [person.first_name, person.last_name].filter(Boolean).join(" ") || "(unnamed)";
  const activeRoles = orgRoles.filter((r) => r.is_active);

  return (
    <div style={{ padding: "18px 24px 40px", maxWidth: 1000 }}>
      <Link href="/admin/brokerage/crm/people" style={{ fontSize: 11.5, color: c.textMuted, marginBottom: 14, display: "inline-block" }}>
        ← All people
      </Link>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 700, fontSize: 26, color: c.paper, lineHeight: 1.1 }}>{name}</div>
        <div style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>
          {person.job_title ?? "—"} · {person.email ?? "—"} · {person.phone ?? person.mobile_phone ?? "—"}
          {person.contact_status !== "active" && (
            <>
              {" · "}
              <span style={{ color: c.brick }}>{person.contact_status.replace("_", " ")}</span>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>Organizations</span>
            <button
              onClick={() => setShowLink((s) => !s)}
              style={{ background: "transparent", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "5px 10px", fontSize: 11, cursor: "pointer" }}
            >
              {showLink ? "Cancel" : "+ Link org"}
            </button>
          </div>

          {showLink && (
            <div style={{ padding: 14, borderBottom: `1px solid ${c.border}` }}>
              <input
                style={inputStyle()}
                placeholder="Organization ID (copy from its detail page URL)"
                value={linkOrgId}
                onChange={(e) => setLinkOrgId(e.target.value)}
              />
              <select
                value={linkRole}
                onChange={(e) => setLinkRole(e.target.value)}
                style={{ ...inputStyle(), marginTop: 8 }}
              >
                {["contact", "decision_maker", "billing_contact", "referral_contact", "primary_contact", "other"].map((r) => (
                  <option key={r} value={r}>{r.replace("_", " ")}</option>
                ))}
              </select>
              <button
                onClick={linkToOrg}
                disabled={linking}
                style={{ marginTop: 8, background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: linking ? 0.4 : 1 }}
              >
                {linking ? "Linking…" : "Link"}
              </button>
            </div>
          )}

          {activeRoles.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Not linked to any organization yet — this is the whole point of PR1: one person, many orgs.</div>
          ) : (
            activeRoles.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${c.divider}` }}>
                <div>
                  <Link href={`/admin/brokerage/crm/${r.organization_id}`} style={{ fontSize: 12.5, color: c.paper, textDecoration: "none" }}>
                    {orgNames[r.organization_id] ?? r.organization_id}
                  </Link>
                  <div style={{ fontSize: 10.5, color: c.textMuted, marginTop: 2 }}>
                    {r.role.replace("_", " ")}{r.is_primary_contact ? " · primary" : ""}{r.is_decision_maker ? " · decision-maker" : ""}
                  </div>
                </div>
                <button
                  onClick={() => unlink(r.id)}
                  style={{ background: "transparent", border: "none", color: c.textMuted, fontSize: 11, cursor: "pointer" }}
                >
                  Unlink
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>
              Deal roles
            </div>
            {dealRoles.length === 0 ? (
              <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Not attached to any deal yet.</div>
            ) : (
              dealRoles.map((r) => (
                <div key={r.id} style={{ padding: "11px 16px", borderBottom: `1px solid ${c.divider}`, fontSize: 12, color: c.paper }}>
                  {r.role.replace("_", " ")} on deal {r.deal_id.slice(0, 8)}…
                </div>
              ))
            )}
          </div>

          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>
              Activity
            </div>
            {activities.length === 0 ? (
              <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>No activity logged yet.</div>
            ) : (
              activities.slice(0, 15).map((a) => (
                <div key={a.id} style={{ padding: "11px 16px", borderBottom: `1px solid ${c.divider}` }}>
                  <div style={{ fontSize: 12, color: c.paper }}>{a.title ?? a.kind}</div>
                  <div style={{ fontSize: 10.5, color: c.textMuted, marginTop: 2 }}>{new Date(a.happens_at).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
