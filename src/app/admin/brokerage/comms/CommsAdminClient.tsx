"use client";

import { useState } from "react";

type OutboxCounts = { pending: number; sending: number; sent: number; failed: number; retryScheduled: number; exhausted: number };
type OrchResult = { dealId: string; borrowerNudges: { planned: number; enqueued: number; skipped: number }; bankerAlerts: { planned: number; enqueued: number; skipped: number }; outbox: { processed: number; sent: number; failed: number }; warnings: string[] };
type BatchResult = { dealsProcessed: number; totalEnqueued: number; totalSkipped: number; warnings: string[] };
type LedgerEvent = { event_type: string; channel: string; recipient_masked: string; created_at: string };

// ── Sub-components ──────────────────────────────────────────────────────────

function CommsModeBanner() {
  const mode = "stub"; // Read from API in production
  const color = mode === "live" ? "bg-red-900/40 border-red-700 text-red-200" : mode === "dry_run" ? "bg-amber-900/40 border-amber-700 text-amber-200" : "bg-neutral-800 border-neutral-700 text-neutral-300";
  return (
    <div className={`rounded-md border p-3 text-sm ${color}`} data-testid="comms-mode-banner">
      Communications mode: <strong>{mode.toUpperCase()}</strong>
      {mode === "live" && <span className="ml-2 text-xs">(outbox processing will send real messages)</span>}
    </div>
  );
}

function CommsStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { pending: "bg-amber-700", sending: "bg-blue-700", sent: "bg-emerald-700", failed: "bg-red-700", retry_scheduled: "bg-amber-600", exhausted: "bg-red-900" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${colors[status] ?? "bg-neutral-600"}`}>{status}</span>;
}

function CommsOutboxTable({ items }: { items: Array<{ id: string; channel: string; status: string; recipient_masked: string; trigger_key: string; attempt_count: number }> }) {
  if (items.length === 0) return <div className="text-sm text-neutral-500 py-4">No outbox items.</div>;
  return (
    <table className="w-full text-sm text-left" data-testid="outbox-table">
      <thead className="text-xs text-neutral-400 uppercase border-b border-neutral-800">
        <tr><th className="py-2 pr-3">Channel</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Recipient</th><th className="py-2 pr-3">Trigger</th><th className="py-2 pr-3">Attempts</th></tr>
      </thead>
      <tbody>
        {items.map(i => (
          <tr key={i.id} className="border-b border-neutral-800/50">
            <td className="py-2 pr-3">{i.channel}</td>
            <td className="py-2 pr-3"><CommsStatusBadge status={i.status} /></td>
            <td className="py-2 pr-3 text-xs font-mono">{i.recipient_masked}</td>
            <td className="py-2 pr-3">{i.trigger_key}</td>
            <td className="py-2 pr-3">{i.attempt_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CommsLedgerTimeline({ events }: { events: LedgerEvent[] }) {
  if (events.length === 0) return <div className="text-sm text-neutral-500 py-4">No ledger events.</div>;
  return (
    <div className="space-y-1 max-h-60 overflow-y-auto" data-testid="ledger-timeline">
      {events.map((e, i) => (
        <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-neutral-800/50">
          <span className="font-medium">{e.event_type}</span>
          <span>{e.channel}</span>
          <span className="font-mono">{e.recipient_masked}</span>
          <span className="text-neutral-500">{e.created_at}</span>
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
    <div className="space-y-6">
      <CommsModeBanner />

      {/* Deal comms */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">Deal Communications</h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-neutral-500">Deal ID</label>
            <input type="text" value={dealId} onChange={e => setDealId(e.target.value)} placeholder="Enter deal ID" className="mt-1 w-full rounded bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100" />
          </div>
          <button type="button" onClick={() => runDealComms(false)} disabled={busy === "deal" || !dealId.trim()} className="rounded bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-600 disabled:opacity-50" data-testid="run-comms-check">
            {busy === "deal" ? "Running..." : "Run Comms Check"}
          </button>
          <button type="button" onClick={() => runDealComms(true)} disabled={busy === "deal" || !dealId.trim()} className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50" data-testid="run-comms-process">
            {busy === "deal" ? "..." : "Check + Process"}
          </button>
        </div>
        {showConfirm === "deal-outbox" && (
          <div className="mt-3 rounded bg-amber-900/30 border border-amber-700 p-3 text-sm text-amber-200" data-testid="confirm-dialog">
            This will process outbox items and may send real messages in live mode. <button type="button" onClick={() => runDealComms(true)} className="underline font-medium">Confirm</button> | <button type="button" onClick={() => setShowConfirm(null)} className="underline">Cancel</button>
          </div>
        )}
        {result && (
          <div className="mt-4 rounded bg-neutral-800 p-3 text-sm">
            <div>Nudges: {result.borrowerNudges?.enqueued ?? 0} enqueued, {result.borrowerNudges?.skipped ?? 0} skipped</div>
            <div>Alerts: {result.bankerAlerts?.enqueued ?? 0} enqueued, {result.bankerAlerts?.skipped ?? 0} skipped</div>
            {result.outbox?.processed > 0 && <div>Outbox: {result.outbox.sent} sent, {result.outbox.failed} failed</div>}
            {result.warnings?.length > 0 && <div className="text-amber-400 mt-1">{result.warnings.join("; ")}</div>}
          </div>
        )}
      </section>

      {/* Global outbox */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">Global Outbox Processing</h3>
        <div className="flex gap-3 items-end">
          <div>
            <label className="text-xs text-neutral-500">Limit</label>
            <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="mt-1 rounded bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-100" data-testid="limit-selector">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <button type="button" onClick={processGlobalOutbox} disabled={busy === "outbox"} className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50" data-testid="process-global-outbox">
            {busy === "outbox" ? "Processing..." : "Process Global Outbox"}
          </button>
        </div>
        {showConfirm === "global-outbox" && (
          <div className="mt-3 rounded bg-red-900/30 border border-red-700 p-3 text-sm text-red-200" data-testid="confirm-dialog">
            This will send pending messages. In live mode, real emails/SMS will be sent. <button type="button" onClick={processGlobalOutbox} className="underline font-medium">Confirm</button> | <button type="button" onClick={() => setShowConfirm(null)} className="underline">Cancel</button>
          </div>
        )}
      </section>

      {/* Batch */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">Batch Orchestration</h3>
        <button type="button" onClick={() => runBatch(false)} disabled={busy === "batch"} className="rounded bg-neutral-700 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-600 disabled:opacity-50">
          {busy === "batch" ? "Running..." : `Run Batch (${limit} deals, enqueue only)`}
        </button>
        {batchResult && (
          <div className="mt-4 rounded bg-neutral-800 p-3 text-sm">
            <div>Deals processed: {batchResult.dealsProcessed}</div>
            <div>Total enqueued: {batchResult.totalEnqueued}</div>
            <div>Total skipped: {batchResult.totalSkipped}</div>
            {batchResult.warnings?.length > 0 && <div className="text-amber-400 mt-1">{batchResult.warnings.slice(0, 5).join("; ")}</div>}
          </div>
        )}
      </section>

      {error && <div className="rounded border border-red-700 bg-red-900/30 p-3 text-sm text-red-200">{error}</div>}
    </div>
  );
}
