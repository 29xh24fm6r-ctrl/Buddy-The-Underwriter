"use client";
// SPEC-GUIDED-STAGE-RAIL-1 — clickable step checklist under current/next stage rows.
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { StageStep } from "@/lib/journey/stageSteps";

export function StageStepList({ steps, stageKey }: { steps: StageStep[]; stageKey: string }) {
  // Session memo of steps seen for this stage → resolved steps render green.
  const seen = useRef<Map<string, StageStep>>(new Map());
  const memoKey = useRef(stageKey);
  useEffect(() => {
    if (memoKey.current !== stageKey) { seen.current = new Map(); memoKey.current = stageKey; }
    for (const s of steps) seen.current.set(s.code, s);
  }, [steps, stageKey]);

  const openCodes = new Set(steps.map((s) => s.code));
  const rows = [...seen.current.values()].map((s) => ({ ...s, open: openCodes.has(s.code) }));

  if (rows.length === 0) return null;
  return (
    <ol role="list" className="mt-1 space-y-0.5 pl-6" data-testid="stage-step-list">
      {rows.map((s) => (
        <li key={s.code} data-testid={`stage-step-${s.code}`} data-open={s.open}>
          {s.open && s.href ? (
            <Link
              href={s.href}
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
