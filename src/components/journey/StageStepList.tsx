"use client";
// SPEC-GUIDED-STAGE-RAIL-1 — clickable step checklist under current/next stage rows.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { StageStep } from "@/lib/journey/stageSteps";

type MemoRow = StageStep & { open: boolean };

export function StageStepList({ steps, stageKey }: { steps: StageStep[]; stageKey: string }) {
  // Session memo of steps seen for this stage → a step that was present and is now
  // gone renders green (resolved) for the rest of the session. The ref accumulates the
  // memo; the effect (never render) is the only place we read/mutate refs, and it
  // publishes the projected rows into state so React re-renders on the "turn green"
  // transition. Refs are intentionally not read during render (react-hooks/refs).
  const seen = useRef<Map<string, StageStep>>(new Map());
  const memoKey = useRef(stageKey);
  const [rows, setRows] = useState<MemoRow[]>([]);
  useEffect(() => {
    if (memoKey.current !== stageKey) { seen.current = new Map(); memoKey.current = stageKey; }
    for (const s of steps) seen.current.set(s.code, s);
    const openCodes = new Set(steps.map((s) => s.code));
    setRows([...seen.current.values()].map((s) => ({ ...s, open: openCodes.has(s.code) })));
  }, [steps, stageKey]);

  if (rows.length === 0) return null;
  return (
    <ol role="list" className="mt-1 space-y-0.5 pl-6" data-testid="stage-step-list">
      {rows.map((s) => (
        <li key={s.code} data-testid={`stage-step-${s.code}`} data-open={s.open}>
          {s.open && s.system ? (
            <span className="block px-2 py-1 text-[11px] text-white/40 italic">
              <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full border border-white/20 align-middle" aria-hidden />
              {s.label}
            </span>
          ) : s.open && s.href ? (
            <Link
              href={s.href}
              prefetch={false} // SPEC-DEAL-NAV-PREFETCH-SUPPRESSION-1
              className="block rounded-md px-2 py-1 text-[11px] text-white/80 hover:bg-white/5"
            >
              <span className="mr-1 inline-block h-2 w-2 rounded-full border border-white/40 align-middle" aria-hidden />
              {s.label}
            </Link>
          ) : s.open ? (
            <span className="block px-2 py-1 text-[11px] text-white/60">
              <span className="mr-1 inline-block h-2 w-2 rounded-full border border-white/40 align-middle" aria-hidden />
              {s.label}
            </span>
          ) : (
            <span className="block px-2 py-1 text-[11px] text-emerald-300/80 line-through">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" aria-hidden />
              {s.label}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
