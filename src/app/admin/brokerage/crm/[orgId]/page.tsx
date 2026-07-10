"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";

type Activity = {
  id: string;
  kind: string;
  happens_at: string;
  title: string | null;
  properties: Record<string, unknown>;
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

export default function CrmOrganizationDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = usePromise(params);

  const [org, setOrg] = useState<any>(null);
  const [people, setPeople] = useState<any[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/organizations/${orgId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setOrg(json.organization);
      setPeople(json.people ?? []);
      setActivities(json.activities ?? []);
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

  async function logNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          organizationId: orgId,
          title: noteText.slice(0, 80),
          properties: { body: noteText },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save failed");
      setNoteText("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "save failed");
    } finally {
      setSaving(false);
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
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
        {/* Timeline */}
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 15 }}>
            Activity timeline
          </div>
          <div style={{ padding: "14px 16px" }}>
            <div style={{ marginBottom: 16 }}>
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
                placeholder="Log a note…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <button
                onClick={logNote}
                disabled={saving || !noteText.trim()}
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
                  opacity: saving || !noteText.trim() ? 0.4 : 1,
                }}
              >
                {saving ? "Saving…" : "+ Log activity"}
              </button>
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

        {/* Contacts */}
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
        </div>
      </div>
    </div>
  );
}
