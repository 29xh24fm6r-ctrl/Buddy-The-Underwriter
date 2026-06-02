/**
 * Client-side loader that merges the existing research endpoints into a single
 * ResearchGateSnapshot for the underwrite workbench.
 * SPEC-UNDERWRITE-RESEARCH-GATE-END-TO-END-1
 *
 * Uses ONLY existing endpoints — no new research source of truth:
 *   - GET /api/deals/[dealId]/research/quality     → gate_passed, score, failures
 *   - GET /api/deals/[dealId]/research/flight-deck  → latest mission status
 *
 * Best-effort: any failure degrades to EMPTY_RESEARCH_GATE_SNAPSHOT (gate not
 * passed, no mission) rather than throwing — the workbench must still render.
 */

import type { MissionStatus } from "@/lib/research/types";
import {
  EMPTY_RESEARCH_GATE_SNAPSHOT,
  type ResearchGateSnapshot,
} from "./researchGateTypes";

const MISSION_STATUSES: MissionStatus[] = [
  "queued",
  "running",
  "complete",
  "failed",
  "cancelled",
];

function normalizeMissionStatus(value: unknown): MissionStatus | null {
  if (typeof value === "string" && (MISSION_STATUSES as string[]).includes(value)) {
    return value as MissionStatus;
  }
  return null;
}

function normalizeGateFailures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => {
      if (typeof f === "string") return f;
      if (f && typeof f === "object") {
        const obj = f as Record<string, unknown>;
        const reason = obj.reason ?? obj.gate_id ?? obj.message;
        return typeof reason === "string" ? reason : null;
      }
      return null;
    })
    .filter((s): s is string => !!s && s.trim().length > 0);
}

export async function fetchResearchGateSnapshot(
  dealId: string,
): Promise<ResearchGateSnapshot> {
  try {
    const [qualityRes, flightRes] = await Promise.allSettled([
      fetch(`/api/deals/${dealId}/research/quality`).then((r) => r.json()),
      fetch(`/api/deals/${dealId}/research/flight-deck`).then((r) => r.json()),
    ]);

    const quality =
      qualityRes.status === "fulfilled" && qualityRes.value?.ok
        ? qualityRes.value
        : null;
    const flight =
      flightRes.status === "fulfilled" && flightRes.value?.ok
        ? flightRes.value
        : null;

    const gate = quality?.gate ?? null;

    return {
      gatePassed: gate?.gate_passed === true,
      missionStatus: normalizeMissionStatus(flight?.research?.status),
      qualityScore:
        gate?.quality_score ?? flight?.qualityScore ?? null,
      trustGrade: gate?.trust_grade ?? flight?.trustGrade ?? null,
      gateFailures: normalizeGateFailures(gate?.gate_failures),
      // SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
      groups: flight?.groups ?? null,
      certificationLevel: flight?.certificationLevel ?? null,
    };
  } catch {
    return { ...EMPTY_RESEARCH_GATE_SNAPSHOT };
  }
}
