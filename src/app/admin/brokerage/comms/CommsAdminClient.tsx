"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { brokerageColors as c } from "@/components/brokerage/tokens";

type OutboxCounts = { pending: number; sending: number; sent: number; failed: number; retryScheduled: number; exhausted: number };
type OrchResult = { dealId: string; borrowerNudges: { planned: number; enqueued: number; skipped: number }; bankerAlerts: { planned: number; enqueued: number; skipped: number }; outbox: { processed: number; sent: number; failed: number }; warnings: string[] };
type BatchResult = { dealsProcessed: number; totalEnqueued: number; totalSkipped: number; warnings: string[] };
type LedgerEvent = { event_type: string; channel: string; recipient_masked: string; created_at: string };
type LifecycleEvent = { event_type: string; outcome: string; deal_id: string | null; channel: string; purpose: string | null; recipient_masked: string; reason: string | null; created_at: string };
type LifecycleSummary = { totalHookEvents: number; byHookType: Record<string, { received: number; enqueued: number; skipped: number; failed: number }>; latestTimestamp: string | null; latestSkipReasons: string[]; relatedOutbox: { pending: number; sent: number; failed: number; exhausted: number }; relatedNudges: number; relatedAlerts: number; warnings: string[] };

// ── Shared style helpers ─────────────────────────────────────────────────

function cardStyle(): CSSProperties {
  return { background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16 };
}

function sectionTitleStyle(): CSSProperties {
  return {
    fontFamily: "var(--font-brokerage-mono)",
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: c.textFaint,
    marginBottom: 12,
  };
}

function inputStyle(): CSSProperties {
  return {
    background: c.ink,
    border: `1px solid ${c.border}`,
    borderRadius: 5,
    padding: "8px 10px",
    color: c.paper,
    fontSize: 12,
    fontFamily: "var(--font-brokerage-sans)",
  };
}

function buttonStyle(variant: "neutral" | "brass" | "danger", disabled: boolean): CSSProperties {
  const base: CSSProperties = {
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    border: "none",
  };
  if (variant === "brass") {
    return { ...base, background: `linear-gradient(150deg, ${c.brassBright}, ${c.brass})`, color: c.brassOnBrass };
  }
  if (variant === "danger") {
    return { ...base, background: "rgba(168,93,82,.85)", color: "#2A0F0C" };
  }
  return { ...base, background: c.borderStrong, color: c.paper, border: `1px solid ${c.borderStronger}` };
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CommsModeBanner() {
  const mode = "stub" as "stub" | "dry_run" | "live"; // Read from API in production
  const styles =
    mode === "live"
      ? { border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.12)", color: c.brick }
      : mode === "dry_run"
        ? { border: `1px solid ${c.brassBright}`, background: "rgba(184,144,91,.12)", color: c.brassBright }
        : { border: `1px solid ${c.border}`, background: c.card, color: c.textSecondary };
  return (
    <div style={{ ...styles, borderRadius: 8, padding: 12, fontSize: 12 }} data-testid="comms-mode-banner">
      Communications mode: <strong>{mode.toUpperCase()}</strong>
      {mode === "live" && <span style={{ marginLeft: 8, fontSize: 11 }}>(outbox processing will send real messages)</span>}
    </div>
  );
}

const STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  pending: { text: c.brassBright, bg: "rgba(184,144,91,.15)" },
  sending: { text: "#7BAECF", bg: "rgba(55,138,221,.15)" },
  sent: { text: c.sage, bg: "rgba(90,138,110,.15)" },
  failed: { text: c.brick, bg: "rgba(168,93,82,.15)" },
  retry_scheduled: { text: c.brassBright, bg: "rgba(184,144,91,.1)" },
  exhausted: { text: c.brick, bg: "rgba(168,93,82,.2)" },
};

function CommsStatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { text: c.textSecondary, bg: "rgba(154,150,140,.1)" };
  return (
    <span
      style={{
        display: "inline-flex",
        fontFamily: "var(--font-brokerage-mono)",
        fontSize: 9,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: s.text,
        background: s.bg,
        padding: "3px 7px",
        borderRadius: 2,
      }}
    >
      {status}
    </span>
  );
}

