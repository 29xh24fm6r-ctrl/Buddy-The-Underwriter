/**
 * Phase 13A — Deal Timeline Event Unification
 *
 * Read-only aggregation of document, readiness, comms, and banker-action
 * events into one timeline view. No writes, no schema changes.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type TimelineCategory = "document" | "readiness" | "comms" | "banker_action" | "system";
export type TimelineActorType = "borrower" | "banker" | "system" | "provider";
export type TimelineSeverity = "info" | "success" | "warning" | "error";

export type TimelineEvent = {
  id: string;
  dealId: string;
  timestamp: string;
  category: TimelineCategory;
  title: string;
  description: string;
  actorType: TimelineActorType;
  severity: TimelineSeverity;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadataSafe: Record<string, unknown>;
};

export type TimelineDayGroup = {
  date: string; // YYYY-MM-DD
  events: TimelineEvent[];
};

export type TimelineOptions = {
  limit?: number;
  categories?: TimelineCategory[];
  newestFirst?: boolean;
};

type Row = Record<string, any>;
type SB = { from: (t: string) => any };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ── Masking / redaction ────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return "***@***";
  const local = parts[0];
  const domain = parts[1];
  const masked = local.length <= 2
    ? "*".repeat(local.length)
    : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return "*".repeat(phone.length - 4) + phone.slice(-4);
}

function maskRecipientValue(value: string): string {
  if (value.includes("@")) return maskEmail(value);
  if (/^\+?\d{7,}$/.test(value)) return maskPhone(value);
  return value;
}

const SECRET_PATTERN = /re_[A-Za-z0-9_-]{10,}|KEY[A-Za-z0-9_-]{20,}|Bearer\s+\S+|https:\/\/hooks\.slack\.com\/\S+/gi;

function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[REDACTED]");
}

function safeMeta(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  const json = JSON.stringify(raw);
  const cleaned = redactSecrets(json)
    .replace(/"(body|emailBody|smsBody|slackBody|message_body|rawToken|password|secret)":\s*"[^"]*"/g, '"$1":"[REDACTED]"');
  try { return JSON.parse(cleaned); } catch { return {}; }
}

// ── Normalizers ────────────────────────────────────────────────────────────

function normalizeTimelineEvent(source: string, row: Row, dealId: string): TimelineEvent | null {
  if (source === "deal_events") return normalizeDealEvent(row, dealId);
  if (source === "deal_pipeline_ledger") return normalizePipelineEvent(row, dealId);
  if (source === "deal_timeline_events") return normalizeTimelineEventRow(row, dealId);
  if (source === "brokerage_comms_ledger") return normalizeCommsLedgerEvent(row, dealId);
  if (source === "brokerage_comms_outbox") return normalizeCommsOutboxEvent(row, dealId);
  return null;
}

function normalizeDealEvent(row: Row, dealId: string): TimelineEvent {
  const kind = str(row.kind) ?? "event";
  const payload = row.payload as Record<string, unknown> | null;

  let category: TimelineCategory = "system";
  let actorType: TimelineActorType = "system";
  let severity: TimelineSeverity = "info";
  let title = kind.replace(/[._]/g, " ");

  if (kind.startsWith("document.") || kind.startsWith("doc_")) {
    category = "document";
    actorType = payload?.source === "borrower" || kind.includes("borrower") ? "borrower" : "banker";
    if (kind.includes("uploaded")) { title = "Document uploaded"; severity = "success"; }
    else if (kind.includes("confirmed") || kind.includes("finalized")) { title = "Document confirmed"; severity = "success"; }
    else if (kind.includes("rejected") || kind.includes("failed")) { title = "Document processing failed"; severity = "error"; }
    else { title = kind.replace(/[._]/g, " "); }
  } else if (kind.includes("ready")) {
    category = "readiness";
    title = kind.includes("reverted") ? "Readiness reverted" : "Deal readiness updated";
    severity = kind.includes("reverted") ? "warning" : "success";
  } else if (kind.includes("intake") || kind.includes("classification")) {
    category = "system";
    title = kind.replace(/[._]/g, " ");
  }

  return {
    id: str(row.id) ?? `de-${row.created_at}`,
    dealId,
    timestamp: row.created_at ?? new Date().toISOString(),
    category,
    title,
    description: descriptionFromPayload(payload),
    actorType,
    severity,
    relatedEntityType: str(payload?.source_table as unknown) ?? null,
    relatedEntityId: str(payload?.document_id as unknown) ?? str(payload?.source_id as unknown) ?? null,
    metadataSafe: safeMeta(payload),
  };
}

function normalizePipelineEvent(row: Row, dealId: string): TimelineEvent {
  const stage = str(row.stage) ?? str(row.event_key) ?? "pipeline";
  const status = str(row.status) ?? "ok";
  const uiMessage = str(row.ui_message) ?? "";

  let severity: TimelineSeverity = "info";
  if (status === "error" || row.ui_state === "error") severity = "error";
  else if (status === "ok" || row.ui_state === "done") severity = "success";
  else if (row.ui_state === "working" || status === "pending") severity = "info";

  const title = uiMessage || stage.replace(/[._]/g, " ");

  return {
    id: str(row.id) ?? `pl-${row.created_at}`,
    dealId,
    timestamp: row.created_at ?? new Date().toISOString(),
    category: stage.includes("upload") ? "document" : "system",
    title: redactSecrets(title),
    description: "",
    actorType: "system",
    severity,
    relatedEntityType: null,
    relatedEntityId: null,
    metadataSafe: safeMeta(row.payload as Record<string, unknown>),
  };
}

function normalizeTimelineEventRow(row: Row, dealId: string): TimelineEvent {
  const kind = str(row.kind) ?? "timeline";
  return {
    id: str(row.id) ?? `tl-${row.created_at}`,
    dealId,
    timestamp: row.created_at ?? new Date().toISOString(),
    category: kind.includes("document") || kind.includes("upload") ? "document" : "banker_action",
    title: str(row.title) ?? kind,
    description: str(row.detail) ?? "",
    actorType: row.created_by ? "banker" : "system",
    severity: "info",
    relatedEntityType: null,
    relatedEntityId: null,
    metadataSafe: {},
  };
}

function normalizeCommsLedgerEvent(row: Row, dealId: string): TimelineEvent {
  const eventType = str(row.event_type) ?? "comms_event";
  const channel = str(row.channel) ?? "email";
  const recipientMasked = str(row.recipient_masked) ?? "n/a";
  const meta = row.metadata as Record<string, unknown> | null;

  let title = eventType.replace(/^brokerage_comms_/, "").replace(/^comms_lifecycle_hook_/, "lifecycle hook: ").replace(/_/g, " ");
  let severity: TimelineSeverity = "info";

  if (eventType.includes("succeeded") || eventType.includes("enqueued")) severity = "success";
  else if (eventType.includes("failed") || eventType.includes("exhausted")) severity = "error";
  else if (eventType.includes("retry") || eventType.includes("skipped")) severity = "warning";

  return {
    id: str(row.id) ?? `cl-${row.created_at}`,
    dealId,
    timestamp: row.created_at ?? new Date().toISOString(),
    category: "comms",
    title,
    description: `${channel}${recipientMasked !== "n/a" && recipientMasked !== "lifecycle_hook" && recipientMasked !== "orchestrator" ? ` to ${maskRecipientValue(recipientMasked)}` : ""}`,
    actorType: "system",
    severity,
    relatedEntityType: "comms_ledger",
    relatedEntityId: null,
    metadataSafe: safeMeta(meta),
  };
}

function normalizeCommsOutboxEvent(row: Row, dealId: string): TimelineEvent {
  const status = str(row.status) ?? "pending";
  const channel = str(row.channel) ?? "email";
  const triggerKey = str(row.trigger_key) ?? "unknown";
  const recipient = str(row.recipient) ?? "";

  let severity: TimelineSeverity = "info";
  let title = `Outbox: ${triggerKey.replace(/_/g, " ")} (${channel})`;

  if (status === "sent") severity = "success";
  else if (status === "failed" || status === "exhausted") severity = "error";
  else if (status === "retry_scheduled") severity = "warning";
  else if (status === "pending" || status === "sending") severity = "info";

  return {
    id: str(row.id) ?? `ob-${row.created_at}`,
    dealId,
    timestamp: row.created_at ?? new Date().toISOString(),
    category: "comms",
    title,
    description: `${status} — ${channel} to ${maskRecipientValue(recipient)}`,
    actorType: "provider",
    severity,
    relatedEntityType: "comms_outbox",
    relatedEntityId: str(row.id),
    metadataSafe: { trigger_key: triggerKey, channel, status, attempt_count: row.attempt_count ?? 0 },
  };
}

function descriptionFromPayload(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const filename = str(payload.original_filename as unknown);
  const reason = str(payload.reason as unknown) ?? str(payload.ready_reason as unknown);
  if (filename) return `File: ${filename}`;
  if (reason) return reason;
  return "";
}

// ── Public API ─────────────────────────────────────────────────────────────

export { normalizeTimelineEvent };

export async function getDealTimeline(
  dealId: string,
  sb: SB,
  opts?: TimelineOptions,
): Promise<TimelineEvent[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const newestFirst = opts?.newestFirst !== false;
  const fetchLimit = limit * 2; // overfetch for filtering

  // Parallel fetch from all sources
  const [dealEvents, pipelineEvents, timelineEvents, commsLedger, commsOutbox] = await Promise.all([
    sb.from("deal_events").select("id, deal_id, kind, payload, created_at").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(fetchLimit).then((r: any) => r.data ?? [], () => []),
    sb.from("deal_pipeline_ledger").select("id, deal_id, stage, status, payload, error, created_at, event_key, ui_state, ui_message").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(fetchLimit).then((r: any) => r.data ?? [], () => []),
    sb.from("deal_timeline_events").select("id, deal_id, kind, title, detail, created_by, created_at").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(fetchLimit).then((r: any) => r.data ?? [], () => []),
    sb.from("brokerage_comms_ledger").select("id, event_type, channel, deal_id, recipient_masked, metadata, created_at").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(fetchLimit).then((r: any) => r.data ?? [], () => []),
    sb.from("brokerage_comms_outbox").select("id, channel, status, recipient, trigger_key, deal_id, attempt_count, created_at").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(fetchLimit).then((r: any) => r.data ?? [], () => []),
  ]);

  const all: TimelineEvent[] = [];

  for (const row of dealEvents) { const e = normalizeTimelineEvent("deal_events", row, dealId); if (e) all.push(e); }
  for (const row of pipelineEvents) { const e = normalizeTimelineEvent("deal_pipeline_ledger", row, dealId); if (e) all.push(e); }
  for (const row of timelineEvents) { const e = normalizeTimelineEvent("deal_timeline_events", row, dealId); if (e) all.push(e); }
  for (const row of commsLedger) { const e = normalizeTimelineEvent("brokerage_comms_ledger", row, dealId); if (e) all.push(e); }
  for (const row of commsOutbox) { const e = normalizeTimelineEvent("brokerage_comms_outbox", row, dealId); if (e) all.push(e); }

  // Filter by category if specified
  let filtered = opts?.categories
    ? all.filter(e => opts.categories!.includes(e.category))
    : all;

  // Sort
  filtered.sort((a, b) => newestFirst
    ? b.timestamp.localeCompare(a.timestamp)
    : a.timestamp.localeCompare(b.timestamp));

  return filtered.slice(0, limit);
}

export function groupTimelineEventsByDay(events: TimelineEvent[]): TimelineDayGroup[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const date = e.timestamp.slice(0, 10); // YYYY-MM-DD
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(e);
  }
  const result: TimelineDayGroup[] = [];
  for (const [date, evts] of groups) {
    result.push({ date, events: evts });
  }
  // Sort day groups newest-first
  result.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}
