"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

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
  const routeParams = useParams();
  const routeDealId = (routeParams as any)?.dealId as string | undefined;
  const dealId = (props.dealId ?? routeDealId ?? null);

  // Validate UUID format
  const isValidUuid =
    !!dealId &&
    dealId !== "undefined" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dealId);

  const [step, setStep] = useState<Step>("route");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [pipelineOk, setPipelineOk] = useState<boolean | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ctxStatus, setCtxStatus] = useState<number | null>(null);
  const [pulse, setPulse] = useState<number>(0);
  const [lastChangeAt, setLastChangeAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const startedAtRef = useRef<number>(Date.now());
  const elapsedMs = now - startedAtRef.current;
  const lastSnapshotRef = useRef<string>("");
  const pollMsRef = useRef<number>(2000);

  // ✅ Real UI timer: forces re-render so seconds/last ok/last change update live
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // 🔥 REAL TIMER: forces re-render so secs/lastOk/lastChange update live
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const badge = useMemo(() => {
    const secs = Math.floor(elapsedMs / 1000);
    const lastOk = lastOkAt ? `${Math.floor((now - lastOkAt) / 1000)}s ago` : "—";
    const lastChange = lastChangeAt ? `${Math.floor((now - lastChangeAt) / 1000)}s ago` : "—";
    return { secs, lastOk, lastChange };
  }, [elapsedMs, lastOkAt, lastChangeAt, now]);

  const debugBundle = useMemo(() => {
    return {
      dealId,
      step,
      ctxStatus,
      pipelineOk,
      lastOkAt,
      lastChangeAt,
      probe,
      client_ts: new Date().toISOString(),
    };
  }, [dealId, step, ctxStatus, pipelineOk, lastOkAt, lastChangeAt, probe]);

  const handleCopyDebug = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugBundle, null, 2));
    } catch {
      // ignore
    }
  };

  // Auto-advance from 'route' step when we get a valid dealId
  useEffect(() => {
    if (isValidUuid && step === "route") {
      setStep("context");
    }
  }, [isValidUuid, step]);

  // Poll context + pipeline for health
  useEffect(() => {
    let alive = true;
    if (!dealId || dealId === "undefined") return;

    const poll = async () => {
      try {
        setErr(null);
        setPulse((p) => (p + 1) % 1000000);

        // 1) Context probe (deal exists + bank context)
        setStep("context");
        const r = await fetch(`/api/deals/${dealId}/context`, { cache: "no-store" });
        if (!alive) return;
        setCtxStatus(r.status);
        const j = (await r.json()) as Probe;
        if (!alive) return;
        setProbe(j);

        // detect meaningful changes for "since last change"
        const snapshot = JSON.stringify({ ctxStatus: r.status, j, pipelineOk });
        if (snapshot !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snapshot;
          setLastChangeAt(Date.now());
        }

        if (!r.ok || !("ok" in j) || j.ok === false) {
          setErr((j as any)?.error ?? `context_failed_${r.status}`);
          pollMsRef.current = 2000; // stay aggressive while failing
          return;
        }

        setLastOkAt(Date.now());
        // backoff when healthy (2s → 5s → 10s max)
        pollMsRef.current = pollMsRef.current >= 10000 ? 10000 : pollMsRef.current === 2000 ? 5000 : 10000;

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
        pollMsRef.current = 2000;
      }
    };

    // ✅ immediate + truly adaptive scheduling (interval can't change after creation)
    let timeout: any = null;
    const loop = async () => {
      await poll();
      if (!alive) return;
      timeout = setTimeout(loop, pollMsRef.current);
    };
    void loop();
    return () => {
      alive = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [dealId]);

  // Derived health pills
  const routeOk = isValidUuid;
  const ctxOk = probe && "ok" in probe && probe.ok === true ? true : false;
  const bankOk = ctxOk && probe.ok ? (probe.deal?.bank_id ? true : false) : null;

  const pill = (label: string, ok: boolean | null) => {
    const color = ok === true ? "emerald" : ok === false ? "red" : "neutral";
    return (
      <span
        key={label}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
          color === "emerald"
            ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
            : color === "red"
            ? "border-red-800 bg-red-950/40 text-red-200"
            : "border-neutral-800 bg-neutral-950/40 text-neutral-400"
        }`}
      >
        {ok === true ? "✅" : ok === false ? "❌" : "⏳"}
        {label}
      </span>
    );
  };

  return (
    <div className="sticky top-0 z-[60] border-b border-neutral-800 bg-black/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full bg-emerald-400/70"
            style={{ opacity: 0.35 + (pulse % 2) * 0.35 }}
            title="polling heartbeat"
          />
          <div className="text-sm font-semibold text-neutral-100">
            Resolving deal context
          </div>
          <div className="text-xs text-neutral-400">
            {badge.secs}s • last ok {badge.lastOk} • ctx {ctxStatus ?? "—"}
          </div>
        </div>

        <div className="hidden md:block text-[11px] text-neutral-500">
          bar.dealId:{" "}
          <span className="font-mono text-neutral-400">
            {dealId || "null"}
          </span>
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

          <button
            type="button"
            onClick={() => void handleCopyDebug()}
            className="rounded-full border border-neutral-800 bg-neutral-950/40 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
            title="Copies dealId + probe payload + pipeline health"
          >
            Copy debug
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

export default DealCockpitLoadingBar;
