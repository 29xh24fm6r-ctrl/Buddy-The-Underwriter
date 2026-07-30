import "server-only";

/**
 * SPEC-M3 GLASS-BOX-1 — the borrower-facing "readiness read."
 *
 * Numbers displayed come ONLY from the deterministic model snapshot
 * (deal_model_snapshots via loadLatestSnapshotMetrics) — the `translator`
 * role receives them as immutable facts and narrates them in plain
 * English; it never computes a canonical financial value (Program
 * Invariant #1). The `verifier` role independently fact-checks the
 * narrative against those same facts before anything renders — any
 * `critical` mismatch degrades the whole read rather than surgically
 * editing out one bad sentence (no Frankenstein narratives).
 *
 * Both translator and verifier default to Anthropic (roleConfig.ts) —
 * npiTagged: true on every call here, since a deal's financial figures
 * are borrower NPI. Until docs/vendors/anthropic.md is APPROVED, every
 * call below is refused by the gateway's NPI gate; the catch block below
 * turns that (like any other translator/verifier failure) into a
 * "degraded" result with a generic retry message — expected, not a bug
 * (see SPEC-M1 vendor gating). "unavailable" is reserved for the separate
 * case of no snapshot existing yet at all.
 */
// ai-disclaimer-surface: readiness — enforced by scripts/guards/guard-ai-disclaimer.mjs

import { runRole } from "@/lib/ai/gateway";
import { verifyClaims } from "@/lib/ai/verify";
import { getDisclaimer } from "@/lib/ai/disclaimers";
import { emitReadinessReadRendered } from "@/lib/brokerage/beatMetrics";
import { loadLatestSnapshotMetrics } from "@/lib/modelEngine/snapshotService";

export type GlassBoxSection = {
  metricKey: string;
  label: string;
  narrative: string;
};

export type GlassBoxReadinessRead =
  | { status: "unavailable"; message: string }
  | { status: "degraded"; message: string; missingMetrics: string[]; disclaimer: string }
  | { status: "ready"; sections: GlassBoxSection[]; disclaimer: string };

type SB = { from: (t: string) => any };

const TRANSLATOR_SYSTEM_INSTRUCTION =
  "You are translating a small business loan applicant's own already-computed " +
  "financial figures into plain, neutral English for them to read on their own " +
  "loan application. You are NOT a lender and you do not make or imply any " +
  "credit decision. Never state or imply that the loan will or won't be " +
  "approved, never compare to an approval threshold as if it decides the " +
  "outcome, and never invent a number that wasn't given to you. Use only the " +
  "exact figures provided. Write one short, calm, factual sentence per metric.";

const SECTIONS_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          metricKey: { type: "string" },
          narrative: { type: "string" },
        },
        required: ["metricKey", "narrative"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
} as const;

/** Humanized fallback label for a metric key with no explicit entry below. */
const METRIC_LABELS: Record<string, string> = {
  DSCR: "Debt Service Coverage Ratio",
  EBITDA: "EBITDA",
  LTV_GROSS: "Loan-to-Value",
  TOTAL_ASSETS: "Total Assets",
  TOTAL_LIABILITIES: "Total Liabilities",
  CFADS: "Cash Flow Available for Debt Service",
  NET_INCOME: "Net Income",
  CURRENT_RATIO: "Current Ratio",
};

function labelFor(metricKey: string): string {
  if (METRIC_LABELS[metricKey]) return METRIC_LABELS[metricKey];
  return metricKey
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildPrompt(facts: Record<string, number>): string {
  return [
    "FACTS (immutable, already computed — do not question or recompute these):",
    JSON.stringify(facts, null, 2),
    "",
    "For each metric key above, write one short narrative sentence explaining " +
      "what it means in plain English, using only the given value.",
  ].join("\n");
}

export async function buildGlassBoxReadinessRead(
  dealId: string,
  sb: SB,
): Promise<GlassBoxReadinessRead> {
  const snapshot = await loadLatestSnapshotMetrics(sb, dealId);

  if (!snapshot) {
    return {
      status: "unavailable",
      message:
        "We don't have enough information yet to build your readiness read. " +
        "Upload your financial documents to get started.",
    };
  }

  const facts: Record<string, number> = {};
  const missingMetrics: string[] = [];
  for (const [key, value] of Object.entries(snapshot.computedMetrics)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      facts[key] = value;
    } else {
      missingMetrics.push(key);
    }
  }

  if (Object.keys(facts).length === 0) {
    return {
      status: "degraded",
      message:
        "We have a snapshot of your application, but not enough computed " +
        "figures yet to build a readiness read. Here's what's still needed.",
      missingMetrics,
      disclaimer: getDisclaimer("readiness"),
    };
  }

  let sections: GlassBoxSection[];
  try {
    const translated = await runRole("translator", {
      prompt: buildPrompt(facts),
      systemInstruction: TRANSLATOR_SYSTEM_INSTRUCTION,
      responseSchema: SECTIONS_SCHEMA,
      purpose: "glass_box_narrate",
      dealId,
      npiTagged: true,
    });

    const parsed = JSON.parse(translated.text) as { sections?: Array<{ metricKey: string; narrative: string }> };
    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];

    const draftText = rawSections
      .map((s) => `${labelFor(s.metricKey)}: ${s.narrative}`)
      .join("\n");

    const verification = await verifyClaims({
      facts,
      draft: draftText,
      dealId,
      npiTagged: true,
    });

    const hasCriticalFlag = verification.flaggedClaims.some((f) => f.severity === "critical");
    if (verification.verdict === "flagged" && hasCriticalFlag) {
      return {
        status: "degraded",
        message:
          "We're double-checking your readiness read before showing it to you. " +
          "Check back shortly, or here's what's still needed in the meantime.",
        missingMetrics,
        disclaimer: getDisclaimer("readiness"),
      };
    }

    sections = rawSections
      .filter((s) => typeof facts[s.metricKey] === "number")
      .map((s) => ({ metricKey: s.metricKey, label: labelFor(s.metricKey), narrative: s.narrative }));
  } catch (err) {
    console.error("[glass-box] translator/verifier call failed:", err);
    return {
      status: "degraded",
      message:
        "We couldn't generate your readiness read just now. Here's what's " +
        "still needed in the meantime.",
      missingMetrics,
      disclaimer: getDisclaimer("readiness"),
    };
  }

  // Best-effort — a metrics-write failure must not block the borrower's render.
  try {
    await emitReadinessReadRendered(dealId, sb);
  } catch (err) {
    console.error("[beatMetrics] failed to emit readiness_read_rendered", err);
  }

  return {
    status: "ready",
    sections,
    disclaimer: getDisclaimer("readiness"),
  };
}
