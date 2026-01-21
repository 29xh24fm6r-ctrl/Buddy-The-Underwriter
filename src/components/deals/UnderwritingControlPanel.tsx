"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { emitBuddySignal } from "@/buddy/emitBuddySignal";
import { buildUnderwritingGate } from "@/lib/deals/underwritingGate";

export function UnderwritingControlPanel({
  dealId,
  lifecycleStage,
  intakeInitialized,
  verifyLedger,
}: {
  dealId: string;
  lifecycleStage?: string | null;
  intakeInitialized?: boolean;
  verifyLedger?: {
    status: "pass" | "fail";
    source: "builder" | "runtime";
    details: {
      url: string;
      httpStatus?: number;
      auth?: boolean;
      html?: boolean;
      metaFallback?: boolean;
      error?: string;
      redacted?: boolean;
    };
    recommendedNextAction?: string | null;
    diagnostics?: Record<string, unknown> | null;
    createdAt?: string | null;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [missingRequired, setMissingRequired] = React.useState<string[]>([]);
  const [loadingGate, setLoadingGate] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    async function loadGate() {
      if (!dealId) return;
      setLoadingGate(true);
      try {
        const res = await fetch(`/api/deals/${dealId}/checklist/list`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json?.ok) {
          setMissingRequired([]);
          return;
        }
        const missing = (json.items || [])
          .filter((i: any) => i.required && (i.status === "missing" || i.status === "pending" || i.status === "needs_review" || !i.status))
          .map((i: any) => i.title);
        setMissingRequired(missing);
      } catch {
        if (!alive) return;
        setMissingRequired([]);
      } finally {
        if (!alive) return;
        setLoadingGate(false);
      }
    }
    loadGate();
    return () => {
      alive = false;
    };
  }, [dealId]);

  async function startUnderwriting() {
    if (!dealId) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[UnderwritingControlPanel] Start Underwriting missing dealId");
      }
      setErr("Missing deal id");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/underwrite/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Underwriting could not start");
        if (Array.isArray(json?.missing)) {
          setMissingRequired(json.missing.map((k: string) => String(k)));
        }
        return;
      }

      emitBuddySignal({
        type: "user.action",
        source: "components/deals/UnderwritingControlPanel.tsx",
        dealId,
        payload: { action: "start_underwriting" },
      });

      const href = `/deals/${dealId}/underwrite`;
      router.push(href);
    } catch (e: any) {
      setErr(e?.message || "Underwriting could not start");
    } finally {
      setBusy(false);
    }
  }

  const gate = buildUnderwritingGate({
    lifecycleStage,
    missingRequiredTitles: missingRequired,
    intakeInitialized,
  });

  const verifyFailure = verifyLedger?.status === "fail";
  const verifyHint = verifyLedger?.details?.html
    ? "Underwrite endpoint returned HTML — likely auth-gated."
    : verifyLedger?.details?.metaFallback
      ? "Primary JSON unavailable, meta fallback used."
      : verifyLedger?.details?.auth === false
        ? "Session not authorized to start underwriting."
        : verifyLedger?.details?.error === "banker_test_mode"
          ? "Banker test mode blocks underwriting."
          : verifyFailure
            ? "Underwrite verification has not passed."
            : "";

  const allowStart = gate.allowed && !verifyFailure;

  const builderMode = process.env.NEXT_PUBLIC_BUDDY_ROLE === "builder";

  const buttonTitle = verifyFailure
    ? verifyHint || "Underwrite verification blocked."
    : allowStart
      ? "Start underwriting"
      : gate.blockers[0] || "Underwriting is blocked.";

  const displayBlockers = [...gate.blockers];
  if (verifyFailure && verifyHint) {
    displayBlockers.unshift(verifyHint);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_18px_50px_rgba(0,0,0,0.35)] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="rocket_launch" className="h-5 w-5 text-white" />
          <h3 className="text-sm font-semibold text-white">Underwriting</h3>
        </div>
        {verifyLedger ? (
          <span
            className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              verifyLedger.status === "pass"
                ? "bg-emerald-400/20 text-emerald-100"
                : "bg-amber-400/20 text-amber-100"
            }`}
          >
            {verifyLedger.status === "pass" ? "Verify: PASS" : "Verify: BLOCKED"}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        data-testid="start-underwriting"
        disabled={busy || loadingGate || !allowStart}
        onClick={startUnderwriting}
        title={buttonTitle}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 disabled:opacity-60 pointer-events-auto"
      >
        {busy ? (
          <>
            <Icon name="sync" className="h-5 w-5 text-white animate-spin" />
            Starting Pipeline…
          </>
        ) : (
          <>
            <Icon name="play_arrow" className="h-5 w-5 text-white" />
            Start Underwriting
          </>
        )}
      </button>

      <p className="mt-2 text-xs text-white/60 text-center">
        {allowStart
          ? "Ready to start underwriting."
          : gate.blockers[0] || "Underwriting is blocked until required documents are received."}
      </p>

      {verifyFailure ? (
        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
          <div className="font-semibold">Buddy</div>
          <div className="mt-1">{verifyHint}</div>
        </div>
      ) : null}

      {builderMode && verifyLedger ? (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] text-white/70">
          {JSON.stringify(verifyLedger, null, 2)}
        </pre>
      ) : null}

      {!allowStart && displayBlockers.length > 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
          <div className="font-semibold text-white/80">Blockers</div>
          <ul className="mt-2 space-y-1">
            {displayBlockers.map((b, idx) => (
              <li key={`${b}-${idx}`} className="flex items-center gap-2">
                <span>❌</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {err && (
        <div className="mt-4 rounded-lg bg-red-500/15 p-3 text-sm text-red-100">
          <div className="font-semibold">Error</div>
          <div className="mt-1 text-xs">{err}</div>
        </div>
      )}

    </div>
  );
}
