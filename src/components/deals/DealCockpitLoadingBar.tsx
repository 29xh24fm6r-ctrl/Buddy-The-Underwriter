"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Step =
  | "route"
  | "auth"
  | "context"
  | "pipeline"
  | "ready";

type Probe =
  | { ok: false; error: string; details?: string | null; dealId?: string | null }
  | {
      ok: true;
      deal: { id: string; bank_id: string | null; created_at: string };
      ensured_bank: { ok: true; bankId: string; updated: boolean };
      server_ts: string;
    };

export function DealCockpitLoadingBar(props: { dealId?: string | null }) {
  const dealId = props.dealId ?? null;

  const [step, setStep] = useState<Step>("route");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [pipelineOk, setPipelineOk] = useState<boolean | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const startedAtRef = useRef<number>(Date.now());
  const elapsedMs = Date.now() - startedAtRef.current;

  const badge = useMemo(() => {
    const secs = Math.floor(elapsedMs / 1000);
    const lastOk = lastOkAt ? `${Math.floor((Date.now() - lastOkAt) / 1000)}s ago` : "—";
    return { secs, lastOk };
  }, [elapsedMs, lastOkAt]);

  useEffect(() => {
    // Route param step
    if (!dealId || dealId === "undefined") {
      setStep("route");
      setErr(null);
      return;
    }
    setStep("auth");
  }, [dealId]);

  useEffect(() => {
    let alive = true;
    if (!dealId || dealId === "undefined") return;

    const poll = async () => {
      try {
        setErr(null);

        // 1) Context probe (deal exists + bank context)
        setStep("context");
        const r = await fetch(`/api/deals/${dealId}/context`, { cache: "no-store" });
        const j = (await r.json()) as Probe;
        if (!alive) return;
        setProbe(j);

        if (!r.ok || !("ok" in j) || j.ok === false) {
          setErr((j as any)?.error ?? `context_failed_${r.status}`);
          return;
        }

        setLastOkAt(Date.now());

        // 2) Pipeline health (non-fatal if missing, but tells us the app is alive)
        setStep("pipeline");
        try {
          const pr = await fetch(`/api/deals/${dealId}/pipeline/latest`, { cache: "no-store" });
          if (!alive) return;
          setPipelineOk(pr.ok);
        } catch {
          if (!alive) return;
          setPipelineOk(false);
        }

        // If we got here, we're "ready enough" (at least backend is responding)
        setStep("ready");
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? String(e));
      }
    };

    // immediate + interval
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [dealId]);

  const pill = (label: string, ok: boolean | null) => {
    const cls =
      ok === true
        ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
        : ok === false
        ? "border-red-800 bg-red-950/40 text-red-200"
        : "border-neutral-800 bg-neutral-950/40 text-neutral-300";
    return (
      <span className={`rounded-full border px-2 py-1 text-xs ${cls}`}>
        {label}
      </span>
    );
  };

  const routeOk = !!dealId && dealId !== "undefined";
  const ctxOk = probe?.ok === true;
  const bankOk = ctxOk ? !!probe.deal.bank_id : null;

  return (
    <div className="sticky top-0 z-[60] border-b border-neutral-800 bg-black/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-neutral-100">
            Resolving deal context
          </div>
          <div className="text-xs text-neutral-400">
            {badge.secs}s • last ok {badge.lastOk}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pill("Route", routeOk)}
          {pill("Deal+Bank", ctxOk)}
          {pill("bank_id", bankOk === null ? null : bankOk)}
          {pill("Pipeline", pipelineOk)}

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Hard refresh
          </button>
        </div>
      </div>

      {/* Detail strip */}
      <div className="mx-auto w-full max-w-7xl px-4 pb-2">
        {err ? (
          <div className="rounded-xl border border-red-800 bg-red-950/30 p-2 text-xs text-red-200">
            <div className="font-semibold">Still working…</div>
            <div className="mt-1">
              {err}
              {probe && (probe as any)?.details ? ` • ${(probe as any).details}` : ""}
            </div>
          </div>
        ) : step !== "ready" ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 p-2 text-xs text-neutral-300">
            Current step: <span className="font-semibold">{step}</span>
            {dealId ? (
              <>
                {" "}• dealId <span className="font-mono">{dealId}</span>
              </>
            ) : (
              <> • waiting for route params…</>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-800 bg-emerald-950/20 p-2 text-xs text-emerald-200">
            Backend responding ✅ (context + pipeline reachable). If UI still isn't rendering, it's a client chunk/hydration issue.
          </div>
        )}
      </div>
    </div>
  );
}
