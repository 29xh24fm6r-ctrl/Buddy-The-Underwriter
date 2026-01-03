export function ProofBand() {
  return (
    <section className="bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 pb-16 md:pb-20">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-sm font-medium text-white">Readiness truth</div>
            <div className="mt-2 text-sm text-white/65">
              Single source of truth: <span className="text-white">deals.ready_at</span> +{" "}
              <span className="text-white">deals.ready_reason</span>.
            </div>
            <pre className="mt-4 overflow-auto rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-xs text-white/70">
{`{
  "ready_at": "2026-01-02T18:03:12Z",
  "ready_reason": "Deal complete"
}`}
            </pre>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-sm font-medium text-white">Ledger explains why</div>
            <div className="mt-2 text-sm text-white/65">
              Authoritative timeline via <span className="text-white">stage / status / payload</span>.
            </div>
            <pre className="mt-4 overflow-auto rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-xs text-white/70">
{`upload     completed   {"finalized": true}
auto_seed   blocked     {"remaining_uploads": 1}
readiness   completed   {"ready_at": "…"}
`}
            </pre>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="text-sm font-medium text-white">Checklist is read-only truth</div>
            <div className="mt-2 text-sm text-white/65">
              No buttons. No guessing. The UI reflects the system state as it converges.
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-xs text-white/70">
              ✅ Evidence counted exactly once<br/>
              ✅ Late arrivals self-heal<br/>
              ✅ No race conditions
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
