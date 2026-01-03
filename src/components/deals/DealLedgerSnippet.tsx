import { relativeTime } from "@/lib/ui/timeAgo";

type LedgerEvent = {
  id: string;
  stage?: string | null;
  status?: string | null;
  created_at: string;
};

export function DealLedgerSnippet({
  latestEvent,
}: {
  latestEvent?: LedgerEvent | null;
}) {
  if (!latestEvent) return null;

  const when = relativeTime(latestEvent.created_at);
  const stage = latestEvent.stage ?? "System";
  const status = latestEvent.status ?? "updated";

  return (
    <div className="mt-3 text-xs text-slate-500">
      <span className="font-medium text-slate-600">{stage}</span>{" "}
      {status} · {when}
    </div>
  );
}
