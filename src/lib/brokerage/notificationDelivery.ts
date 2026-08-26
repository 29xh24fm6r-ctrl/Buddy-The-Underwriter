/**
 * BRK-10M Notification Delivery — multi-channel alert delivery.
 */
import { type Alert, type AlertSeverity } from "@/lib/brokerage/alerting";

export type NotificationChannel = "email" | "slack" | "dashboard";
export type OutboxEntry = {
  id: string;
  alertId: string | null;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  error: string | null;
};
export type SendAdapter = (entry: OutboxEntry) => Promise<{ ok: boolean; error?: string }>;
export type NotificationCycleResult = { queued: number; sent: number; failed: number; skipped: number };

type Row = Record<string, any>;
type SB = { from: (t: string) => any };
type QueryError = { message?: string } | null | undefined;

const SENS = /token_hash|rawToken|raw_token|service_role_key|password|secret/gi;
const COOL_MS = 4 * 3_600_000;
const SEND_LEASE_MS = 5 * 60_000;
const PAGE_SIZE = 500;

function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }
function strip(t: string): string { return t.replace(SENS, "[REDACTED]"); }
function dbMessage(error: QueryError): string { return strip(str(error?.message) ?? "database_error"); }
function assertDbOk(error: QueryError, operation: string): void {
  if (error) throw new Error(`[notification-delivery] ${operation}: ${dbMessage(error)}`);
}

function referencedAlertIds(row: Row): string[] {
  const metadataIds = Array.isArray(row.metadata?.alert_ids) ? row.metadata.alert_ids.map(String) : [];
  const primary = str(row.alert_id);
  return primary ? [primary, ...metadataIds] : metadataIds;
}

export function shouldNotifySubscription(alert: Alert, sub: Row, outbox: Row[]): boolean {
  if (!sub.active || alert.status !== "active") return false;
  const severityFilter = str(sub.severity_filter) ?? "critical";
  if (severityFilter === "critical" && alert.severity !== "critical") return false;
  if (severityFilter === "warning" && alert.severity === "info") return false;
  return !outbox.find(row => {
    if (!["pending", "sent"].includes(str(row.status) ?? "")) return false;
    if (str(sub.id) && str(row.subscription_id) && str(sub.id) !== str(row.subscription_id)) return false;
    if (str(sub.channel) && str(row.channel) && str(sub.channel) !== str(row.channel)) return false;
    const createdAt = str(row.created_at);
    if (!createdAt || Date.now() - new Date(createdAt).getTime() >= COOL_MS) return false;
    return referencedAlertIds(row).includes(alert.id);
  });
}

export function buildEmailDigest(alerts: Alert[]): { subject: string; body: string } {
  const critical = alerts.filter(a => a.severity === "critical");
  const warnings = alerts.filter(a => a.severity === "warning");
  const subject = critical.length > 0 ? `[CRITICAL] Buddy: ${critical.length} critical alert(s)` : `Buddy: ${warnings.length} warning(s)`;
  const lines = ["Buddy Alert Digest", ""];
  if (critical.length > 0) {
    lines.push("CRITICAL:");
    for (const alert of critical) lines.push(`  - ${alert.title} → ${alert.action}`);
    lines.push("");
  }
  if (warnings.length > 0) {
    lines.push("WARNINGS:");
    for (const alert of warnings.slice(0, 10)) lines.push(`  - ${alert.title}`);
  }
  return { subject, body: strip(lines.join("\n")) };
}

export function buildSlackDigest(alerts: Alert[]): { body: string } {
  const critical = alerts.filter(a => a.severity === "critical");
  const warnings = alerts.filter(a => a.severity === "warning");
  const parts: string[] = [];
  if (critical.length > 0) {
    parts.push(`*${critical.length} Critical*`);
    for (const alert of critical.slice(0, 5)) parts.push(`> ${alert.title}`);
  }
  if (warnings.length > 0) parts.push(`${warnings.length} Warning(s)`);
  if (parts.length === 0) parts.push("All clear");
  return { body: strip(parts.join("\n")) };
}

