"use client";

import { useEffect, useState, use as usePromise } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";
import { CommsPanel } from "@/components/brokerage/CommsPanel";

type Lead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  loan_amount_requested: number | null;
  loan_purpose: string | null;
  loan_program: string | null;
  status: string;
  priority: string;
  owner_clerk_user_id: string | null;
  source: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  disqualification_reason: string | null;
  lost_reason: string | null;
  converted_deal_id: string | null;
};

type Qualification = Record<string, unknown> | null;

type Activity = {
  id: string;
  kind: string;
  title: string | null;
  happens_at: string;
  properties: Record<string, unknown>;
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  new: ["attempting_contact", "disqualified", "withdrawn"],
  attempting_contact: ["contacted", "unresponsive", "disqualified", "withdrawn"],
  contacted: ["discovery_scheduled", "information_requested", "nurture", "unresponsive", "disqualified", "withdrawn"],
  discovery_scheduled: ["discovery_complete", "contacted", "disqualified", "withdrawn"],
  discovery_complete: ["information_requested", "preliminary_qualification", "disqualified", "withdrawn"],
  information_requested: ["preliminary_qualification", "nurture", "disqualified", "withdrawn"],
  preliminary_qualification: ["qualified", "nurture", "disqualified", "withdrawn"],
  qualified: ["engagement_pending", "nurture", "disqualified", "withdrawn"],
  engagement_pending: ["engagement_accepted", "nurture", "lost", "withdrawn"],
  engagement_accepted: ["application_started", "lost", "withdrawn"],
  application_started: ["lost", "withdrawn"],
  nurture: ["attempting_contact", "contacted", "disqualified", "withdrawn", "lost"],
  unresponsive: ["attempting_contact", "disqualified", "withdrawn", "lost"],
  converted: [],
  disqualified: [],
  withdrawn: [],
  lost: [],
};

const QUALIFICATION_FIELDS = [
  "use_of_proceeds", "business_age_years", "deal_type", "ownership_structure",
  "owner_citizenship_state", "credit_estimate", "liquidity_estimate",
  "equity_injection_available", "annual_revenue_estimate", "cash_flow_estimate",
  "debt_obligations_notes", "collateral_notes", "industry", "naics_code",
  "franchise_status", "geographic_location", "time_sensitivity",
  "existing_lender_discussions", "known_eligibility_concerns",
];

const PROVENANCE_STATES = ["unknown", "borrower_stated", "document_supported", "verified", "conflicting", "not_applicable"];

// The underlying brokerage_lead_qualifications table enforces these via
// CHECK constraints / numeric columns. A free-text input let a raw
// Postgres constraint-violation message reach the browser on ordinary
// input (e.g. typing "yes" into a numeric field) — found during live QA.
// Rendering the correct control per field prevents the bad value at entry.
const QUALIFICATION_NUMERIC_FIELDS = new Set([
  "business_age_years",
  "liquidity_estimate",
  "equity_injection_available",
  "annual_revenue_estimate",
  "cash_flow_estimate",
]);
const QUALIFICATION_ENUM_OPTIONS: Record<string, string[]> = {
  deal_type: ["startup", "acquisition", "expansion", "refinance", "other"],
  franchise_status: ["franchise", "independent", "unknown"],
};

function inputStyle(): CSSProperties {
  return { background: c.ink, border: `1px solid ${c.border}`, borderRadius: 5, padding: "7px 9px", color: c.paper, fontSize: 11.5, width: "100%" };
}

