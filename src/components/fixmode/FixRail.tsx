"use client";

import * as React from "react";
import { useFixMode } from "@/components/fixmode/FixModeProvider";
import type { FixTarget } from "@/lib/fixTargets";

type GuardIssue = {
  code: string;
  severity: "BLOCKED" | "WARN";
  title: string;
  detail: string;
  fix: { label: string; target: FixTarget };
};

export function FixRail(props: {
  dealId: string;
  bankerUserId: string;
}) {
  const { jumpTo, activeIssue, setActiveIssue } = useFixMode();
  const [issues, setIssues] = React.useState<GuardIssue[]>([]);
  const [severity, setSeverity] = React.useState<"BLOCKED" | "WARN" | "READY">("READY");
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/banker/deals/${props.dealId}/underwrite/guard`, {
        method: "GET",
        headers: { "x-user-id": props.bankerUserId },
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load guard");
      setSeverity(json.guard?.severity ?? "READY");
      setIssues(json.guard?.issues ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    }
  }

  React.useEffect(() => {
    load();
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dealId]);

  // auto-select first BLOCKED issue if none active
  React.useEffect(() => {
    if (activeIssue) return;
    const first = issues.find((i) => i.severity === "BLOCKED") ?? issues[0] ?? null;
    if (first) setActiveIssue(first);
  }, [issues, activeIssue, setActiveIssue]);

  const idx = activeIssue ? issues.findIndex((i) => i.code === activeIssue.code) : -1;
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < issues.length - 1;

  function goIssue(i: GuardIssue) {
    setActiveIssue(i);
    jumpTo(i.fix.target);
  }

  if (severity === "READY" && (!issues || issues.length === 0)) return null;

  return (
    <div className="sticky top-3 z-20 rounded-xl border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            Fix Mode • {severity}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Click Fix → we scroll + focus the exact field.
          </div>
        </div>

        <button className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}

      {activeIssue ? (
        <div className="mt-3 rounded-lg border bg-gray-50 p-2">
          <div className="text-xs text-gray-500">
            {idx + 1} / {issues.length} • {activeIssue.severity}
          </div>
          <div className="mt-1 text-sm font-semibold">{activeIssue.title}</div>
          <div className="mt-1 text-xs text-gray-700">{activeIssue.detail}</div>

          <div className="mt-2 flex gap-2">
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
              onClick={() => hasPrev && goIssue(issues[idx - 1])}
              disabled={!hasPrev}
            >
              Prev
            </button>
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
              onClick={() => goIssue(activeIssue)}
            >
              Fix
            </button>
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-white disabled:opacity-50"
              onClick={() => hasNext && goIssue(issues[idx + 1])}
              disabled={!hasNext}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {(issues ?? []).slice(0, 6).map((i) => (
          <button
            key={i.code}
            className={`w-full rounded-lg border p-2 text-left text-sm hover:bg-gray-50 ${
              activeIssue?.code === i.code ? "bg-gray-50" : "bg-white"
            }`}
            onClick={() => goIssue(i)}
          >
            <div className="text-xs text-gray-500">{i.severity} • {i.code}</div>
            <div className="mt-0.5 font-semibold">{i.title}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
