"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";

function coerceDealId(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const v = x.trim();
  return v.length ? v : null;
}

function dealIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/\/deals\/([^/]+)\/cockpit(?:\/|$)/);
  return m?.[1] ? m[1] : null;
}

type Step = "route" | "context" | "pipeline" | "ready";

type Probe =
  | { ok: false; error: string; details?: string | null; dealId?: string | null }
  | {
      ok: true;
      deal: { id: string; bank_id: string | null; created_at: string | null };
      ensured_bank: { ok: true; bankId: string; updated: boolean } | null;
      server_ts: string;
      // legacy fields can coexist (dealId/stage/borrower/etc)
      [k: string]: any;
    }
  // legacy /context shape (no ok field)
  | { dealId: string; [k: string]: any };

export function DealCockpitLoadingBar(props: { dealId?: string | null }) {
  const params = useParams<{ dealId?: string }>();
  const pathname = usePathname();

  const resolvedDealId = useMemo(() => {
    // 1) Props (authoritative from server page)
    const fromProps = coerceDealId(props.dealId);
    if (fromProps) return fromProps;

    // 2) Router params (best effort)
    const fromParams = coerceDealId(params?.dealId);
    if (fromParams) return fromParams;

    // 3) Pathname fallback (bulletproof)
    const fromPath = coerceDealId(dealIdFromPath(pathname));
    if (fromPath) return fromPath;

    return null;
  }, [props.dealId, params?.dealId, pathname]);

  // Use resolvedDealId everywhere below
  const dealId = resolvedDealId;

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

  const startedAtRef = useRef<number>(Date.now());
  const [now, setNow] = useState<number>(() => Date.now()); // timer tick
  const elapsedMs = now - startedAtRef.current;

  const lastSnapshotRef = useRef<string>("");
  const pollMsRef = useRef<number>(2000);
  const timerRef = useRef<any>(null);

  // 1s UI timer tick (independent of polling)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const badge = useMemo(() => {
    const secs = Math.floor(elapsedMs / 1000);
    const lastOk = lastOkAt ? `${Math.floor((Date.now() - lastOkAt) / 1000)}s ago` : "—";
    const lastChange = lastChangeAt ? `${Math.floor((Date.now() - lastChangeAt) / 1000)}s ago` : "—";
    return { secs, lastOk, lastChange };
  }, [elapsedMs, lastOkAt, lastChangeAt]);

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

  // Auto-advance from 'route' when dealId becomes valid
  useEffect(() => {
    if (isValidUuid && step === "route") setStep("context");
  }, [isValidUuid, step]);

  // Poller (adaptive)
  useEffect(() => {
    let alive = true;
    if (!dealId || dealId === "undefined") return;

    const poll = async () => {
      try {
        setErr(null);
        setPulse((p) => (p + 1) % 1000000);

        setStep("context");
        const r = await fetch(`/api/deals/${dealId}/context`, { cache: "no-store" });
        if (!alive) return;

        setCtxStatus(r.status);
        const j = (await r.json()) as Probe;
        if (!alive) return;
        setProbe(j);

        const snapshot = JSON.stringify({ ctxStatus: r.status, j, pipelineOk });
        if (snapshot !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snapshot;
          setLastChangeAt(Date.now());
        }

        // HTTP failure
        if (!r.ok) {
          setErr(`http_${r.status}`);
          pollMsRef.current = 2000;
          return;
        }

        // If new shape says ok:false, honor it
        if ((j as any)?.ok === false) {
          setErr((j as any)?.error ?? `context_failed_${r.status}`);
          pollMsRef.current = 2000;
          return;
        }

        // Legacy shape: treat presence of dealId as success
        const legacyOk = !!(j as any)?.dealId;
        const newOk = (j as any)?.ok === true;

        if (!legacyOk && !newOk) {
          setErr(`context_unrecognized_shape_${r.status}`);
          pollMsRef.current = 2000;
          return;
        }

        setLastOkAt(Date.now());
        pollMsRef.current = pollMsRef.current >= 10000 ? 10000 : pollMsRef.current === 2000 ? 5000 : 10000;

        setStep("pipeline");
        try {
          const pr = await fetch(`/api/deals/${dealId}/pipeline/latest`, { cache: "no-store" });
          if (!alive) return;
          setPipelineOk(pr.ok);
        } catch {
          if (!alive) return;
          setPipelineOk(false);
        }

        setStep("ready");
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? String(e));
        pollMsRef.current = 2000;
      } finally {
        // adaptive reschedule (setTimeout, not setInterval)
        if (!alive) return;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void poll(), pollMsRef.current);
      }
    };

    void poll();
    return () => {
      alive = false;
      clearTimeout(timerRef.current);
    };
  }, [dealId, pipelineOk]);

  // Pills
  const routeOk = isValidUuid;

  const ctxOk = probe
    ? ((probe as any).ok === true || !!(probe as any).dealId)
    : false;

  const bankOk =
    probe && (probe as any)?.deal && typeof (probe as any)?.deal?.bank_id !== "undefined"
      ? !!(probe as any).deal.bank_id
      : null;

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
          <div className="text-sm font-semibold text-neutral-100">Resolving deal context</div>
          <div className="text-xs text-neutral-400">
            {badge.secs}s • last ok {badge.lastOk} • ctx {ctxStatus ?? "—"}
          </div>
        </div>

        <div className="hidden md:block text-[11px] text-neutral-500">
          bar.dealId: <span className="font-mono text-neutral-400">{dealId || "null"}</span>
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

      <div className="mx-auto w-full max-w-7xl px-4 pb-2">
        {err ? (
          <div className="rounded-xl border border-red-800 bg-red-950/30 p-2 text-xs text-red-200">
            <div className="font-semibold">Still working…</div>
            <div className="mt-1">
              {err}
              {(probe as any)?.details ? ` • ${(probe as any).details}` : ""}
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

// ✅ default export so both import styles work
export default DealCockpitLoadingBar;
