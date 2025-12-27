import Link from "next/link";
import { askCommitteeAction } from "../../_actions/committeeActions";
import { getThread } from "./_components/committeeStore";
import type { EvidenceRef } from "@/lib/evidence/types";
import { evidenceUrl } from "@/lib/evidence/url";

function CitationRow({ dealId, citations }: { dealId: string; citations: EvidenceRef[] }) {
  if (!citations?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {citations.slice(0, 6).map((c, i) => (
        <Link
          key={i}
          href={evidenceUrl(dealId, c)}
          className="inline-flex items-center gap-2 rounded-full border border-border-dark bg-[#0b0d10] px-2 py-1 text-[11px] text-muted-foreground hover:bg-[#121622]"
        >
          <span className="material-symbols-outlined text-[14px]">verified</span>
          {c.label ?? c.sourceId}
          {c.page ? <span>· p.{c.page}</span> : null}
          <span className="material-symbols-outlined text-[14px] opacity-70">open_in_new</span>
        </Link>
      ))}
    </div>
  );
}

export default async function DealCommitteePage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const thread = getThread(dealId);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Credit Committee Mode</div>
          <div className="text-sm text-muted-foreground">
            Ask "why", "what changed", "show the evidence" — answers come with clickable citations.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link className="rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]" href={`/deals/${dealId}/risk`}>
            Risk
          </Link>
          <Link className="rounded-lg border border-border-dark bg-[#0f1115] px-3 py-1.5 text-sm hover:bg-[#121622]" href={`/deals/${dealId}/memo`}>
            Memo
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-border-dark bg-[#0b0d10] p-4">
        <div className="space-y-3">
          {thread.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Try:
              <div className="mt-2 flex flex-wrap gap-2">
                <Preset dealId={dealId} text="Why is the risk premium +200 bps?" />
                <Preset dealId={dealId} text="What is the biggest risk and how do we mitigate it?" />
                <Preset dealId={dealId} text="Show me the evidence behind revenue volatility." />
              </div>
            </div>
          ) : (
            thread.map((m, i) => (
              <div key={i} className="rounded-xl border border-border-dark bg-[#0f1115] p-3">
                <div className="text-xs font-semibold text-muted-foreground">{m.role === "user" ? "You" : "Buddy (AI)"}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{m.content}</div>
                {"citations" in m ? <CitationRow dealId={dealId} citations={m.citations} /> : null}
                {"followups" in m && m.followups?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.followups.slice(0, 3).map((f, j) => (
                      <form key={j} action={async () => { "use server"; await askCommitteeAction(dealId, f); }}>
                        <button className="rounded-full border border-border-dark bg-[#0b0d10] px-2 py-1 text-[11px] text-muted-foreground hover:bg-[#121622]">
                          {f}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="mt-4 border-t border-border-dark pt-4">
          <form
            className="flex gap-2"
            action={async (fd: FormData) => {
              "use server";
              const q = String(fd.get("q") ?? "").trim();
              if (!q) return;
              await askCommitteeAction(dealId, q);
            }}
          >
            <input
              name="q"
              placeholder="Ask a committee question…"
              className="flex-1 rounded-lg border border-border-dark bg-[#0f1115] px-3 py-2 text-sm text-white placeholder:text-muted-foreground"
            />
            <button className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90">
              Ask
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Preset({ dealId, text }: { dealId: string; text: string }) {
  return (
    <form action={async () => { "use server"; await askCommitteeAction(dealId, text); }}>
      <button className="rounded-full border border-border-dark bg-[#0f1115] px-2 py-1 text-[11px] text-muted-foreground hover:bg-[#121622]">
        {text}
      </button>
    </form>
  );
}