function CommsOutboxTable({ items }: { items: Array<{ id: string; channel: string; status: string; recipient_masked: string; trigger_key: string; attempt_count: number }> }) {
  if (items.length === 0) return <div style={{ fontSize: 12, color: c.textMuted, padding: "16px 0" }}>No outbox items.</div>;
  const grid = "90px 100px 1fr 1fr 80px";
  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 6, overflow: "hidden" }} data-testid="outbox-table">
      <div style={{ display: "grid", gridTemplateColumns: grid, padding: "7px 12px", background: c.inkHeader, fontFamily: "var(--font-brokerage-mono)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: c.textFaint }}>
        <div>Channel</div><div>Status</div><div>Recipient</div><div>Trigger</div><div>Attempts</div>
      </div>
      {items.map((i) => (
        <div key={i.id} style={{ display: "grid", gridTemplateColumns: grid, padding: "8px 12px", borderTop: `1px solid ${c.divider}`, alignItems: "center", fontSize: 12 }}>
          <div style={{ color: c.paper }}>{i.channel}</div>
          <div><CommsStatusBadge status={i.status} /></div>
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 11, color: c.textSecondary }}>{i.recipient_masked}</div>
          <div style={{ color: c.textSecondary }}>{i.trigger_key}</div>
          <div style={{ color: c.textMuted }}>{i.attempt_count}</div>
        </div>
      ))}
    </div>
  );
}

function CommsLedgerTimeline({ events }: { events: LedgerEvent[] }) {
  if (events.length === 0) return <div style={{ fontSize: 12, color: c.textMuted, padding: "16px 0" }}>No ledger events.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }} data-testid="ledger-timeline">
      {events.map((e, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, padding: "6px 0", borderBottom: `1px solid ${c.divider}` }}>
          <span style={{ fontWeight: 600, color: c.paper }}>{e.event_type}</span>
          <span style={{ color: c.textSecondary }}>{e.channel}</span>
          <span style={{ fontFamily: "var(--font-brokerage-mono)", color: c.textSecondary }}>{e.recipient_masked}</span>
          <span style={{ color: c.textMuted }}>{e.created_at}</span>
        </div>
      ))}
    </div>
  );
}

const OUTCOME_COLORS: Record<string, { text: string; bg: string }> = {
  received: { text: "#7BAECF", bg: "rgba(55,138,221,.15)" },
  enqueued: { text: c.sage, bg: "rgba(90,138,110,.15)" },
  skipped: { text: c.brassBright, bg: "rgba(184,144,91,.15)" },
  failed: { text: c.brick, bg: "rgba(168,93,82,.15)" },
};

function LifecycleOutcomeBadge({ outcome }: { outcome: string }) {
  const s = OUTCOME_COLORS[outcome] ?? { text: c.textSecondary, bg: "rgba(154,150,140,.1)" };
  return (
    <span
      style={{
        display: "inline-flex",
        fontFamily: "var(--font-brokerage-mono)",
        fontSize: 9,
        letterSpacing: 1,
        textTransform: "uppercase",
        color: s.text,
        background: s.bg,
        padding: "3px 7px",
        borderRadius: 2,
      }}
    >
      {outcome}
    </span>
  );
}