async function readPages(makeQuery: (from: number, to: number) => any, operation: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1);
    assertDbOk(error, operation);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function buildNotificationOutbox(sb: SB): Promise<{ queued: number }> {
  const [alertRows, subscriptions, existing] = await Promise.all([
    readPages((from, to) => sb.from("brokerage_alerts")
      .select("id, alert_key, source, severity, status, deal_id, title, message, action, first_seen_at, last_seen_at, occurrence_count")
      .eq("status", "active").order("id", { ascending: true }).range(from, to), "alerts_read"),
    readPages((from, to) => sb.from("brokerage_alert_subscriptions")
      .select("id, subscriber_email, severity_filter, channel, active")
      .eq("active", true).order("id", { ascending: true }).range(from, to), "subscriptions_read"),
    readPages((from, to) => sb.from("brokerage_notification_outbox")
      .select("id, alert_id, subscription_id, channel, status, metadata, created_at")
      .in("status", ["pending", "sent"]).order("id", { ascending: true }).range(from, to), "cooldown_read"),
  ]);
  const alerts: Alert[] = alertRows.map(row => ({
    id: String(row.id),
    alertKey: str(row.alert_key) ?? "",
    source: str(row.source) ?? "",
    severity: (str(row.severity) ?? "warning") as AlertSeverity,
    status: "active",
    dealId: str(row.deal_id),
    title: str(row.title) ?? "",
    message: str(row.message) ?? "",
    action: str(row.action) ?? "",
    firstSeenAt: str(row.first_seen_at) ?? "",
    lastSeenAt: str(row.last_seen_at) ?? "",
    occurrenceCount: row.occurrence_count ?? 1,
  }));
  let queued = 0;
  for (const sub of subscriptions) {
    const channel = str(sub.channel) as NotificationChannel;
    const recipient = str(sub.subscriber_email);
    if (!recipient || !["email", "slack", "dashboard"].includes(channel)) continue;
    const eligible = alerts.filter(alert => shouldNotifySubscription(alert, sub, existing));
    if (eligible.length === 0) continue;
    if (channel === "dashboard") {
      for (const alert of eligible) {
        const createdAt = now();
        const payload = { alert_id: alert.id, subscription_id: sub.id, channel, recipient, subject: alert.title, body: strip(`${alert.message} → ${alert.action}`), status: "sent", sent_at: createdAt, created_at: createdAt, metadata: { alert_ids: [alert.id] } };
        const { data, error } = await sb.from("brokerage_notification_outbox").insert(payload).select("id").single();
        assertDbOk(error, "dashboard_insert");
        if (!data) throw new Error("[notification-delivery] dashboard_insert: row_missing");
        existing.push({ ...payload, id: data.id });
        queued++;
      }
      continue;
    }
    const digest = channel === "email" ? buildEmailDigest(eligible) : { subject: null, ...buildSlackDigest(eligible) };
    const createdAt = now();
    const payload = { alert_id: eligible[0].id, subscription_id: sub.id, channel, recipient, subject: digest.subject, body: strip(digest.body), status: "pending", created_at: createdAt, metadata: { alert_ids: eligible.map(alert => alert.id) } };
    const { data, error } = await sb.from("brokerage_notification_outbox").insert(payload).select("id").single();
    assertDbOk(error, "outbox_insert");
    if (!data) throw new Error("[notification-delivery] outbox_insert: row_missing");
    existing.push({ ...payload, id: data.id });
    queued++;
  }
  return { queued };
}

export async function markNotificationSent(id: string, sb: SB): Promise<void> {
  const { data, error } = await sb.from("brokerage_notification_outbox").update({ status: "sent", sent_at: now(), error: null }).eq("id", id).select("id").maybeSingle();
  assertDbOk(error, "mark_sent");
  if (!data) throw new Error("[notification-delivery] mark_sent: row_missing");
}

export async function markNotificationFailed(id: string, errorText: string, sb: SB): Promise<void> {
  const { data: current, error: readError } = await sb.from("brokerage_notification_outbox").select("attempts").eq("id", id).maybeSingle();
  assertDbOk(readError, "failure_read");
  if (!current) throw new Error("[notification-delivery] failure_read: row_missing");
  const { data, error } = await sb.from("brokerage_notification_outbox").update({ status: "failed", error: strip(errorText), attempts: Number(current.attempts ?? 0) + 1, last_attempt_at: now() }).eq("id", id).select("id").maybeSingle();
  assertDbOk(error, "mark_failed");
  if (!data) throw new Error("[notification-delivery] mark_failed: row_missing");
}

