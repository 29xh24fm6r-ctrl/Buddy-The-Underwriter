"use client";

import { useEffect, useState } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";

type TargetType = "lead" | "deal" | "organization" | "person";

type Template = { trigger_key: string; channel: "email" | "sms"; subject: string | null; body: string };

const CHANNELS = ["email", "sms", "call", "meeting"] as const;

function inputStyle() {
  return { background: c.ink, border: `1px solid ${c.border}`, borderRadius: 5, padding: "7px 9px", color: c.paper, fontSize: 11.5, width: "100%" };
}

/**
 * Shared communications panel — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR4.
 *
 * One component mounted on lead/person/organization detail pages and in
 * the deal cockpit, rather than four bespoke send forms. Sends go through
 * the real email/SMS senders (honest stub fallback if unconfigured); call
 * and meeting are manual-log-only (no telephony provider exists).
 */
export function CommsPanel({ targetType, targetId, onSent }: { targetType: TargetType; targetId: string; onSent?: () => void }) {
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [outcome, setOutcome] = useState("");
  const [commitmentsText, setCommitmentsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/brokerage/crm/comms/templates")
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setTemplates(json.templates ?? []);
      })
      .catch(() => {});
  }, []);

  const relevantTemplates = templates.filter((t) => t.channel === channel);

  function applyTemplate(key: string) {
    setTemplateKey(key);
    const t = relevantTemplates.find((tpl) => tpl.trigger_key === key);
    if (t) {
      setSubject(t.subject ?? "");
      setBody(t.body);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const targetField = `${targetType}Id`;
      const payload: Record<string, unknown> = { channel, [targetField]: targetId };
      if (channel === "email" || channel === "sms") {
        payload.to = to;
        if (templateKey) payload.templateTriggerKey = templateKey;
        else {
          if (channel === "email") payload.subject = subject;
          payload.body = body;
        }
      } else if (channel === "call") {
        payload.direction = direction;
        payload.outcome = outcome;
      } else if (channel === "meeting") {
        payload.title = subject || "Meeting";
        payload.outcome = outcome || undefined;
        const commitmentsMade = commitmentsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (commitmentsMade.length > 0) payload.commitmentsMade = commitmentsMade;
      }

      const res = await fetch("/api/admin/brokerage/crm/comms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "send failed");
      setSuccess(channel === "email" || channel === "sms" ? `Sent (${json.provider ?? "provider"}${json.providerMessageId ? "" : ", stub — no provider configured"})` : "Logged");
      setTo("");
      setSubject("");
      setBody("");
      setOutcome("");
      setCommitmentsText("");
      setTemplateKey("");
      onSent?.();
    } catch (e: any) {
      setError(e?.message ?? "send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Send / log communication</div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {CHANNELS.map((ch) => (
          <button
            key={ch}
            onClick={() => { setChannel(ch); setTemplateKey(""); }}
            style={{
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 5,
              border: `1px solid ${channel === ch ? "rgba(184,144,91,.5)" : c.border}`,
              background: channel === ch ? "rgba(184,144,91,.12)" : "transparent",
              color: channel === ch ? c.brassBright : c.textSecondary,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {ch}
          </button>
        ))}
      </div>

      {error && <div style={{ fontSize: 11, color: c.brick, marginBottom: 8 }}>{error}</div>}
      {success && <div style={{ fontSize: 11, color: c.brassBright, marginBottom: 8 }}>{success}</div>}

      {(channel === "email" || channel === "sms") && (
        <>
          <input style={{ ...inputStyle(), marginBottom: 6 }} placeholder={channel === "email" ? "Recipient email" : "Recipient phone (E.164)"} value={to} onChange={(e) => setTo(e.target.value)} />
          {relevantTemplates.length > 0 && (
            <select style={{ ...inputStyle(), marginBottom: 6 }} value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">No template — write manually</option>
              {relevantTemplates.map((t) => (
                <option key={t.trigger_key} value={t.trigger_key}>{t.trigger_key.replace(/_/g, " ")}</option>
              ))}
            </select>
          )}
          {channel === "email" && !templateKey && <input style={{ ...inputStyle(), marginBottom: 6 }} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
          {!templateKey && <textarea style={{ ...inputStyle(), minHeight: 70, marginBottom: 6 }} placeholder="Message body" value={body} onChange={(e) => setBody(e.target.value)} />}
        </>
      )}

      {channel === "call" && (
        <>
          <select style={{ ...inputStyle(), marginBottom: 6 }} value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
          <input style={{ ...inputStyle(), marginBottom: 6 }} placeholder="Outcome (e.g. left voicemail, connected)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </>
      )}

      {channel === "meeting" && (
        <>
          <input style={{ ...inputStyle(), marginBottom: 6 }} placeholder="Meeting title" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <input style={{ ...inputStyle(), marginBottom: 6 }} placeholder="Outcome (optional)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <textarea
            style={{ ...inputStyle(), marginBottom: 6, minHeight: 56, resize: "vertical" as const, fontFamily: "inherit" }}
            placeholder="Commitments made (one per line — each becomes a task on this deal)"
            value={commitmentsText}
            onChange={(e) => setCommitmentsText(e.target.value)}
          />
        </>
      )}

      <button
        onClick={send}
        disabled={busy}
        style={{ background: "rgba(184,144,91,.15)", border: `1px solid rgba(184,144,91,.4)`, borderRadius: 5, color: c.brassBright, fontSize: 11.5, fontWeight: 600, padding: "7px 12px", cursor: "pointer", opacity: busy ? 0.5 : 1 }}
      >
        {channel === "email" || channel === "sms" ? "Send" : "Log"}
      </button>
    </div>
  );
}