function LifecycleHooksTable({ events }: { events: LifecycleEvent[] }) {
  if (events.length === 0)
    return (
      <div style={{ fontSize: 12, color: c.textMuted, padding: "16px 0" }} data-testid="lifecycle-empty">
        No lifecycle hook events recorded yet.
      </div>
    );
  const grid = "110px 90px 90px 1fr 1fr 1fr 110px";
  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 6, overflow: "hidden" }} data-testid="lifecycle-hooks-table">
      <div style={{ display: "grid", gridTemplateColumns: grid, padding: "7px 12px", background: c.inkHeader, fontFamily: "var(--font-brokerage-mono)", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: c.textFaint }}>
        <div>Event</div><div>Outcome</div><div>Channel</div><div>Purpose</div><div>Recipient</div><div>Reason</div><div>Time</div>
      </div>
      {events.map((e, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: grid, padding: "8px 12px", borderTop: `1px solid ${c.divider}`, alignItems: "center", fontSize: 11 }}>
          <div style={{ color: c.paper }}>{e.event_type.replace("comms_lifecycle_hook_", "")}</div>
          <div><LifecycleOutcomeBadge outcome={e.outcome} /></div>
          <div style={{ color: c.textSecondary }}>{e.channel}</div>
          <div style={{ color: c.textSecondary }}>{e.purpose ?? "-"}</div>
          <div style={{ fontFamily: "var(--font-brokerage-mono)", color: c.textSecondary }}>{e.recipient_masked}</div>
          <div style={{ color: c.textMuted }}>{e.reason ?? "-"}</div>
          <div style={{ color: c.textMuted, fontFamily: "var(--font-brokerage-mono)" }}>{e.created_at}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main client ─────────────────────────────────────────────────────────────

export default function CommsAdminClient() {
  const [dealId, setDealId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<OrchResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [limit, setLimit] = useState(25);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lifecycleEvents, setLifecycleEvents] = useState<LifecycleEvent[]>([]);
  const [lifecycleSummary, setLifecycleSummary] = useState<LifecycleSummary | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  async function runDealComms(processOutbox = false) {
    if (!dealId.trim()) return;
    if (processOutbox && showConfirm !== "deal-outbox") { setShowConfirm("deal-outbox"); return; }
    setBusy("deal"); setError(null); setShowConfirm(null);
    try {
      const res = await fetch(`/api/brokerage/deals/${dealId}/comms/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ processOutbox }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      setResult(json);
    } catch (e: any) { setError(e?.message ?? "Failed"); } finally { setBusy(null); }
  }

  async function processGlobalOutbox() {
    if (showConfirm !== "global-outbox") { setShowConfirm("global-outbox"); return; }
    setBusy("outbox"); setError(null); setShowConfirm(null);
    try {
      const res = await fetch("/api/brokerage/comms/outbox/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmProcessOutbox: true, limit }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      setResult(json);
    } catch (e: any) { setError(e?.message ?? "Failed"); } finally { setBusy(null); }
  }

  async function loadLifecycleHooks() {
    setLifecycleBusy(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (dealId.trim()) params.set("dealId", dealId.trim());
      const res = await fetch(`/api/brokerage/comms/lifecycle?${params}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      setLifecycleEvents(json.events ?? []);
      setLifecycleSummary(json.summary ?? null);
    } catch (e: any) { setError(e?.message ?? "Failed"); } finally { setLifecycleBusy(false); }
  }

  async function runBatch(processOutbox = false) {
    setBusy("batch"); setError(null);
    try {
      const res = await fetch("/api/brokerage/comms/batch/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ processOutbox, limit }) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed");
      setBatchResult(json);
    } catch (e: any) { setError(e?.message ?? "Failed"); } finally { setBusy(null); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980 }}>
      <CommsModeBanner />

      {/* Deal comms */}
      <section style={cardStyle()}>
        <h3 style={sectionTitleStyle()}>Deal communications</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: c.textMuted }}>Deal ID</label>
            <input
              type="text"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              placeholder="Enter deal ID"
              style={{ ...inputStyle(), width: "100%", marginTop: 4 }}
            />
          </div>
          <button type="button" onClick={() => runDealComms(false)} disabled={busy === "deal" || !dealId.trim()} style={buttonStyle("neutral", busy === "deal" || !dealId.trim())} data-testid="run-comms-check">
            {busy === "deal" ? "Running…" : "Run comms check"}
          </button>
          <button type="button" onClick={() => runDealComms(true)} disabled={busy === "deal" || !dealId.trim()} style={buttonStyle("brass", busy === "deal" || !dealId.trim())} data-testid="run-comms-process">
            {busy === "deal" ? "…" : "Check + process"}
          </button>
        </div>
        {showConfirm === "deal-outbox" && (
          <div style={{ marginTop: 10, border: `1px solid ${c.brassBright}`, background: "rgba(184,144,91,.1)", color: c.brassBright, borderRadius: 6, padding: 12, fontSize: 12 }} data-testid="confirm-dialog">
            This will process outbox items and may send real messages in live mode.{" "}
            <button type="button" onClick={() => runDealComms(true)} style={{ textDecoration: "underline", fontWeight: 600, color: c.brassBright, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Confirm
            </button>{" "}
            |{" "}
            <button type="button" onClick={() => setShowConfirm(null)} style={{ textDecoration: "underline", color: c.brassBright, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Cancel
            </button>
          </div>
        )}
        {result && (
          <div style={{ marginTop: 14, background: c.ink, border: `1px solid ${c.border}`, borderRadius: 6, padding: 12, fontSize: 12, color: c.textSecondary, lineHeight: 1.7 }}>
            <div>Nudges: {result.borrowerNudges?.enqueued ?? 0} enqueued, {result.borrowerNudges?.skipped ?? 0} skipped</div>
            <div>Alerts: {result.bankerAlerts?.enqueued ?? 0} enqueued, {result.bankerAlerts?.skipped ?? 0} skipped</div>
            {result.outbox?.processed > 0 && <div>Outbox: {result.outbox.sent} sent, {result.outbox.failed} failed</div>}
            {result.warnings?.length > 0 && <div style={{ color: c.brassBright, marginTop: 4 }}>{result.warnings.join("; ")}</div>}
          </div>
        )}
      </section>

      {/* Global outbox */}
      <section style={cardStyle()}>
        <h3 style={sectionTitleStyle()}>Global outbox processing</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div>
            <label style={{ fontSize: 10, color: c.textMuted }}>Limit</label>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...inputStyle(), marginTop: 4 }} data-testid="limit-selector">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <button type="button" onClick={processGlobalOutbox} disabled={busy === "outbox"} style={buttonStyle("danger", busy === "outbox")} data-testid="process-global-outbox">
            {busy === "outbox" ? "Processing…" : "Process global outbox"}
          </button>
        </div>
        {showConfirm === "global-outbox" && (
          <div style={{ marginTop: 10, border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, borderRadius: 6, padding: 12, fontSize: 12 }} data-testid="confirm-dialog">
            This will send pending messages. In live mode, real emails/SMS will be sent.{" "}
            <button type="button" onClick={processGlobalOutbox} style={{ textDecoration: "underline", fontWeight: 600, color: c.brick, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Confirm
            </button>{" "}
            |{" "}
            <button type="button" onClick={() => setShowConfirm(null)} style={{ textDecoration: "underline", color: c.brick, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Cancel
            </button>
          </div>
        )}
      </section>

      {/* Batch */}
      <section style={cardStyle()}>
        <h3 style={sectionTitleStyle()}>Batch orchestration</h3>
        <button type="button" onClick={() => runBatch(false)} disabled={busy === "batch"} style={buttonStyle("neutral", busy === "batch")}>
          {busy === "batch" ? "Running…" : `Run batch (${limit} deals, enqueue only)`}
        </button>
        {batchResult && (
          <div style={{ marginTop: 14, background: c.ink, border: `1px solid ${c.border}`, borderRadius: 6, padding: 12, fontSize: 12, color: c.textSecondary, lineHeight: 1.7 }}>
            <div>Deals processed: {batchResult.dealsProcessed}</div>
            <div>Total enqueued: {batchResult.totalEnqueued}</div>
            <div>Total skipped: {batchResult.totalSkipped}</div>
            {batchResult.warnings?.length > 0 && <div style={{ color: c.brassBright, marginTop: 4 }}>{batchResult.warnings.slice(0, 5).join("; ")}</div>}
          </div>
        )}
      </section>

      {/* Lifecycle hooks */}
      <section style={cardStyle()} data-testid="lifecycle-hooks-section">
        <h3 style={sectionTitleStyle()}>Lifecycle hooks</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 14 }}>
          <button type="button" onClick={loadLifecycleHooks} disabled={lifecycleBusy} style={buttonStyle("neutral", lifecycleBusy)} data-testid="load-lifecycle">
            {lifecycleBusy ? "Loading…" : dealId.trim() ? `Load for ${dealId.slice(0, 8)}…` : "Load recent (global)"}
          </button>
        </div>
        {lifecycleSummary && (
          <div style={{ background: c.ink, border: `1px solid ${c.border}`, borderRadius: 6, padding: 12, fontSize: 12, color: c.textSecondary, lineHeight: 1.7, marginBottom: 12 }}>
            <div>Total hook events: {lifecycleSummary.totalHookEvents}</div>
            <div>Outbox: {lifecycleSummary.relatedOutbox.pending} pending, {lifecycleSummary.relatedOutbox.sent} sent, {lifecycleSummary.relatedOutbox.failed} failed</div>
            <div>Nudges: {lifecycleSummary.relatedNudges} | Alerts: {lifecycleSummary.relatedAlerts}</div>
            {lifecycleSummary.latestSkipReasons.length > 0 && <div style={{ color: c.brassBright, marginTop: 4 }}>Skip reasons: {lifecycleSummary.latestSkipReasons.join(", ")}</div>}
            {lifecycleSummary.warnings.length > 0 && <div style={{ color: c.brassBright, marginTop: 4 }}>{lifecycleSummary.warnings.join("; ")}</div>}
          </div>
        )}
        <LifecycleHooksTable events={lifecycleEvents} />
      </section>

      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, borderRadius: 6, padding: 12, fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}