async function claimNotification(id: string, sb: SB): Promise<Row | null> {
  const { data: current, error } = await sb.from("brokerage_notification_outbox")
    .select("id, alert_id, channel, recipient, subject, body, status, attempts, last_attempt_at, error")
    .eq("id", id).maybeSingle();
  assertDbOk(error, "claim_read");
  if (!current || str(current.status) !== "pending") return null;
  const observedLease = str(current.last_attempt_at);
  if (observedLease && Date.now() - new Date(observedLease).getTime() < SEND_LEASE_MS) return null;
  const attempts = Number(current.attempts ?? 0);
  const lease = now();
  let query = sb.from("brokerage_notification_outbox").update({ attempts: attempts + 1, last_attempt_at: lease, error: null })
    .eq("id", id).eq("status", "pending").eq("attempts", attempts);
  query = observedLease ? query.eq("last_attempt_at", observedLease) : query.is("last_attempt_at", null);
  const { data: claimed, error: claimError } = await query
    .select("id, alert_id, channel, recipient, subject, body, status, attempts, last_attempt_at, error").maybeSingle();
  assertDbOk(claimError, "claim_write");
  return claimed ?? null;
}

async function transitionClaim(id: string, attempts: number, lease: string | null, patch: Row, sb: SB, operation: string): Promise<void> {
  let query = sb.from("brokerage_notification_outbox").update(patch)
    .eq("id", id).eq("status", "pending").eq("attempts", attempts);
  query = lease ? query.eq("last_attempt_at", lease) : query.is("last_attempt_at", null);
  const { data, error } = await query.select("id").maybeSingle();
  assertDbOk(error, operation);
  if (!data) throw new Error(`[notification-delivery] ${operation}: claim_lost`);
}

async function listPendingNotifications(sb: SB): Promise<Row[]> {
  return readPages((from, to) => sb.from("brokerage_notification_outbox")
    .select("id, channel").eq("status", "pending").order("id", { ascending: true }).range(from, to), "pending_read");
}

export async function sendPendingNotifications(
  sb: SB,
  adapters: Partial<Record<NotificationChannel, SendAdapter>>,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const pending = await listPendingNotifications(sb);
  let sent = 0, failed = 0, skipped = 0;
  for (const candidate of pending) {
    const channel = str(candidate.channel) as NotificationChannel;
    const adapter = adapters[channel];
    if (!adapter && channel !== "dashboard") { skipped++; continue; }
    const row = await claimNotification(String(candidate.id), sb);
    if (!row) { skipped++; continue; }
    const attempts = Number(row.attempts ?? 1);
    const lease = str(row.last_attempt_at);
    if (channel === "dashboard") {
      await transitionClaim(String(row.id), attempts, lease, { status: "sent", sent_at: now(), error: null }, sb, "mark_dashboard_sent");
      sent++;
      continue;
    }
    const entry: OutboxEntry = {
      id: String(row.id),
      alertId: str(row.alert_id),
      channel,
      recipient: str(row.recipient) ?? "",
      subject: str(row.subject),
      body: str(row.body) ?? "",
      status: "pending",
      attempts,
      error: null,
    };
    let result: { ok: boolean; error?: string };
    try { result = await adapter!(entry); }
    catch { result = { ok: false, error: "provider_exception" }; }
    if (result.ok) {
      await transitionClaim(entry.id, attempts, lease, { status: "sent", sent_at: now(), error: null }, sb, "mark_sent");
      sent++;
    } else {
      await transitionClaim(entry.id, attempts, lease, { status: "failed", error: strip(str(result.error) ?? "send_failed") }, sb, "mark_failed");
      failed++;
    }
  }
  return { sent, failed, skipped };
}

export async function runBrokerageNotificationCycle(
  sb: SB,
  adapters?: Partial<Record<NotificationChannel, SendAdapter>>,
): Promise<NotificationCycleResult> {
  const { queued } = await buildNotificationOutbox(sb);
  const { sent, failed, skipped } = await sendPendingNotifications(sb, adapters ?? {});
  return { queued, sent, failed, skipped };
}
