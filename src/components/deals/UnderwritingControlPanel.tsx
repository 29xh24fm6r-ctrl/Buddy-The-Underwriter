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
}: {
  dealId: string;
  lifecycleStage?: string | null;
  intakeInitialized?: boolean;
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

      const href = `/underwrite/${dealId}`;
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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_18px_50px_rgba(0,0,0,0.35)] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="rocket_launch" className="h-5 w-5 text-white" />
          <h3 className="text-sm font-semibold text-white">Underwriting</h3>
        </div>
      </div>

      <button
        type="button"
        data-testid="start-underwriting"
        disabled={busy || loadingGate || !gate.allowed}
        onClick={startUnderwriting}
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
        {gate.allowed
          ? "Ready to start underwriting."
          : gate.blockers[0] || "Underwriting is blocked until required documents are received."}
      </p>

      {!gate.allowed && gate.blockers.length > 0 ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
          <div className="font-semibold text-white/80">Blockers</div>
          <ul className="mt-2 space-y-1">
            {gate.blockers.map((b, idx) => (
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
