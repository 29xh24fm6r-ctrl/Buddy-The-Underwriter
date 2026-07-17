"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";

/**
 * Brokerage command center — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR5 §7.6.
 *
 * Deliberately a separate page/component from BrokerageOwnerCommandCenter
 * (/admin/brokerage-owner) -- that surface's own test suite forbids
 * forecast/revenue language since it's scoped to non-predictive
 * operational visibility. This page is explicitly the forecasting +
 * revenue + explainable-alerts surface the spec calls for.
 */

function centsToDollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function PanelCard({ title, items, renderItem, emptyLabel, href }: { title: string; items: any[]; renderItem: (item: any) => string; emptyLabel?: string; href?: string }) {
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: c.paper }}>{title}</span>
        <span style={{ fontSize: 11, color: c.textMuted }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11.5, color: c.textMuted }}>{emptyLabel ?? "Nothing here."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {items.slice(0, 6).map((item, i) => (
            <div key={i} style={{ fontSize: 11.5, color: c.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {renderItem(item)}
            </div>
          ))}
          {items.length > 6 && <div style={{ fontSize: 10.5, color: c.textMuted }}>+{items.length - 6} more</div>}
        </div>
      )}
      {href && (
        <Link href={href} style={{ fontSize: 10.5, color: c.brassBright, marginTop: 8, display: "inline-block" }}>
          View all →
        </Link>
      )}
    </div>
  );
}

const SEVERITY_COLOR: Record<string, string> = { critical: c.brick, high: "#c98a4b", medium: c.brassBright, low: c.textMuted };

