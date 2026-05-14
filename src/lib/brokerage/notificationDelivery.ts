/**
 * BRK-10M Notification Delivery — multi-channel alert delivery.
 */
import { type Alert, type AlertSeverity, listActiveAlerts } from "@/lib/brokerage/alerting";
export type NotificationChannel = "email" | "slack" | "dashboard";
export type OutboxEntry = { id: string; alertId: string | null; channel: NotificationChannel; recipient: string; subject: string | null; body: string; status: "pending" | "sent" | "failed"; attempts: number; error: string | null };
export type SendAdapter = (entry: OutboxEntry) => Promise<{ ok: boolean; error?: string }>;
export type NotificationCycleResult = { queued: number; sent: number; failed: number; skipped: number };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }
const SENS = /token_hash|rawToken|raw_token|service_role_key|password|secret/gi;
function strip(t: string): string { return t.replace(SENS, "[REDACTED]"); }
const COOL_H = 4;

export function shouldNotifySubscription(alert: Alert, sub: Row, outbox: Row[]): boolean {
  if (!sub.active || alert.status !== "active") return false;
  const sf = str(sub.severity_filter) ?? "critical";
  if (sf === "critical" && alert.severity !== "critical") return false;
  if (sf === "warning" && alert.severity === "info") return false;
  return !outbox.find(o => String(o.alert_id) === alert.id && (str(o.status) === "pending" || str(o.status) === "sent") && str(o.created_at) && (Date.now() - new Date(str(o.created_at)!).getTime()) < COOL_H * 3_600_000);
}

export function buildEmailDigest(alerts: Alert[]): { subject: string; body: string } {
  const c = alerts.filter(a => a.severity === "critical"), w = alerts.filter(a => a.severity === "warning");
  const subject = c.length > 0 ? `[CRITICAL] Buddy: ${c.length} critical alert(s)` : `Buddy: ${w.length} warning(s)`;
  const lines = ["Buddy Alert Digest", ""];
  if (c.length > 0) { lines.push("CRITICAL:"); for (const a of c) lines.push(`  - ${a.title} → ${a.action}`); lines.push(""); }
  if (w.length > 0) { lines.push("WARNINGS:"); for (const a of w.slice(0, 10)) lines.push(`  - ${a.title}`); }
  return { subject, body: strip(lines.join("\n")) };
}

export function buildSlackDigest(alerts: Alert[]): { body: string } {
  const c = alerts.filter(a => a.severity === "critical"), w = alerts.filter(a => a.severity === "warning");
  const parts: string[] = [];
  if (c.length > 0) { parts.push(`*${c.length} Critical*`); for (const a of c.slice(0, 5)) parts.push(`> ${a.title}`); }
  if (w.length > 0) parts.push(`${w.length} Warning(s)`);
  if (parts.length === 0) parts.push("All clear");
  return { body: strip(parts.join("\n")) };
}

export async function buildNotificationOutbox(sb: SB): Promise<{ queued: number }> {
  const [{ data: ad }, { data: sd }, { data: od }] = await Promise.all([
    sb.from("brokerage_alerts").select("id, alert_key, source, severity, status, deal_id, title, message, action, first_seen_at, last_seen_at, occurrence_count").eq("status", "active"),
    sb.from("brokerage_alert_subscriptions").select("id, subscriber_email, severity_filter, channel, active").eq("active", true),
    sb.from("brokerage_notification_outbox").select("id, alert_id, status, created_at").in("status", ["pending", "sent"]),
  ]);
  const alerts: Alert[] = ((ad ?? []) as Row[]).map(r => ({ id: String(r.id), alertKey: str(r.alert_key) ?? "", source: str(r.source) ?? "", severity: (str(r.severity) ?? "warning") as AlertSeverity, status: "active" as const, dealId: str(r.deal_id), title: str(r.title) ?? "", message: str(r.message) ?? "", action: str(r.action) ?? "", firstSeenAt: str(r.first_seen_at) ?? "", lastSeenAt: str(r.last_seen_at) ?? "", occurrenceCount: r.occurrence_count ?? 1 }));
  const subs = (sd ?? []) as Row[], outbox = (od ?? []) as Row[];
  let queued = 0;
  for (const sub of subs) {
    const ch = str(sub.channel) as NotificationChannel;
    if (ch === "email" || ch === "slack") { const eligible = alerts.filter(a => shouldNotifySubscription(a, sub, outbox)); if (eligible.length === 0) continue; const { subject, body } = ch === "email" ? buildEmailDigest(eligible) : { subject: null, ...buildSlackDigest(eligible) }; await sb.from("brokerage_notification_outbox").insert({ alert_id: eligible[0]?.id ?? null, subscription_id: sub.id, channel: ch, recipient: String(sub.subscriber_email), subject, body: strip(body), status: "pending" }); queued++; }
    if (ch === "dashboard") { for (const a of alerts) { if (!shouldNotifySubscription(a, sub, outbox)) continue; await sb.from("brokerage_notification_outbox").insert({ alert_id: a.id, subscription_id: sub.id, channel: "dashboard", recipient: String(sub.subscriber_email), subject: a.title, body: strip(`${a.message} → ${a.action}`), status: "sent", sent_at: now() }); queued++; } }
  }
  return { queued };
}

export async function markNotificationSent(id: string, sb: SB): Promise<void> { await sb.from("brokerage_notification_outbox").update({ status: "sent", sent_at: now() }).eq("id", id); }
export async function markNotificationFailed(id: string, error: string, sb: SB): Promise<void> { const { data } = await sb.from("brokerage_notification_outbox").select("attempts").eq("id", id).maybeSingle(); await sb.from("brokerage_notification_outbox").update({ status: "failed", error, attempts: ((data?.attempts ?? 0) as number) + 1, last_attempt_at: now() }).eq("id", id); }

export async function sendPendingNotifications(sb: SB, adapters: Partial<Record<NotificationChannel, SendAdapter>>): Promise<{ sent: number; failed: number }> {
  const { data } = await sb.from("brokerage_notification_outbox").select("id, channel, recipient, subject, body, status, attempts").eq("status", "pending");
  let sent = 0, failed = 0;
  for (const row of (data ?? []) as Row[]) { const ch = str(row.channel) as NotificationChannel; const adapter = adapters[ch]; if (!adapter) { if (ch === "dashboard") { await markNotificationSent(String(row.id), sb); sent++; } continue; } const entry: OutboxEntry = { id: String(row.id), alertId: null, channel: ch, recipient: str(row.recipient) ?? "", subject: str(row.subject), body: str(row.body) ?? "", status: "pending", attempts: row.attempts ?? 0, error: null }; const r = await adapter(entry); if (r.ok) { await markNotificationSent(entry.id, sb); sent++; } else { await markNotificationFailed(entry.id, r.error ?? "send_failed", sb); failed++; } }
  return { sent, failed };
}

export async function runBrokerageNotificationCycle(sb: SB, adapters?: Partial<Record<NotificationChannel, SendAdapter>>): Promise<NotificationCycleResult> { const { queued } = await buildNotificationOutbox(sb); const { sent, failed } = await sendPendingNotifications(sb, adapters ?? {}); return { queued, sent, failed, skipped: queued - sent - failed }; }
