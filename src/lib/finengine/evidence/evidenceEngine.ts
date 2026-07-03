/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 14: Evidence Engine.
 *
 * Makes every analytical conclusion explainable. An evidence bundle carries the
 * supporting facts, the contradicting facts, what is missing, a net confidence,
 * and source anchors (doc/page references where available). `WithEvidence<T>`
 * lets any analytical object carry its evidence through downstream transforms
 * without the transform having to know about evidence.
 *
 * Pure — no IO. Confidence is a bounded [0,1] heuristic, never false precision.
 */

export type EvidenceKind = "supporting" | "contradicting" | "missing";

export type SourceAnchor = {
  /** e.g. "deal_documents:<id>" or "tax_return:<id>". */
  sourceRef?: string;
  docId?: string;
  page?: number;
  label?: string;
};

export type EvidenceItem = {
  kind: EvidenceKind;
  statement: string;
  /** 0..1 strength of this individual item (defaults applied by kind). */
  weight?: number;
  anchor?: SourceAnchor;
};

export type EvidenceBundle = {
  conclusion: string;
  supporting: EvidenceItem[];
  contradicting: EvidenceItem[];
  missing: EvidenceItem[];
  /** Net confidence in the conclusion, [0,1]. */
  confidence: number;
  /** De-duplicated source anchors across supporting + contradicting items. */
  sourceAnchors: SourceAnchor[];
};

export type WithEvidence<T> = T & { evidence: EvidenceBundle };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Default per-item weight when not explicitly supplied. */
function itemWeight(item: EvidenceItem): number {
  if (item.weight != null) return clamp01(item.weight);
  // Sensible defaults: supporting/contradicting carry real weight; missing is a drag.
  return item.kind === "missing" ? 0.5 : 0.7;
}

/**
 * Build an evidence bundle from a conclusion + items. Confidence combines the
 * supporting mass against contradicting mass, penalized by missing evidence:
 *   base = ΣsupportW / (ΣsupportW + ΣcontraW)           (evidence balance)
 *   confidence = base * (1 - missingPenalty)             (completeness haircut)
 * With no supporting AND no contradicting evidence, confidence is 0 (unsupported).
 */
export function buildEvidenceBundle(conclusion: string, items: EvidenceItem[]): EvidenceBundle {
  const supporting = items.filter((i) => i.kind === "supporting");
  const contradicting = items.filter((i) => i.kind === "contradicting");
  const missing = items.filter((i) => i.kind === "missing");

  const supportMass = supporting.reduce((s, i) => s + itemWeight(i), 0);
  const contraMass = contradicting.reduce((s, i) => s + itemWeight(i), 0);
  const missingMass = missing.reduce((s, i) => s + itemWeight(i), 0);

  let confidence = 0;
  if (supportMass + contraMass > 0) {
    const base = supportMass / (supportMass + contraMass);
    // Missing evidence haircut, capped so it can't zero out a well-supported claim.
    const missingPenalty = Math.min(0.5, missingMass * 0.15);
    confidence = clamp01(base * (1 - missingPenalty));
  }

  const sourceAnchors = dedupeAnchors(
    [...supporting, ...contradicting].map((i) => i.anchor).filter((a): a is SourceAnchor => !!a),
  );

  return { conclusion, supporting, contradicting, missing, confidence, sourceAnchors };
}

function dedupeAnchors(anchors: SourceAnchor[]): SourceAnchor[] {
  const seen = new Set<string>();
  const out: SourceAnchor[] = [];
  for (const a of anchors) {
    const key = `${a.sourceRef ?? ""}|${a.docId ?? ""}|${a.page ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}

/** Attach an evidence bundle to any analytical object, preserving its type. */
export function attachEvidence<T>(obj: T, bundle: EvidenceBundle): WithEvidence<T> {
  return { ...obj, evidence: bundle };
}

/** Human-readable one-liner summary of the evidence posture. */
export function summarizeEvidence(bundle: EvidenceBundle): string {
  const parts = [
    `${bundle.supporting.length} supporting`,
    `${bundle.contradicting.length} contradicting`,
    `${bundle.missing.length} missing`,
    `confidence ${(bundle.confidence * 100).toFixed(0)}%`,
  ];
  return `${bundle.conclusion} — ${parts.join(", ")}`;
}

/** True when a conclusion has at least one supporting item and no unmitigated contradiction dominance. */
export function isSupported(bundle: EvidenceBundle): boolean {
  return bundle.supporting.length > 0 && bundle.confidence >= 0.5;
}
