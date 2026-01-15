"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

export function UnderwritingControlPanel({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function startUnderwriting() {
    if (!dealId) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[UnderwritingControlPanel] Start Underwriting missing dealId");
      }
      setErr("Missing deal id");
      return;
    }
    const href = `/underwrite/${dealId}`;
    if (process.env.NODE_ENV !== "production") {
      console.info("[UnderwritingControlPanel] Start Underwriting click", { dealId, href });
      console.assert(
        /^\/underwrite\/[0-9a-f-]{36}$/i.test(href),
        "Start Underwriting href mismatch",
        href,
      );
    }
    setBusy(true);
    router.push(href);
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="rocket_launch" className="h-5 w-5 text-neutral-900" />
          <h3 className="text-sm font-semibold">Underwriting Pipeline</h3>
        </div>
      </div>

      <button
        type="button"
        data-testid="start-underwriting"
        disabled={busy}
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

      <p className="mt-2 text-xs text-neutral-500 text-center">
        Validates checklist, runs confidence review, triggers risk scoring
      </p>

      {err && (
        <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1 text-xs">{err}</div>
        </div>
      )}

    </div>
  );
}
