"use client";

import { useEffect, useState } from "react";
import { crmColors as c } from "@/components/brokerage/tokens";
import { CrmModal, useCrmWorkspace } from "@/components/brokerage/CrmWorkspaceFrame";
import { useCrmDraftGuard } from "@/components/brokerage/useCrmDraftGuard";
import { CrmTabs } from "@/components/brokerage/CrmTabs";
import { STARTER_MESSAGE_TEMPLATES } from "@/lib/crm/starterMessageTemplates";

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

const TEMPLATE_GROUPS = {
  essentials: { label: "Start here", keys: ["initial_lead_response", "discovery_scheduling", "document_request", "engagement_follow_up"] },
  borrower: { label: "Borrower journey", keys: ["incomplete_application", "underwriting_condition_request", "closing_coordination", "funding_notification"] },
  lender: { label: "Lender placement", keys: ["lender_introduction", "lender_submission", "submission_follow_up"] },
  referrals: { label: "Referral relationships", keys: ["referral_acknowledgment", "referral_thank_you"] },
} as const;

type Template = { id: string; trigger_key: string; channel: "email" | "sms"; subject: string | null; body: string; active: boolean; version: number };

function inputStyle() {
  return { background: c.ink, border: `1px solid ${c.border}`, borderRadius: 5, padding: "7px 9px", color: c.paper, fontSize: 11.5, width: "100%" };
}

export default function CrmTemplatesPage() {
  const workspace = useCrmWorkspace();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<"all" | keyof typeof TEMPLATE_GROUPS>("essentials");
  const [readiness, setReadiness] = useState<"all" | "ready" | "missing">("all");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ triggerKey: string; channel: "email" | "sms" } | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const configured = templates.filter((template) => template.active).length;
  const possible = TRIGGER_KEYS.length * 2;
  const visibleKeys = TRIGGER_KEYS.filter((key) => {
    const definition = STARTER_MESSAGE_TEMPLATES.find((item) => item.key === key);
    const searchable = [key.replaceAll("_", " "), definition?.label, definition?.explanation].filter(Boolean).join(" ").toLowerCase();
    const inGroup = group === "all" || (TEMPLATE_GROUPS[group].keys as readonly string[]).includes(key);
    const channelCount = templates.filter((template) => template.trigger_key === key && template.active).length;
    const inReadiness = readiness === "all" || (readiness === "ready" ? channelCount === 2 : channelCount < 2);
    return inGroup && inReadiness && searchable.includes(search.trim().toLowerCase());
  });

  useCrmDraftGuard(Boolean(editing));
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

  async function createStarterLibrary() {
    if (!window.confirm("Create Buddy's editable starter messages for every empty email and SMS slot? Existing messages will not be changed, and nothing will be sent.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/comms/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_starter_library" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "starter library failed");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "starter library failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <CrmTabs />
      {workspace && <header className="crm-page-intro"><div><p className="crm-eyebrow">A PERSONAL TOUCH, EVERY TIME</p><h1>Message library</h1><p>Reusable starting points for the conversations that move lending forward. Saving a template does not send a message.</p></div></header>}
      <section className="crm-template-readiness" aria-label="Message readiness">
        <div><strong>{configured} of {possible} ready</strong><span>Email and text messages are separate. Review them any time before using them.</span></div>
        <progress max={possible} value={configured}>{configured} of {possible}</progress>
        {configured < possible ? <button className="crm-button" disabled={saving} onClick={() => void createStarterLibrary()}>{saving ? "Creating…" : "Create editable starter library"}</button> : <span className="crm-ready-mark">✓ Message library ready</span>}
      </section>
      <label className="crm-template-search">Find a message<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by purpose, such as documents or referral" /></label>

      <div className="crm-template-controls">
        <div role="group" aria-label="Message category">
          <button aria-pressed={group === "all"} onClick={() => setGroup("all")}>All</button>
          {Object.entries(TEMPLATE_GROUPS).map(([key, value]) => <button key={key} aria-pressed={group === key} onClick={() => setGroup(key as keyof typeof TEMPLATE_GROUPS)}>{value.label}</button>)}
        </div>
        <label>Readiness<select value={readiness} onChange={(event) => setReadiness(event.target.value as typeof readiness)}><option value="all">All messages</option><option value="missing">Needs review</option><option value="ready">Email & SMS ready</option></select></label>
      </div>

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
          {visibleKeys.map((key) => {
            const definition = STARTER_MESSAGE_TEMPLATES.find((item) => item.key === key);
            const emailTemplate = templates.find((t) => t.trigger_key === key && t.channel === "email");
            const smsTemplate = templates.find((t) => t.trigger_key === key && t.channel === "sms");
            return (
              <div className="crm-template-card" key={key} style={{ padding: "12px 16px", borderBottom: `1px solid ${c.divider}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="crm-template-purpose"><strong>{definition?.label ?? key.replace(/_/g, " ")}</strong><span>{definition?.explanation}</span><small>{Number(Boolean(emailTemplate?.active)) + Number(Boolean(smsTemplate?.active))} of 2 channels ready</small></div>
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
          {!visibleKeys.length ? <div className="crm-template-empty"><strong>No messages match this view.</strong><span>Try another category, readiness filter, or search phrase.</span></div> : null}
        </div>
      )}

      {editing && (
        <CrmModal title="Edit message template" className="crm-template-dialog" onClose={() => setEditing(null)}>
          <div data-crm-dirty="true" style={{ background: c.card, padding: 20 }}>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
              {editing.triggerKey.replace(/_/g, " ")} — {editing.channel}
            </div>
            {editing.channel === "email" && (
              <input style={{ ...inputStyle(), marginBottom: 8 }} aria-label="Message subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            )}
            <textarea style={{ ...inputStyle(), minHeight: 140 }} aria-label="Message body" placeholder="Body — use {{first_name}} etc. for merge fields" value={body} onChange={(e) => setBody(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button onClick={() => { if (window.confirm("Discard this template draft?")) setEditing(null); }} disabled={saving} style={{ background: "transparent", border: `1px solid ${c.border}`, color: c.textSecondary, borderRadius: 5, padding: "7px 12px", fontSize: 11.5, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={save} disabled={saving || !body.trim()} style={{ background: "rgba(184,144,91,.15)", border: `1px solid rgba(184,144,91,.4)`, color: c.brassBright, borderRadius: 5, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: saving || !body.trim() ? 0.5 : 1 }}>
                Save
              </button>
            </div>
          </div>
        </CrmModal>
      )}
    </div>
  );
}
