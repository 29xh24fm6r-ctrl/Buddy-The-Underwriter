import { generateMemoAction } from "../../_actions/aiActions";
import { getLatestMemo, getLatestRiskRun } from "@/lib/db/server";
import type { EvidenceRef } from "@/lib/evidence/types";

function CitationList({ citations }: { citations: EvidenceRef[] }) {
  if (!citations?.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {citations.slice(0, 6).map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-2 rounded-full border border-border-dark bg-[#0b0d10] px-2 py-1 text-[11px] text-muted-foreground"
          title={c.excerpt ?? ""}
        >
          <span className="material-symbols-outlined text-[14px]">link</span>
          {c.label ?? c.sourceId}
          {c.page ? <span>· p.{c.page}</span> : null}
        </span>
      ))}
    </div>
  );
}

export default async function DealMemoWorkspace({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  const latestRisk = await getLatestRiskRun(dealId);
  const latestMemo = await getLatestMemo(dealId);

  const canGenerate = Boolean(latestRisk);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">AI Credit Memo</div>
          <div className="text-sm text-muted-foreground">
            Generate a memo from risk drivers and evidence. Every claim is traceable.
          </div>
        </div>

        <form
          action={async () => {
            "use server";
            if (!canGenerate) throw new Error("Generate risk first.");
            await generateMemoAction(dealId);
          }}
        >
          <button
            disabled={!canGenerate}
            className={[
              "rounded-lg px-3 py-1.5 text-sm font-medium text-white",
              canGenerate ? "bg-primary hover:opacity-90" : "bg-[#2a2f3a] cursor-not-allowed opacity-60",
            ].join(" ")}
          >
            Generate Memo (AI)
          </button>
        </form>
      </div>

      {!latestRisk ? (
        <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
          <div className="text-sm font-semibold">Missing prerequisite</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Generate a Risk Run first on the Risk & Pricing page.
          </div>
        </div>
      ) : null}

      {!latestMemo ? (
        <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
          <div className="text-sm font-semibold">No memo yet</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Click <span className="font-medium text-white">Generate Memo (AI)</span>.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4 text-sm text-muted-foreground">
            Latest memo run: <span className="font-mono text-white">{latestMemo.run.id.slice(0, 8)}</span>{" "}
            • linked risk run:{" "}
            <span className="font-mono text-white">{latestMemo.run.risk_run_id?.slice(0, 8) ?? "none"}</span>
          </div>

          {latestMemo.sections.map((s) => (
            <div key={s.id} className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{s.content}</div>
              <CitationList citations={s.citations ?? []} />
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border-dark bg-[#0b0d10] p-4">
        <div className="text-sm font-semibold">Next upgrade (the real "superpower")</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Replace the stub AI with OpenAI and wire citations to your PdfEvidenceSpansViewer
          so clicking a citation jumps to the exact page + highlight.
        </div>
      </div>
    </div>
  );
}
