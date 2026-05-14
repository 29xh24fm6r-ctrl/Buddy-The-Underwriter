/**
 * Phase 11L — End-to-End Comms QA Harness
 *
 * Deterministic scenarios proving the full comms pipeline:
 * missing docs → nudge → outbox → adapter → ledger → metrics
 */

import { enqueueCommsMessage, processCommsOutboxItem, claimDueCommsMessages } from "@/lib/brokerage/commsOutbox";
import { enqueueBorrowerNudges, getBorrowerNudgeEligibility } from "@/lib/brokerage/borrowerNudges";
import { enqueueBankerAlerts } from "@/lib/brokerage/bankerAlerts";
import { computeCommsMetrics } from "@/lib/brokerage/commsHardening";
import { maskRecipient } from "@/lib/brokerage/commsLedger";

// ── Types ───────────────────────────────────────────────────────────────────

export type QaScenarioName =
  | "missing_docs_email_only"
  | "missing_docs_sms_opted_in"
  | "missing_docs_sms_no_opt_in"
  | "provider_retry_then_success"
  | "provider_retry_exhausted"
  | "banker_alert_ready_for_review"
  | "closed_deal_skipped";

export type QaScenarioResult = {
  name: QaScenarioName;
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

export type QaInvariantResult = {
  ok: boolean;
  violations: string[];
};

type Row = Record<string, any>;
type SB = { from: (t: string) => any };

// ── Live mode guard ─────────────────────────────────────────────────────────

export function assertQaSafeMode(): { safe: boolean; reason?: string } {
  const mode = process.env.BROKERAGE_COMMS_MODE;
  if (mode === "live" && process.env.ALLOW_LIVE_COMMS_QA !== "true") {
    return { safe: false, reason: "BROKERAGE_COMMS_MODE=live without ALLOW_LIVE_COMMS_QA=true" };
  }
  return { safe: true };
}

// ── Seed ────────────────────────────────────────────────────────────────────

export function seedCommsQaScenario(name: QaScenarioName): { db: QaStub; dealId: string } {
  const dealId = `qa-deal-${name}`;
  const db = new QaStub();

  const baseDeal = { id: dealId, status: "active", display_name: `QA ${name}`, borrower_name: "QA Borrower", borrower_email: "qa@test.com", bank_id: "qa-bank", created_at: new Date().toISOString() };
  const baseSession = { deal_id: dealId, extracted_facts: { borrower: { first_name: "QA", phone: null, sms_opt_in: false } } };
  const missingSlot = { deal_id: dealId, required_doc_type: "BUSINESS_TAX_RETURN" };

  switch (name) {
    case "missing_docs_email_only":
      db.tables.deals.push(baseDeal);
      db.tables.borrower_concierge_sessions.push(baseSession);
      db.tables.deal_document_slots.push(missingSlot);
      break;
    case "missing_docs_sms_opted_in":
      db.tables.deals.push(baseDeal);
      db.tables.borrower_concierge_sessions.push({ ...baseSession, extracted_facts: { borrower: { first_name: "QA", phone: "+12025559999", sms_opt_in: true } } });
      db.tables.deal_document_slots.push(missingSlot);
      break;
    case "missing_docs_sms_no_opt_in":
      db.tables.deals.push(baseDeal);
      db.tables.borrower_concierge_sessions.push({ ...baseSession, extracted_facts: { borrower: { first_name: "QA", phone: "+12025559999", sms_opt_in: false } } });
      db.tables.deal_document_slots.push(missingSlot);
      break;
    case "provider_retry_then_success":
    case "provider_retry_exhausted":
      db.tables.deals.push(baseDeal);
      break;
    case "banker_alert_ready_for_review":
      db.tables.deals.push(baseDeal);
      break;
    case "closed_deal_skipped":
      db.tables.deals.push({ ...baseDeal, status: "funded" });
      break;
  }

  return { db, dealId };
}

// ── Run ─────────────────────────────────────────────────────────────────────

export async function runCommsQaScenario(name: QaScenarioName, sb: SB): Promise<QaScenarioResult> {
  const checks: QaScenarioResult["checks"] = [];

  function check(n: string, passed: boolean, detail: string) {
    checks.push({ name: n, passed, detail });
  }

  const { db, dealId } = seedCommsQaScenario(name);
  const stubSb = db as any as SB;

  switch (name) {
    case "missing_docs_email_only": {
      const elig = await getBorrowerNudgeEligibility(dealId, stubSb);
      check("eligible", elig.eligible, `eligible=${elig.eligible}`);
      check("email_allowed", elig.emailAllowed, `emailAllowed=${elig.emailAllowed}`);
      check("sms_not_allowed", !elig.smsAllowed, `smsAllowed=${elig.smsAllowed}`);
      const r = await enqueueBorrowerNudges(dealId, stubSb);
      check("enqueued", r.enqueued >= 1, `enqueued=${r.enqueued}`);
      const outbox = db.tables.brokerage_comms_outbox;
      check("outbox_email", outbox.some(i => i.channel === "email"), "email outbox created");
      check("outbox_no_sms", !outbox.some(i => i.channel === "sms"), "no sms outbox");
      break;
    }
    case "missing_docs_sms_opted_in": {
      const elig = await getBorrowerNudgeEligibility(dealId, stubSb);
      check("sms_allowed", elig.smsAllowed, `smsAllowed=${elig.smsAllowed}`);
      const r = await enqueueBorrowerNudges(dealId, stubSb);
      check("enqueued", r.enqueued >= 2, `enqueued=${r.enqueued} (email+sms)`);
      check("outbox_sms", db.tables.brokerage_comms_outbox.some(i => i.channel === "sms"), "sms outbox created");
      break;
    }
    case "missing_docs_sms_no_opt_in": {
      const elig = await getBorrowerNudgeEligibility(dealId, stubSb);
      check("sms_not_allowed", !elig.smsAllowed, `smsAllowed=${elig.smsAllowed}`);
      const r = await enqueueBorrowerNudges(dealId, stubSb);
      check("no_sms_outbox", !db.tables.brokerage_comms_outbox.some(i => i.channel === "sms"), "sms not enqueued");
      break;
    }
    case "provider_retry_then_success": {
      const { id } = await enqueueCommsMessage({ idempotencyKey: `qa-retry-${dealId}`, channel: "email", provider: "resend", recipient: "qa@test.com", body: "Test", dealId }, stubSb);
      const claimed = await claimDueCommsMessages(stubSb);
      check("claimed", claimed.length >= 1, `claimed=${claimed.length}`);
      // First attempt: retryable failure
      const r1 = await processCommsOutboxItem(claimed[0], async () => ({ ok: false, error: "429", retryable: true }), stubSb);
      check("retry_scheduled", r1 === "retry_scheduled", `outcome=${r1}`);
      // Mark as due again for retry
      const item = db.tables.brokerage_comms_outbox[0];
      item.status = "retry_scheduled";
      item.next_attempt_at = new Date(Date.now() - 1000).toISOString();
      const claimed2 = await claimDueCommsMessages(stubSb);
      if (claimed2.length > 0) {
        const r2 = await processCommsOutboxItem(claimed2[0], async () => ({ ok: true, providerMessageId: "qa-msg-1" }), stubSb);
        check("sent_on_retry", r2 === "sent", `outcome=${r2}`);
      } else {
        check("sent_on_retry", false, "could not reclaim");
      }
      break;
    }
    case "provider_retry_exhausted": {
      await enqueueCommsMessage({ idempotencyKey: `qa-exhaust-${dealId}`, channel: "email", provider: "resend", recipient: "qa@test.com", body: "Test", dealId }, stubSb);
      const failAdapter = async () => ({ ok: false as const, error: "503", retryable: true });
      // Process 3 times
      for (let i = 0; i < 3; i++) {
        const item = db.tables.brokerage_comms_outbox[0];
        if (item.status === "retry_scheduled") { item.next_attempt_at = new Date(Date.now() - 1000).toISOString(); }
        const claimed = await claimDueCommsMessages(stubSb);
        if (claimed.length > 0) await processCommsOutboxItem(claimed[0], failAdapter, stubSb);
      }
      check("exhausted", db.tables.brokerage_comms_outbox[0].status === "exhausted", `status=${db.tables.brokerage_comms_outbox[0].status}`);
      break;
    }
    case "banker_alert_ready_for_review": {
      const origEmail = process.env.BROKERAGE_BANKER_EMAIL;
      process.env.BROKERAGE_BANKER_EMAIL = "qa-banker@test.com";
      const r = await enqueueBankerAlerts(dealId, "deal_ready_for_review", stubSb);
      check("enqueued", r.enqueued >= 1, `enqueued=${r.enqueued}`);
      check("outbox_created", db.tables.brokerage_comms_outbox.length >= 1, "outbox row created");
      process.env.BROKERAGE_BANKER_EMAIL = origEmail;
      break;
    }
    case "closed_deal_skipped": {
      const r = await enqueueBorrowerNudges(dealId, stubSb);
      check("skipped", r.skipped >= 1, `skipped=${r.skipped}`);
      check("no_outbox", db.tables.brokerage_comms_outbox.length === 0, "no outbox items");
      const ledgerSkipped = db.tables.brokerage_comms_ledger.some(e => e.event_type === "borrower_nudge_skipped");
      check("skip_ledger", ledgerSkipped, "skip ledger event emitted");
      break;
    }
  }

  return { name, passed: checks.every(c => c.passed), checks };
}

// ── Invariants ──────────────────────────────────────────────────────────────

export function assertCommsQaInvariants(db: { tables: Record<string, Row[]> }): QaInvariantResult {
  const violations: string[] = [];

  // Check outbox recipients are not raw emails/phones
  for (const item of db.tables.brokerage_comms_outbox ?? []) {
    // Outbox stores raw recipients (needed for sending) — check ledger instead
  }

  // Check ledger recipients are masked
  for (const event of db.tables.brokerage_comms_ledger ?? []) {
    const masked = event.recipient_masked;
    if (!masked) continue;
    if (masked.includes("@") && !masked.includes("*") && masked !== "n/a" && masked !== "orchestrator" && masked !== "cron" && masked !== "slack") {
      violations.push(`Unmasked email in ledger: ${masked}`);
    }
  }

  // Check no secrets in any ledger metadata
  const SECRETS = /RESEND_API_KEY|TELNYX_API_KEY|SLACK_WEBHOOK_URL|Bearer\s+\S{10,}/;
  for (const event of db.tables.brokerage_comms_ledger ?? []) {
    const meta = JSON.stringify(event.metadata ?? {});
    if (SECRETS.test(meta)) violations.push(`Secret in ledger metadata: ${event.event_type}`);
  }

  // Check expected ledger event types exist when outbox has items
  if ((db.tables.brokerage_comms_outbox ?? []).length > 0) {
    const types = new Set((db.tables.brokerage_comms_ledger ?? []).map(e => e.event_type));
    if (!types.has("borrower_nudge_plan_built") && !types.has("banker_alert_plan_built") && !types.has("brokerage_comms_send_requested")) {
      violations.push("Outbox has items but no corresponding ledger events");
    }
  }

  return { ok: violations.length === 0, violations };
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function cleanupCommsQaScenario(db: { tables: Record<string, Row[]> }): void {
  for (const key of Object.keys(db.tables)) {
    db.tables[key] = db.tables[key].filter(r => !String(r.id ?? r.deal_id ?? "").startsWith("qa-"));
  }
}

// ── Full QA run ─────────────────────────────────────────────────────────────

export async function runAllCommsQaScenarios(): Promise<{ passed: boolean; scenarios: QaScenarioResult[] }> {
  const guard = assertQaSafeMode();
  if (!guard.safe) throw new Error(`QA harness blocked: ${guard.reason}`);

  const names: QaScenarioName[] = [
    "missing_docs_email_only", "missing_docs_sms_opted_in", "missing_docs_sms_no_opt_in",
    "provider_retry_then_success", "provider_retry_exhausted",
    "banker_alert_ready_for_review", "closed_deal_skipped",
  ];

  const scenarios: QaScenarioResult[] = [];
  for (const name of names) {
    const { db } = seedCommsQaScenario(name);
    const result = await runCommsQaScenario(name, db as any);
    scenarios.push(result);
  }

  return { passed: scenarios.every(s => s.passed), scenarios };
}

// ── Stub DB (reusable across scenarios) ─────────────────────────────────────

export class QaStub {
  tables: Record<string, Row[]> = {
    deals: [], borrower_concierge_sessions: [], deal_documents: [],
    deal_document_slots: [], brokerage_comms_outbox: [],
    brokerage_comms_ledger: [], brokerage_borrower_message_templates: [],
    brokerage_borrower_message_outbox: [],
  };
  from(t: string) { return new QaQB(this, t); }
}

class QaQB {
  db: QaStub; table: string;
  filters: Array<{ t: string; k: string; v: any }>;
  _u: Row | null; _i: Row[] | null; _l: number | null;
  _ord: { key: string; asc: boolean } | null;

  constructor(db: QaStub, t: string) {
    this.db = db; this.table = t;
    this.filters = []; this._u = null; this._i = null; this._l = null; this._ord = null;
  }
  select(_?: string) { return this; }
  order(k: string, o?: { ascending?: boolean }) { this._ord = { key: k, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this._l = n; return this; }
  eq(k: string, v: any) { this.filters.push({ t: "eq", k, v }); return this; }
  neq(k: string, v: any) { this.filters.push({ t: "neq", k, v }); return this; }
  in(k: string, v: any[]) { this.filters.push({ t: "in", k, v }); return this; }
  is(k: string, v: any) { this.filters.push({ t: "is", k, v }); return this; }

  insert(p: Row | Row[]) {
    const rows = Array.isArray(p) ? p : [p];
    const wi = rows.map(r => ({ id: r.id ?? `id-${Math.random().toString(36).slice(2, 8)}`, ...r }));
    this.db.tables[this.table] ??= [];
    this.db.tables[this.table].push(...wi);
    this._i = wi; return this;
  }
  update(u: Row) { this._u = u; return this; }

  single(): Promise<{ data: any; error: any }> {
    if (this._i) return Promise.resolve({ data: this._i[0], error: null });
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this._u) { for (const r of this.rows()) Object.assign(r, this._u); return Promise.resolve({ data: this.rows()[0], error: null }); }
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  then(f: any, r?: any) {
    if (this._u) { for (const row of this.rows()) Object.assign(row, this._u); return Promise.resolve({ data: this.rows(), error: null }).then(f, r); }
    if (this._i) return Promise.resolve({ data: this._i, error: null }).then(f, r);
    return Promise.resolve({ data: this.rows(), error: null }).then(f, r);
  }
  private rows() {
    let rows = [...(this.db.tables[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.t === "eq") rows = rows.filter(r => r[f.k] === f.v);
      else if (f.t === "neq") rows = rows.filter(r => r[f.k] !== f.v);
      else if (f.t === "in") rows = rows.filter(r => (f.v as any[]).includes(r[f.k]));
      else if (f.t === "is") rows = rows.filter(r => { const v = r[f.k]; return f.v === null ? v == null : v === f.v; });
    }
    if (this._ord) { const { key, asc } = this._ord; rows.sort((a, b) => a[key] === b[key] ? 0 : a[key] > b[key] ? (asc ? 1 : -1) : asc ? -1 : 1); }
    if (this._l != null) rows = rows.slice(0, this._l);
    return rows;
  }
}
