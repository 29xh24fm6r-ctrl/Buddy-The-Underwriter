/**
 * Pure-presentational table for ops drilldowns.
 *
 * Spec: SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.6.
 *
 * Columns: id, display name (NULL-safe), age (server-rendered), last
 * event action (NULL-safe), age in seconds. Empty state is explicit.
 *
 * Shared by uploads, packages, and the stuck-deals-by-origin diagnostic
 * page — restyling this one component in the ink/brass system covers
 * all three at once.
 */

import Link from "next/link";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export type StuckRow = {
  id: string;
  display_name: string | null;
  age_iso: string;
  age_seconds: number;
  last_event_action: string | null;
  detail_href?: string;
};

export function StuckTable({
  rows,
  emptyLabel,
}: {
  rows: StuckRow[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          background: c.card,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          padding: 24,
          textAlign: "center",
          color: c.textMuted,
          fontSize: 12,
        }}
      >
        {emptyLabel}
      </div>
    );
  }
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "90px 1fr 90px 1fr",
          padding: "9px 16px",
          borderBottom: `1px solid ${c.borderStrong}`,
          background: c.inkHeader,
          fontFamily: "var(--font-brokerage-mono)",
          fontSize: 9.5,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: c.textFaint,
        }}
      >
        <div>ID</div>
        <div>Display name</div>
        <div>Age</div>
        <div>Last event</div>
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            display: "grid",
            gridTemplateColumns: "90px 1fr 90px 1fr",
            padding: "10px 16px",
            borderBottom: `1px solid ${c.divider}`,
            alignItems: "center",
          }}
        >
          <div style={{ fontFamily: "var(--font-brokerage-mono)", fontSize: 11, color: c.brass }}>
            {r.detail_href ? (
              <Link href={r.detail_href} style={{ color: c.brass }}>
                {r.id.slice(0, 8)}
              </Link>
            ) : (
              r.id.slice(0, 8)
            )}
          </div>
          <div style={{ fontSize: 12, color: c.paper }}>{r.display_name ?? "—"}</div>
          <div style={{ fontSize: 11, color: c.textMuted, fontFamily: "var(--font-brokerage-mono)" }} title={r.age_iso}>
            {formatAge(r.age_seconds)}
          </div>
          <div style={{ fontSize: 11.5, color: c.textSecondary }}>{r.last_event_action ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
