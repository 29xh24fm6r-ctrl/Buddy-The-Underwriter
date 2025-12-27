import Link from "next/link";
import { listMemoRuns } from "@/lib/db/server";
import { diffMemo } from "@/lib/diff/memoDiff";

export default async function DealMemoComparePage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const runs = await listMemoRuns(dealId);

  if (runs.length < 2) {
    return (
      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
        <div className="text-sm font-semibold">Not enough memo runs to compare</div>
        <div className="mt-2 text-sm text-muted-foreground">Generate the memo at least twice.</div>
        <div className="mt-3">
          <Link className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white" href={`/deals/${dealId}/memo`}>
            Back to Memo
          </Link>
        </div>
      </div>
    );
  }

  const [latest, prev] = runs;
  const a = prev.sections.map((s) => ({ sectionKey: s.section_key, title: s.title, content: s.content }));
  const b = latest.sections.map((s) => ({ sectionKey: s.section_key, title: s.title, content: s.content }));
  const d = diffMemo(a, b);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">What changed? (Memo)</div>
        <div className="text-sm text-muted-foreground">
          Comparing <span className="font-mono">{prev.run.id.slice(0, 8)}</span> → <span className="font-mono">{latest.run.id.slice(0, 8)}</span>
        </div>
      </div>

      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
        <div className="text-sm font-semibold">Section changes</div>
        <div className="mt-3 space-y-3">
          {d.map((x) => (
            <div key={x.sectionKey} className="rounded-xl border border-border-dark bg-[#0f1115] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{x.title}</div>
                <span className="rounded-full border border-border-dark bg-[#0b0d10] px-2 py-0.5 text-[11px] text-muted-foreground">
                  {x.status}
                </span>
              </div>

              {x.status === "changed" ? (
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-border-dark bg-[#0b0d10] p-3">
                    <div className="text-xs font-semibold text-muted-foreground">Before</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{x.from}</div>
                  </div>
                  <div className="rounded-lg border border-border-dark bg-[#0b0d10] p-3">
                    <div className="text-xs font-semibold text-muted-foreground">After</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{x.to}</div>
                  </div>
                </div>
              ) : x.status === "added" ? (
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{x.to}</div>
              ) : x.status === "removed" ? (
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{x.from}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Link className="rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]" href={`/deals/${dealId}/memo`}>
            Back to Memo
          </Link>
        </div>
      </div>
    </div>
  );
}
