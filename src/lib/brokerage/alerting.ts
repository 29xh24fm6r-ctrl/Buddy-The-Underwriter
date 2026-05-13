/**
 * BRK-10L Alerting — persistent deduplicated alerts from daily ops.
 */
import { type DailyOpsReport, type ActionItem } from "@/lib/brokerage/dailyOps";
export type AlertSeverity = "critical" | "warning" | "info";
export type Alert = { id: string; alertKey: string; source: string; severity: AlertSeverity; status: "active" | "resolved" | "suppressed"; dealId: string | null; title: string; message: string; action: string; firstSeenAt: string; lastSeenAt: string; occurrenceCount: number };
export type AlertDigest = { activeCritical: Alert[]; activeWarnings: Alert[]; resolvedSinceLastRun: Alert[]; newAlerts: Alert[]; digestText: string; generated: string };
export type AlertGenerationResult = { created: number; recurred: number; autoResolved: number; total: number };
type Row = Record<string, any>;
type SB = { from: (t: string) => any };
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function now(): string { return new Date().toISOString(); }
function akey(a: ActionItem): string { return (a.category + ":" + a.message.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60)) + (a.dealId ? `:${a.dealId}` : ""); }

export async function upsertAlert(alert: { alertKey: string; source: string; severity: AlertSeverity; dealId?: string; title: string; message: string; action: string; metadata?: Record<string, any> }, sb: SB): Promise<{ id: string; created: boolean }> {
  const { data: ex } = await sb.from("brokerage_alerts").select("id, occurrence_count").eq("alert_key", alert.alertKey).eq("status", "active").limit(1).maybeSingle();
  if (ex) { await sb.from("brokerage_alerts").update({ last_seen_at: now(), occurrence_count: (ex.occurrence_count ?? 1) + 1, message: alert.message, severity: alert.severity }).eq("id", ex.id); await sb.from("brokerage_alert_events").insert({ alert_id: ex.id, event_type: "recurred", actor_scope: "system", metadata: alert.metadata ?? {} }); return { id: String(ex.id), created: false }; }
  const { data: sup } = await sb.from("brokerage_alerts").select("id, suppressed_until").eq("alert_key", alert.alertKey).eq("status", "suppressed").limit(1).maybeSingle();
  if (sup) { const u = str(sup.suppressed_until); if (u && new Date(u).getTime() > Date.now()) return { id: String(sup.id), created: false }; await sb.from("brokerage_alerts").update({ status: "active", last_seen_at: now(), occurrence_count: 1 }).eq("id", sup.id); return { id: String(sup.id), created: false }; }
  const { data: ins } = await sb.from("brokerage_alerts").insert({ alert_key: alert.alertKey, source: alert.source, severity: alert.severity, status: "active", deal_id: alert.dealId ?? null, title: alert.title, message: alert.message, action: alert.action, metadata: alert.metadata ?? {} }).select("id").single();
  const id = String(ins?.id ?? ""); await sb.from("brokerage_alert_events").insert({ alert_id: id, event_type: "created", actor_scope: "system", metadata: alert.metadata ?? {} });
  return { id, created: true };
}

export async function resolveAlert(alertId: string, actor?: { scope?: string }, sb?: SB): Promise<void> { if (!sb) return; await sb.from("brokerage_alerts").update({ status: "resolved", resolved_at: now() }).eq("id", alertId); await sb.from("brokerage_alert_events").insert({ alert_id: alertId, event_type: "resolved", actor_scope: actor?.scope ?? "system" }); }
export async function suppressAlert(alertId: string, durationHours: number, actor?: { scope?: string }, sb?: SB): Promise<void> { if (!sb) return; const until = new Date(Date.now() + durationHours * 3_600_000).toISOString(); await sb.from("brokerage_alerts").update({ status: "suppressed", suppressed_at: now(), suppressed_until: until }).eq("id", alertId); await sb.from("brokerage_alert_events").insert({ alert_id: alertId, event_type: "suppressed", actor_scope: actor?.scope ?? "brokerage_ops", metadata: { duration_hours: durationHours, until } }); }

