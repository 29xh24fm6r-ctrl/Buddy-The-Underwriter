"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { brokerageColors as c, fmtMoney } from "@/components/brokerage/tokens";

type Activity = {
  id: string;
  kind: string;
  happens_at: string;
  title: string | null;
  properties: Record<string, unknown>;
};

type ReferredDeal = {
  id: string;
  display_name: string | null;
  borrower_name: string | null;
  name: string | null;
  loan_amount: number | null;
  created_at: string;
};

type SearchDeal = {
  id: string;
  display_name: string | null;
  borrower_name: string | null;
  name: string | null;
  loan_amount: number | null;
};

const KIND_ICON: Record<string, string> = {
  note: "✎",
  task: "☐",
  call: "☎",
  email: "✉",
  meeting: "◔",
  stage_change: "→",
  system: "◍",
};

const KIND_LABELS: Record<string, string> = {
  note: "Note",
  task: "Task",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  stage_change: "Stage change",
  system: "System",
};

function dealLabel(d: { display_name: string | null; borrower_name: string | null; name: string | null }): string {
  return d.display_name || d.borrower_name || d.name || "Untitled deal";
}

export default function CrmOrganizationDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = usePromise(params);

  const [org, setOrg] = useState<any>(null);
  const [people, setPeople] = useState<any[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [referredDeals, setReferredDeals] = useState<ReferredDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entryKind, setEntryKind] = useState<"note" | "task" | "call" | "email" | "meeting">("note");
  const [entryText, setEntryText] = useState("");
  const [entryDueAt, setEntryDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  const [showAttribute, setShowAttribute] = useState(false);
  const [dealQuery, setDealQuery] = useState("");
  const [dealResults, setDealResults] = useState<SearchDeal[]>([]);
  const [searching, setSearching] = useState(false);
  const [attributing, setAttributing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/organizations/${orgId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setOrg(json.organization);
      setPeople(json.people ?? []);
      setActivities(json.activities ?? []);
      setReferredDeals(json.referredDeals ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function logEntry() {
    if (!entryText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: entryKind,
          organizationId: orgId,
          title: entryText.slice(0, 80),
          properties: { body: entryText },
          dueAt: entryKind === "task" && entryDueAt ? entryDueAt : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save failed");
      setEntryText("");
      setEntryDueAt("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function searchDeals(q: string) {
    setDealQuery(q);
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/deals-search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (res.ok && json.ok) setDealResults(json.deals ?? []);
    } finally {
      setSearching(false);
    }
  }

  async function attributeDeal(dealId: string) {
    setAttributing(dealId);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/organizations/${orgId}/attribute-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "attribute failed");
      setShowAttribute(false);
      setDealQuery("");
      setDealResults([]);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "attribute failed");
    } finally {
      setAttributing(null);
    }
  }

  if (loading) {
    return <div style={{ padding: "18px 24px", color: c.textMuted, fontSize: 12 }}>Loading…</div>;
  }
  if (error || !org) {
    return (
      <div style={{ padding: "18px 24px" }}>
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6 }}>
          {error ?? "Organization not found"}
        </div>
      </div>
    );
  }

  const totalSourced = referredDeals.reduce((s, d) => s + Number(d.loan_amount ?? 0), 0);

  return (
    <div style={{ padding: "18px 24px 40px", maxWidth: 1120 }}>
      <Link href="/admin/brokerage/crm" style={{ fontSize: 11.5, color: c.textMuted, marginBottom: 14, display: "inline-block" }}>
        ← All organizations
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 22 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 700, fontSize: 26, color: c.paper, lineHeight: 1.1 }}>
            {org.name}
          </div>
          <div style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>
            {org.organization_type}
            {(org.city || org.state) && ` · ${[org.city, org.state].filter(Boolean).join(", ")}`}
            {" · "}
            <span style={{ fontFamily: "var(--font-brokerage-mono)", color: c.brassBright }}>{people.length}</span> contacts
            {referredDeals.length > 0 && (
              <>
                {" · "}
                <span style={{ fontFamily: "var(--font-brokerage-mono)", color: c.sage }}>
                  {referredDeals.length} deal{referredDeals.length === 1 ? "" : "s"} · {fmtMoney(totalSourced)} sourced
                </span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowAttribute((s) => !s)}
          style={{ background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "9px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          {showAttribute ? "Cancel" : "+ Attribute deal"}
        </button>
      </div>

      {showAttribute && (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: c.textFaint, marginBottom: 10 }}>
            Attribute a deal to this organization
          </div>
          <input
            style={{ background: c.ink, border: `1px solid ${c.border}`, borderRadius: 5, padding: "8px 10px", color: c.paper, fontSize: 12, width: "100%" }}
            placeholder="Search unattributed deals by name…"
            value={dealQuery}
            onChange={(e) => searchDeals(e.target.value)}
          />
          <div style={{ marginTop: 10 }}>
            {searching ? (
              <div style={{ fontSize: 12, color: c.textMuted }}>Searching…</div>
            ) : dealResults.length === 0 ? (
              <div style={{ fontSize: 12, color: c.textMuted }}>
                {dealQuery ? "No matching unattributed deals." : "Type to search deals not yet linked to a referral source."}
              </div>
            ) : (
              dealResults.map((d) => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${c.divider}` }}>
                  <div style={{ fontSize: 12, color: c.paper }}>
                    {dealLabel(d)}
                    {d.loan_amount != null && <span style={{ color: c.textMuted }}> · {fmtMoney(Number(d.loan_amount))}</span>}
                  </div>
                  <button
                    onClick={() => attributeDeal(d.id)}
                    disabled={attributing === d.id}
                    style={{ background: c.borderStrong, border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 5, padding: "4px 10px", fontSize: 11, cursor: "pointer", opacity: attributing === d.id ? 0.4 : 1 }}
                  >
                    {attributing === d.id ? "Linking…" : "Link"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
        {/* Timeline */}
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>
            Activity timeline
          </div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {(["note", "task", "call", "email", "meeting"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setEntryKind(k)}
                    style={{
                      fontSize: 11,
                      padding: "5px 10px",
                      borderRadius: 5,
                      border: `1px solid ${entryKind === k ? "rgba(184,144,91,.5)" : c.border}`,
                      background: entryKind === k ? "rgba(184,144,91,.12)" : "transparent",
                      color: entryKind === k ? c.brassBright : c.textSecondary,
                      cursor: "pointer",
                    }}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>
              <textarea
                style={{
                  width: "100%",
                  background: c.ink,
                  border: `1px solid ${c.border}`,
                  borderRadius: 5,
                  padding: "8px 10px",
                  color: c.paper,
                  fontSize: 12,
                  fontFamily: "var(--font-brokerage-sans)",
                  resize: "vertical",
                }}
                rows={2}
                placeholder={entryKind === "task" ? "What needs to happen…" : `Log a ${entryKind}…`}
                value={entryText}
                onChange={(e) => setEntryText(e.target.value)}
              />
              {entryKind === "task" && (
                <input
                  type="date"
                  value={entryDueAt}
                  onChange={(e) => setEntryDueAt(e.target.value)}
                  style={{ marginTop: 8, background: c.ink, border: `1px solid ${c.border}`, borderRadius: 5, padding: "6px 10px", color: c.paper, fontSize: 12 }}
                />
              )}
              <div>
                <button
                  onClick={logEntry}
                  disabled={saving || !entryText.trim()}
                  style={{
                    marginTop: 8,
                    background: "#1B1E23",
                    border: `1px solid ${c.borderStronger}`,
                    color: c.paper,
                    borderRadius: 6,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: saving || !entryText.trim() ? 0.4 : 1,
                  }}
                >
                  {saving ? "Saving…" : `+ Log ${entryKind}`}
                </button>
              </div>
            </div>

            {activities.length === 0 ? (
              <div style={{ fontSize: 12, color: c.textMuted, padding: "20px 0", textAlign: "center" }}>No activity yet.</div>
            ) : (
              activities.map((a, i) => (
                <div key={a.id} style={{ display: "flex", gap: 13 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none" }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "rgba(184,144,91,.12)",
                        border: `1px solid rgba(184,144,91,.4)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        color: c.brassBright,
                      }}
                    >
                      {KIND_ICON[a.kind] ?? "•"}
                    </div>
                    {i < activities.length - 1 && <div style={{ width: 2, flex: 1, background: c.border, minHeight: 14 }} />}
                  </div>
                  <div style={{ flex: 1, paddingBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: c.paper }}>{KIND_LABELS[a.kind] ?? a.kind}</span>
                      <span style={{ fontSize: 10.5, color: c.textMuted, fontFamily: "var(--font-brokerage-mono)", whiteSpace: "nowrap" }}>
                        {new Date(a.happens_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    {a.title && <div style={{ fontSize: 12, color: c.textSecondary, marginTop: 3, lineHeight: 1.45 }}>{a.title}</div>}
                    {typeof a.properties?.body === "string" && a.properties.body !== a.title && (
                      <div style={{ fontSize: 12, color: c.textSecondary, marginTop: 3, lineHeight: 1.45 }}>{a.properties.body as string}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Contacts + referred deals */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>
              Contacts
            </div>
            {people.length === 0 ? (
              <div style={{ padding: "20px 16px", fontSize: 12, color: c.textMuted, textAlign: "center" }}>No contacts yet.</div>
            ) : (
              people.map((p) => {
                const displayName = [p.first_name, p.last_name].filter(Boolean).join(" ") || "(unnamed)";
                const initials = displayName
                  .split(" ")
                  .map((s: string) => s[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderBottom: `1px solid ${c.divider}` }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        flex: "none",
                        borderRadius: "50%",
                        background: c.borderStrong,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "var(--font-brokerage-display)",
                        fontWeight: 600,
                        fontSize: 12,
                        color: c.brassBright,
                      }}
                    >
                      {initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: c.paper }}>{displayName}</div>
                      <div style={{ fontSize: 10.5, color: c.textMuted }}>
                        {p.job_title ?? "—"} · {p.email ?? "—"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>
              Deals referred
            </div>
            {referredDeals.length === 0 ? (
              <div style={{ padding: "20px 16px", fontSize: 12, color: c.textMuted, textAlign: "center" }}>
                No deals attributed yet.
              </div>
            ) : (
              referredDeals.map((d) => (
                <Link
                  key={d.id}
                  href={`/deals/${d.id}/cockpit`}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${c.divider}`, textDecoration: "none" }}
                >
                  <span style={{ fontSize: 12, color: c.paper }}>{dealLabel(d)}</span>
                  <span style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 11.5, color: c.brassBright }}>
                    {d.loan_amount != null ? fmtMoney(Number(d.loan_amount)) : "—"}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
