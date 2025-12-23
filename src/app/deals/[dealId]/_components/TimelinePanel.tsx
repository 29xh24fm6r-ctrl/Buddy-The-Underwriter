export function TimelinePanel({ ctx }: { ctx: any }) {
  const timeline = (ctx?.deal_timeline_events ?? []) as any[];
  const condEvents = (ctx?.deal_condition_events ?? []) as any[];
  const uploadEvents = (ctx?.borrower_upload_events ?? []) as any[];

  const combined = [
    ...timeline.map((e) => ({ kind: "Timeline", ts: e.created_at ?? e.created ?? null, e })),
    ...condEvents.map((e) => ({ kind: "Condition", ts: e.created_at ?? e.created ?? null, e })),
    ...uploadEvents.map((e) => ({ kind: "Upload", ts: e.created_at ?? e.created ?? null, e })),
  ]
    .sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")))
    .slice(0, 20);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="text-lg font-semibold text-white">Timeline</div>
      <div className="text-sm text-white/60">Latest activity</div>

      <div className="mt-4 space-y-2">
        {combined.length === 0 ? (
          <div className="text-sm text-white/50">No events</div>
        ) : (
          combined.map((x, i) => (
            <div key={i} className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-sm text-white">
                {x.kind}: {x.e.type ?? x.e.event_type ?? x.e.action ?? "event"}
              </div>
              <div className="mt-1 text-xs text-white/60">
                {x.ts ? new Date(x.ts).toLocaleString() : "—"}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