export async function listActiveAlerts(sb: SB, opts?: { severity?: AlertSeverity }): Promise<Alert[]> {
  let q = sb.from("brokerage_alerts").select("id, alert_key, source, severity, status, deal_id, title, message, action, first_seen_at, last_seen_at, occurrence_count").eq("status", "active");
  if (opts?.severity) q = q.eq("severity", opts.severity);
  const { data } = await q.order("severity", { ascending: true });
  return ((data ?? []) as Row[]).map(r => ({ id: String(r.id), alertKey: str(r.alert_key) ?? "", source: str(r.source) ?? "", severity: (str(r.severity) ?? "warning") as AlertSeverity, status: "active" as const, dealId: str(r.deal_id), title: str(r.title) ?? "", message: str(r.message) ?? "", action: str(r.action) ?? "", firstSeenAt: str(r.first_seen_at) ?? "", lastSeenAt: str(r.last_seen_at) ?? "", occurrenceCount: r.occurrence_count ?? 1 }));
}

export async function generateBrokerageAlerts(report: DailyOpsReport, sb: SB): Promise<AlertGenerationResult> {
  let created = 0, recurred = 0;
  for (const a of report.criticalActions) { const r = await upsertAlert({ alertKey: akey(a), source: `daily_ops:${a.category}`, severity: "critical", dealId: a.dealId, title: a.message, message: a.message, action: a.action, metadata: { category: a.category, date: report.date } }, sb); if (r.created) created++; else recurred++; }
  for (const a of report.followups) { const r = await upsertAlert({ alertKey: akey(a), source: `daily_ops:${a.category}`, severity: "warning", dealId: a.dealId, title: a.message, message: a.message, action: a.action, metadata: { category: a.category, date: report.date } }, sb); if (r.created) created++; else recurred++; }
  const active = await listActiveAlerts(sb); const keys = new Set([...report.criticalActions.map(akey), ...report.followups.map(akey)]); let ar = 0;
  for (const al of active) { if (!keys.has(al.alertKey)) { await resolveAlert(al.id, { scope: "system" }, sb); ar++; } }
  return { created, recurred, autoResolved: ar, total: created + recurred };
}

export async function buildAlertDigest(sb: SB): Promise<AlertDigest> {
  const active = await listActiveAlerts(sb); const crit = active.filter(a => a.severity === "critical"); const warn = active.filter(a => a.severity === "warning");
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data: rr } = await sb.from("brokerage_alerts").select("id, alert_key, source, severity, status, deal_id, title, message, action, first_seen_at, last_seen_at, occurrence_count, resolved_at").eq("status", "resolved").order("resolved_at", { ascending: false }).limit(20);
  const resolved = ((rr ?? []) as Row[]).filter(r => str(r.resolved_at) && str(r.resolved_at)! >= since).map(r => ({ id: String(r.id), alertKey: str(r.alert_key) ?? "", source: str(r.source) ?? "", severity: (str(r.severity) ?? "warning") as AlertSeverity, status: "resolved" as const, dealId: str(r.deal_id), title: str(r.title) ?? "", message: str(r.message) ?? "", action: str(r.action) ?? "", firstSeenAt: str(r.first_seen_at) ?? "", lastSeenAt: str(r.last_seen_at) ?? "", occurrenceCount: r.occurrence_count ?? 1 }));
  const na = active.filter(a => a.firstSeenAt >= since);
  const lines: string[] = []; if (crit.length > 0) { lines.push(`CRITICAL (${crit.length}):`); for (const a of crit) lines.push(`  !! ${a.title}`); } if (warn.length > 0) { lines.push(`WARNINGS (${warn.length}):`); } if (resolved.length > 0) lines.push(`RESOLVED (${resolved.length})`); if (lines.length === 0) lines.push("No active alerts.");
  return { activeCritical: crit, activeWarnings: warn, resolvedSinceLastRun: resolved, newAlerts: na, digestText: lines.join("\n"), generated: now() };
}