export default function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = usePromise(params);

  const [lead, setLead] = useState<Lead | null>(null);
  const [qualification, setQualification] = useState<Qualification>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [qualFields, setQualFields] = useState<Record<string, string>>({});
  const [qualProvenance, setQualProvenance] = useState<Record<string, string>>({});

  const [toStage, setToStage] = useState("");
  const [reason, setReason] = useState("");

  const [contactChannel, setContactChannel] = useState<"call" | "email" | "meeting">("call");
  const [contactOutcome, setContactOutcome] = useState("connected");
  const [contactNotes, setContactNotes] = useState("");

  const [preview, setPreview] = useState<any>(null);
  const [chosenBorrowerId, setChosenBorrowerId] = useState("");

  const [sequenceCatalog, setSequenceCatalog] = useState<Array<{ key: string; label: string; entityType: string }>>([]);
  const [sequenceEnrollments, setSequenceEnrollments] = useState<any[]>([]);
  const [selectedSequence, setSelectedSequence] = useState("");
  const [sequenceBusy, setSequenceBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/leads/${leadId}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setLead(json.lead);
      setQualification(json.qualification);
      setActivities(json.activities ?? []);
      if (json.qualification) {
        const f: Record<string, string> = {};
        for (const key of QUALIFICATION_FIELDS) {
          const v = json.qualification[key];
          if (v != null) f[key] = String(v);
        }
        setQualFields(f);
        setQualProvenance(json.qualification.field_provenance ?? {});
      }
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
  }, [leadId]);

  async function loadSequences() {
    try {
      const res = await fetch(`/api/admin/brokerage/crm/sequences?entityType=lead&entityId=${leadId}`);
      const json = await res.json();
      if (res.ok && json.ok) {
        setSequenceCatalog((json.catalog ?? []).filter((s: any) => s.entityType === "lead"));
        setSequenceEnrollments(json.enrollments ?? []);
      }
    } catch {
      // Non-critical — sequence panel just stays empty.
    }
  }

  useEffect(() => {
    loadSequences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function enrollSequence() {
    if (!selectedSequence) return;
    setSequenceBusy(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enroll", sequenceKey: selectedSequence, entityType: "lead", entityId: leadId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "enroll failed");
      setSelectedSequence("");
      await loadSequences();
    } catch (e: any) {
      setError(e?.message ?? "enroll failed");
    } finally {
      setSequenceBusy(false);
    }
  }

  async function stopSequenceEnrollment(enrollmentId: string) {
    const reason = window.prompt("Reason for stopping this sequence:");
    if (!reason) return;
    setSequenceBusy(true);
    try {
      const res = await fetch("/api/admin/brokerage/crm/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", enrollmentId, reason }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "stop failed");
      await loadSequences();
    } catch (e: any) {
      setError(e?.message ?? "stop failed");
    } finally {
      setSequenceBusy(false);
    }
  }

  async function saveQualification() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/leads/${leadId}/qualification`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: qualFields, provenance: qualProvenance }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "save failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function doTransition() {
    if (!toStage) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/leads/${leadId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transition_stage", toStage, reason: reason || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "transition failed");
      setToStage("");
      setReason("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "transition failed");
    } finally {
      setBusy(false);
    }
  }

  async function logContactAttempt() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/leads/${leadId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_contact_attempt", channel: contactChannel, outcome: contactOutcome, notes: contactNotes || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "log contact failed");
      setContactNotes("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "log contact failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/leads/${leadId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview_convert" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "preview failed");
      setPreview(json.preview);
    } catch (e: any) {
      setError(e?.message ?? "preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmConvert() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/brokerage/crm/leads/${leadId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "convert", borrowerId: chosenBorrowerId || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "convert failed");
      window.location.href = `/deals/${json.dealId}`;
    } catch (e: any) {
      setError(e?.message ?? "convert failed");
      setBusy(false);
    }
  }

  if (loading) return <div style={{ padding: "18px 24px", color: c.textMuted, fontSize: 12 }}>Loading…</div>;
  if (error && !lead) {
    return (
      <div style={{ padding: "18px 24px" }}>
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6 }}>{error}</div>
      </div>
    );
  }
  if (!lead) return null;

  const name = lead.business_name || [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "(unnamed lead)";
  const availableTransitions = ALLOWED_TRANSITIONS[lead.status] ?? [];
  const requiresReason = toStage === "disqualified" || toStage === "lost";

  return (
    <div style={{ padding: "18px 24px 40px", maxWidth: 1100 }}>
      <Link href="/admin/brokerage/crm/leads" style={{ fontSize: 11.5, color: c.textMuted, marginBottom: 14, display: "inline-block" }}>
        ← All leads
      </Link>

      <div style={{ marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 700, fontSize: 24, color: c.paper }}>{name}</div>
          <div style={{ fontSize: 12.5, color: c.textSecondary, marginTop: 4 }}>
            {lead.email ?? "—"} · {lead.phone ?? "—"} · {lead.loan_amount_requested ? `$${lead.loan_amount_requested.toLocaleString()} requested` : "amount unknown"}
          </div>
          <div style={{ fontSize: 11, color: c.textMuted, marginTop: 4 }}>
            Stage: <strong style={{ color: c.brassBright }}>{lead.status.replace(/_/g, " ")}</strong> · Priority: {lead.priority} · Source: {lead.source ?? "—"}
          </div>
        </div>
        {lead.status === "converted" && lead.converted_deal_id && (
          <Link href={`/deals/${lead.converted_deal_id}`} style={{ fontSize: 12, color: c.brassBright }}>
            View converted deal →
          </Link>
        )}
      </div>

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Left column: stage + contact + convert */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {lead.status !== "converted" && availableTransitions.length > 0 && (
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
              <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Move stage</div>
              <select value={toStage} onChange={(e) => setToStage(e.target.value)} style={inputStyle()}>
                <option value="">Select stage…</option>
                {availableTransitions.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
              {requiresReason && (
                <input style={{ ...inputStyle(), marginTop: 8 }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
              <button
                onClick={doTransition}
                disabled={busy || !toStage || (requiresReason && !reason)}
                style={{ marginTop: 8, background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.4 : 1 }}
              >
                Move
              </button>
            </div>
          )}

          {lead.status !== "converted" && (
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
              <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Log contact attempt</div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={contactChannel} onChange={(e) => setContactChannel(e.target.value as any)} style={inputStyle()}>
                  {["call", "email", "meeting"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={contactOutcome} onChange={(e) => setContactOutcome(e.target.value)} style={inputStyle()}>
                  {["no_answer", "left_message", "connected", "scheduled_followup"].map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
                </select>
              </div>
              <input style={{ ...inputStyle(), marginTop: 8 }} placeholder="Notes (optional)" value={contactNotes} onChange={(e) => setContactNotes(e.target.value)} />
              <button
                onClick={logContactAttempt}
                disabled={busy}
                style={{ marginTop: 8, background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.4 : 1 }}
              >
                Log attempt
              </button>
            </div>
          )}

          {lead.status !== "converted" && lead.status !== "disqualified" && lead.status !== "withdrawn" && lead.status !== "lost" && (
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
              <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Convert to deal</div>
              {!preview ? (
                <button
                  onClick={loadPreview}
                  disabled={busy}
                  style={{ background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.4 : 1 }}
                >
                  Review conversion…
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: 11.5, color: c.textSecondary, marginBottom: 8 }}>
                    New borrower: <strong>{preview.proposedBorrowerName}</strong><br />
                    New deal name: <strong>{preview.proposedDealName}</strong>
                  </div>
                  {preview.duplicateBorrowerCandidates?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: c.brick, marginBottom: 4 }}>Possible existing borrower match — link instead of creating new?</div>
                      <select value={chosenBorrowerId} onChange={(e) => setChosenBorrowerId(e.target.value)} style={inputStyle()}>
                        <option value="">Create new borrower</option>
                        {preview.duplicateBorrowerCandidates.map((cand: any) => (
                          <option key={cand.id} value={cand.id}>{cand.legal_name} ({cand.matchReason})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={confirmConvert}
                    disabled={busy}
                    style={{ background: "rgba(184,144,91,.18)", border: `1px solid rgba(184,144,91,.5)`, color: c.brassBright, borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.4 : 1 }}
                  >
                    Confirm conversion
                  </button>
                </div>
              )}
            </div>
          )}

          <CommsPanel targetType="lead" targetId={leadId} onSent={load} />

          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Follow-up sequences</div>
            {sequenceEnrollments.filter((e) => e.status === "active").map((e) => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${c.divider}` }}>
                <span style={{ fontSize: 11.5, color: c.paper }}>{e.sequence_key.replace(/_/g, " ")} — step {e.current_step + 1}</span>
                <button onClick={() => stopSequenceEnrollment(e.id)} disabled={sequenceBusy} style={{ background: "transparent", border: "none", color: c.textMuted, fontSize: 10.5, cursor: "pointer" }}>
                  stop
                </button>
              </div>
            ))}
            {sequenceEnrollments.filter((e) => e.status !== "active").length > 0 && (
              <div style={{ fontSize: 10, color: c.textMuted, marginTop: 4 }}>
                {sequenceEnrollments.filter((e) => e.status !== "active").length} past enrollment(s) (stopped/completed).
              </div>
            )}
            {sequenceCatalog.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <select value={selectedSequence} onChange={(e) => setSelectedSequence(e.target.value)} style={inputStyle()}>
                  <option value="">Enroll in a sequence…</option>
                  {sequenceCatalog.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <button onClick={enrollSequence} disabled={sequenceBusy || !selectedSequence} style={{ background: "rgba(255,255,255,.06)", border: "none", borderRadius: 4, color: c.paper, fontSize: 10.5, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                  Enroll
                </button>
              </div>
            )}
          </div>

          <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "13px 16px", borderBottom: `1px solid ${c.border}`, fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14 }}>
              Activity
            </div>
            {activities.length === 0 ? (
              <div style={{ padding: 20, fontSize: 12, color: c.textMuted, textAlign: "center" }}>No activity yet.</div>
            ) : (
              activities.map((a) => (
                <div key={a.id} style={{ padding: "10px 16px", borderBottom: `1px solid ${c.divider}` }}>
                  <div style={{ fontSize: 11.5, color: c.paper }}>{a.title ?? a.kind}</div>
                  <div style={{ fontSize: 10, color: c.textMuted, marginTop: 2 }}>{new Date(a.happens_at).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column: qualification */}
        <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontFamily: "var(--font-brokerage-display)", fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Qualification</div>
          <div style={{ fontSize: 10.5, color: c.textMuted, marginBottom: 10 }}>
            Distinct from final underwriting facts — borrower-stated values are never treated as verified.
            {qualification?.updated_at ? ` Last saved ${new Date(qualification.updated_at as string).toLocaleString()}.` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto" }}>
            {QUALIFICATION_FIELDS.map((field) => (
              <div key={field} style={{ display: "flex", gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: c.textMuted, marginBottom: 2 }}>{field.replace(/_/g, " ")}</div>
                  {QUALIFICATION_ENUM_OPTIONS[field] ? (
                    <select
                      style={inputStyle()}
                      value={qualFields[field] ?? ""}
                      onChange={(e) => setQualFields((f) => ({ ...f, [field]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {QUALIFICATION_ENUM_OPTIONS[field].map((opt) => (
                        <option key={opt} value={opt}>{opt.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={QUALIFICATION_NUMERIC_FIELDS.has(field) ? "number" : "text"}
                      style={inputStyle()}
                      value={qualFields[field] ?? ""}
                      onChange={(e) => setQualFields((f) => ({ ...f, [field]: e.target.value }))}
                    />
                  )}
                </div>
                <div style={{ width: 130 }}>
                  <div style={{ fontSize: 10, color: c.textMuted, marginBottom: 2 }}>provenance</div>
                  <select
                    style={inputStyle()}
                    value={qualProvenance[field] ?? "unknown"}
                    onChange={(e) => setQualProvenance((p) => ({ ...p, [field]: e.target.value }))}
                  >
                    {PROVENANCE_STATES.map((p) => <option key={p} value={p}>{p.replace("_", " ")}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={saveQualification}
            disabled={busy}
            style={{ marginTop: 10, background: "#1B1E23", border: `1px solid ${c.borderStronger}`, color: c.paper, borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.4 : 1 }}
          >
            Save qualification
          </button>
        </div>
      </div>
    </div>
  );
}
