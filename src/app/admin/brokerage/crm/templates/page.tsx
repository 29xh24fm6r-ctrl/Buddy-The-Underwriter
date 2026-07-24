"use client";

import { useEffect, useState } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { CrmTabs } from "@/components/brokerage/CrmTabs";

const TRIGGER_KEYS = [
  "initial_lead_response",
  "discovery_scheduling",
  "document_request",
  "engagement_follow_up",
  "incomplete_application",
  "lender_introduction",
  "lender_submission",
  "submission_follow_up",
  "underwriting_condition_request",
  "closing_coordination",
  "referral_acknowledgment",
  "funding_notification",
  "referral_thank_you",
];

type Template = { id: string; trigger_key: string; channel: "email" | "sms"; subject: string | null; body: string; active: boolean; version: number };

function inputStyle() {
  return { background: c.ink, border: `1px solid ${c.border}`, borderRadius: 5, padding: "7px 9px", color: c.paper, fontSize: 11.5, width: "100%" };
}

export default function CrmTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ triggerKey: string; channel: "email" | "sms" } | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/comms/templates");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setTemplates(json.templates ?? []);
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

  function startEdit(triggerKey: string, channel: "email" | "sms") {
    const existing = templates.find((t) => t.trigger_key === triggerKey && t.channel === channel);
    setSubject(existing?.subject ?? "");
    setBody(existing?.body ?? "");
    setEditing({ triggerKey, channel });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/comms/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerKey: editing.triggerKey, channel: editing.channel, subject: editing.channel === "email" ? subject : undefined, body }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save failed");
      setEditing(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />

      <div style={{ fontSize: 12.5, color: c.textSecondary, marginBottom: 16 }}>
        Message templates support <code>{"{{merge_field}}"}</code> substitution. Each trigger has an independent email and SMS version.
      </div>

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>Loading…</div>
      ) : (
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
          {TRIGGER_KEYS.map((key) => {
            const emailTemplate = templates.find((t) => t.trigger_key === key && t.channel === "email");
            const smsTemplate = templates.find((t) => t.trigger_key === key && t.channel === "sms");
            return (
              <div key={key} style={{ padding: "12px 16px", borderBottom: `1px solid ${c.divider}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12.5, color: c.paper }}>{key.replace(/_/g, " ")}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEdit(key, "email")} style={{ fontSize: 10.5, padding: "4px 9px", borderRadius: 4, border: `1px solid ${c.border}`, background: emailTemplate ? "rgba(184,144,91,.12)" : "transparent", color: emailTemplate ? c.brassBright : c.textMuted, cursor: "pointer" }}>
                    {emailTemplate ? "Edit email" : "+ Email"}
                  </button>
                  <button onClick={() => startEdit(key, "sms")} style={{ fontSize: 10.5, padding: "4px 9px", borderRadius: 4, border: `1px solid ${c.border}`, background: smsTemplate ? "rgba(184,144,91,.12)" : "transparent", color: smsTemplate ? c.brassBright : c.textMuted, cursor: "pointer" }}>
                    {smsTemplate ? "Edit SMS" : "+ SMS"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 20, width: 480 }}>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
              {editing.triggerKey.replace(/_/g, " ")} — {editing.channel}
            </div>
            {editing.channel === "email" && (
              <input style={{ ...inputStyle(), marginBottom: 8 }} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            )}
            <textarea style={{ ...inputStyle(), minHeight: 140 }} placeholder="Body — use {{first_name}} etc. for merge fields" value={body} onChange={(e) => setBody(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setEditing(null)} style={{ background: "transparent", border: `1px solid ${c.border}`, color: c.textSecondary, borderRadius: 5, padding: "7px 12px", fontSize: 11.5, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={save} disabled={saving || !body.trim()} style={{ background: "rgba(184,144,91,.15)", border: `1px solid rgba(184,144,91,.4)`, color: c.brassBright, borderRadius: 5, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: saving || !body.trim() ? 0.5 : 1 }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
