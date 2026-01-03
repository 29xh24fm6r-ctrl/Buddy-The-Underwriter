import { relativeTime } from "@/lib/ui/timeAgo";

export function DealLedgerSnippet({
  latestEvent,
}: {
  latestEvent?: { created_at?: string | null; stage?: string | null; status?: string | null } | null;
}) {
  if (!latestEvent) return null;

  const rt = latestEvent.created_at ? relativeTime(latestEvent.created_at) : null;
  const stage = latestEvent.stage ?? "system";
  const status = latestEvent.status ?? "";

  return (
    <div className="mt-2 text-xs text-slate-500">
      {rt ? `${rt} · ` : ""}
      {stage} {status}
    </div>
  );
}