export default function CommandCenterPage() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAlertKey, setBusyAlertKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brokerage/command-center", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "load failed");
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function actOnAlert(alert: any, state: "dismissed" | "snoozed", reason: string) {
    setBusyAlertKey(`${alert.entityType}:${alert.entityId}:${alert.alertKey}`);
    try {
      const snoozeUntilIso = state === "snoozed" ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() : undefined;
      await fetch("/api/admin/brokerage/crm/intelligence/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", entityType: alert.entityType, entityId: alert.entityId, alertKey: alert.alertKey, state, reason, snoozeUntilIso }),
      });
      await load();
    } finally {
      setBusyAlertKey(null);
    }
  }

  if (loading && !data) return <div style={{ padding: 24, fontSize: 12, color: c.textMuted }}>Loading command center…</div>;
  if (error) return <div style={{ padding: 24, fontSize: 12, color: c.brick }}>{error}</div>;
  if (!data) return null;

  const p = data.panels;
  const forecast = data.pipelineForecast;
  const revenue = data.revenueForecast;

  return (
    <div style={{ padding: "18px 24px 48px" }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: c.paper, marginBottom: 4 }}>Command Center</h1>
      <p style={{ fontSize: 11.5, color: c.textMuted, marginBottom: 20 }}>What needs attention today across leads, deals, referral relationships, and revenue.</p>

      {/* Critical alerts — explainable intelligence, spec 7.7 */}
      <section style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: c.paper, marginBottom: 8 }}>Critical alerts ({p.criticalAlerts.length})</div>
        {p.criticalAlerts.length === 0 ? (
          <div style={{ fontSize: 11.5, color: c.textMuted }}>No open alerts.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {p.criticalAlerts.map((a: any) => {
              const key = `${a.entityType}:${a.entityId}:${a.alertKey}`;
              return (
                <div key={key} style={{ background: c.card, border: `1px solid ${c.border}`, borderLeft: `3px solid ${SEVERITY_COLOR[a.severity] ?? c.border}`, borderRadius: 6, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 12, color: c.paper, fontWeight: 500 }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: c.textSecondary, marginTop: 2 }}>{a.recommendation}</div>
                      <div style={{ fontSize: 10, color: c.textMuted, marginTop: 4 }}>
                        {a.evidence.join(" · ")} — rule: {a.sourceRule}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                      {a.actionRoute && (
                        <Link href={a.actionRoute} style={{ fontSize: 10.5, color: c.brassBright }}>
                          Open →
                        </Link>
                      )}
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          disabled={busyAlertKey === key}
                          onClick={() => void actOnAlert(a, "snoozed", "snoozed from command center")}
                          style={{ fontSize: 10, color: c.textSecondary, background: "transparent", border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
                        >
                          Snooze 1d
                        </button>
                        <button
                          disabled={busyAlertKey === key}
                          onClick={() => {
                            const reason = window.prompt("Reason for dismissing this alert?");
                            if (reason) void actOnAlert(a, "dismissed", reason);
                          }}
                          style={{ fontSize: 10, color: c.textSecondary, background: "transparent", border: `1px solid ${c.border}`, borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Pipeline + revenue forecast — spec 7.5 */}
      <section style={{ marginBottom: 22, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {[
          { label: "Best case volume", value: centsToDollars(forecast.bestCaseLoanVolumeCents) },
          { label: "Expected volume", value: centsToDollars(forecast.expectedLoanVolumeCents) },
          { label: "Committed volume", value: centsToDollars(forecast.committedLoanVolumeCents) },
          { label: "Expected gross revenue", value: centsToDollars(revenue.expectedGrossRevenueCents) },
        ].map((s) => (
          <div key={s.label} style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 10.5, color: c.textMuted }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: c.paper, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
        <div style={{ gridColumn: "1 / -1", fontSize: 10, color: c.textMuted }}>
          Assumptions: fee rate {revenue.assumptions.feeRateBpsUsed} bps · committed stages: {revenue.assumptions.committedStages.join(", ")}
        </div>
      </section>

      {/* Operational queues — spec 7.6 panel list */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <PanelCard title="New leads needing contact" items={p.newLeadsNeedingContact} renderItem={(i) => i.business_name ?? i.first_name ?? i.id} href="/admin/brokerage/crm/leads" />
        <PanelCard title="Overdue lead follow-ups" items={p.overdueLeadFollowUps} renderItem={(i) => i.business_name ?? i.first_name ?? i.id} href="/admin/brokerage/crm/leads" />
        <PanelCard title="Qualified, awaiting conversion" items={p.qualifiedLeadsAwaitingConversion} renderItem={(i) => i.business_name ?? i.first_name ?? i.id} href="/admin/brokerage/crm/leads" />
        <PanelCard title="Deals with blockers" items={p.dealsWithBlockers} renderItem={(id) => String(id)} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Stalled deals" items={p.stalledDeals} renderItem={(i) => i.title ?? i.id} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Missing documents" items={p.missingDocuments} renderItem={(i) => i.title ?? i.id} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Ready for lender strategy" items={p.readyForLenderStrategy} renderItem={(i) => i.title ?? i.id} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Submitted, awaiting response" items={p.submittedAwaitingResponse} renderItem={(i) => i.title ?? i.id} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Outstanding conditions" items={p.outstandingConditions} renderItem={(i) => i.title ?? i.id} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Closings approaching" items={p.closingsApproaching} renderItem={(i) => i.title ?? i.id} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Funded, awaiting payment" items={p.fundedAwaitingPayment} renderItem={(i) => i.title ?? i.id} href="/admin/brokerage/pipeline/queues" />
        <PanelCard title="Referral relationships needing attention" items={p.referralRelationshipsNeedingAttention} renderItem={(i) => `${i.name} (${i.health})`} href="/admin/brokerage/crm" />
        <PanelCard title="Team workload" items={p.teamWorkload} renderItem={(i) => `${i.clerkUserId}: ${i.activeDealCount} active`} emptyLabel="No brokers assigned yet." />
        <PanelCard title="Recent wins" items={[...p.recentWins.leadsConverted, ...p.recentWins.dealsFunded]} renderItem={(i) => i.business_name ?? `deal ${i.deal_id}`} />
        <PanelCard title="Recent losses" items={[...p.recentLosses.leadsLost, ...p.recentLosses.dealsLost]} renderItem={(i) => i.business_name ?? i.lost_reason ?? i.reason ?? `deal ${i.deal_id}`} />
      </section>
    </div>
  );
}
