"use client";

/**
 * SPEC-12.1 — Client-side advisor signal throttle.
 *
 * Content-hash keyed, 5-min window. Severity escalation always bypasses.
 * Content changes always bypass. De-escalations do NOT bypass.
 *
 * Non-negotiable #6: throttling key is a content hash.
 * Non-negotiable #7: severity escalation is strictly one-way.
 * Non-negotiable #11: throttling lives in the hook, not the builder.
 */

import { useMemo, useRef } from "react";
import type { CockpitAdvisorSignal } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import { signalKey } from "./useAdvisorSignalFeedback";

const THROTTLE_MS = 5 * 60 * 1000;

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

interface ThrottleEntry {
  lastShownAt: number;
  lastSeverity: string;
  lastContentHash: string;
}

export function signalContentHash(signal: CockpitAdvisorSignal): string {
  const evidenceFragment = (signal.evidence ?? [])
    .map((e) => [e.source, e.label, e.value ?? ""])
    .map((row) => row.join(":"))
    .join(",");
  return [
    signal.kind,
    signal.predictionReason ?? "",
    signal.severity,
    (signal as any).riskScore ?? "",
    evidenceFragment,
  ].join("|");
}

export interface UseAdvisorSignalThrottleResult {
  filteredSignals: CockpitAdvisorSignal[];
  suppressedCount: number;
}

export function useAdvisorSignalThrottle(
  dealId: string,
  signals: CockpitAdvisorSignal[],
  options?: { now?: number; throttleMs?: number },
): UseAdvisorSignalThrottleResult {
  const stateRef = useRef<Map<string, ThrottleEntry>>(new Map());
  const now = options?.now ?? Date.now();
  const throttleMs = options?.throttleMs ?? THROTTLE_MS;

  return useMemo(() => {
    const filtered: CockpitAdvisorSignal[] = [];
    let suppressed = 0;

    for (const signal of signals) {
      const key = signalKey(dealId, signal);
      const hash = signalContentHash(signal);
      const prev = stateRef.current.get(key);

      if (!prev) {
        stateRef.current.set(key, {
          lastShownAt: now,
          lastSeverity: signal.severity,
          lastContentHash: hash,
        });
        filtered.push(signal);
        continue;
      }

      const escalated =
        (SEVERITY_RANK[signal.severity] ?? 0) >
        (SEVERITY_RANK[prev.lastSeverity] ?? 0);
      const contentChanged = hash !== prev.lastContentHash;
      const elapsed = now - prev.lastShownAt;

      if (escalated || contentChanged) {
        stateRef.current.set(key, {
          lastShownAt: now,
          lastSeverity: signal.severity,
          lastContentHash: hash,
        });
        filtered.push(signal);
        continue;
      }

      if (elapsed < throttleMs) {
        suppressed += 1;
        continue;
      }

      stateRef.current.set(key, {
        lastShownAt: now,
        lastSeverity: signal.severity,
        lastContentHash: hash,
      });
      filtered.push(signal);
    }

    return { filteredSignals: filtered, suppressedCount: suppressed };
  }, [dealId, signals, now, throttleMs]);
}
