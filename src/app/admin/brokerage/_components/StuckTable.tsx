/**
 * Pure-presentational table for ops drilldowns.
 *
 * Spec: SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.6.
 *
 * Columns: id, display name (NULL-safe), age (server-rendered), last
 * event action (NULL-safe), age in seconds. Empty state is explicit.
 */

import Link from "next/link";

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
      <div className="rounded-md border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-500 text-sm">
        {emptyLabel}
      </div>
    );
  }
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left text-neutral-400 border-b border-neutral-800">
          <th className="py-2 pr-4">ID</th>
          <th className="py-2 pr-4">Display name</th>
          <th className="py-2 pr-4">Age</th>
          <th className="py-2 pr-4">Last event</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-neutral-900">
            <td className="py-2 pr-4 font-mono text-xs">
              {r.detail_href ? (
                <Link href={r.detail_href} className="underline">
                  {r.id.slice(0, 8)}
                </Link>
              ) : (
                r.id.slice(0, 8)
              )}
            </td>
            <td className="py-2 pr-4">{r.display_name ?? "—"}</td>
            <td className="py-2 pr-4 text-neutral-400" title={r.age_iso}>
              {formatAge(r.age_seconds)}
            </td>
            <td className="py-2 pr-4 text-neutral-400">
              {r.last_event_action ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
