// src/lib/packs/requirements/evaluate.ts

import type {
  CoverageSummary,
  PackRequirement,
  RequirementEvidence,
  RequirementResult,
  RequirementRule,
  RequirementStatus,
} from "./types";

function allDocs(packIndex: any): any[] {
  return packIndex?.allDocs ?? [];
}

function toEvidence(d: any): RequirementEvidence {
  return {
    doc_id: d.doc_id,
    doc_type: d.doc_type,
    title: d.title ?? d.file_name,
    tax_year: d.tax_year ?? null,
    confidence: d.confidence ?? null,
  };
}

function docsByType(packIndex: any, docType: string): any[] {
  return allDocs(packIndex).filter((d) => d.doc_type === docType);
}

function evalRule(packIndex: any, rule: RequirementRule): { ok: boolean; message: string; evidence: any[]; missingCount: number } {
  switch (rule.rule) {
    case "DOC_TYPE_MIN_COUNT": {
      const docs = docsByType(packIndex, rule.docType);
      const ok = docs.length >= rule.minCount;
      const missing = Math.max(0, rule.minCount - docs.length);
      return {
        ok,
        message: ok ? `Found ${docs.length}.` : `Need ${rule.minCount}, found ${docs.length}.`,
        evidence: docs,
        missingCount: missing,
      };
    }

    case "DOC_TYPE_PER_YEAR": {
      const minPerYear = rule.minPerYear ?? 1;
      const docs = docsByType(packIndex, rule.docType);
      const byYear = new Map<number, any[]>();
      for (const d of docs) {
        const y = d.tax_year;
        if (!y) continue;
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(d);
      }

      let missingYears: number[] = [];
      let evidence: any[] = [];

      for (const y of rule.years) {
        const yearDocs = byYear.get(y) ?? [];
        evidence.push(...yearDocs);
        if (yearDocs.length < minPerYear) missingYears.push(y);
      }

      const ok = missingYears.length === 0;
      return {
        ok,
        message: ok
          ? `Found ${rule.years.length}/${rule.years.length} years.`
          : `Missing year(s): ${missingYears.join(", ")}.`,
        evidence,
        missingCount: missingYears.length * minPerYear,
      };
    }

    case "ANY_OF": {
      const attempts = rule.anyOf.map((r) => evalRule(packIndex, r));
      const winner = attempts.find((a) => a.ok);
      if (winner) return winner;
      // none ok: return the "best" attempt (fewest missing)
      const best = attempts.slice().sort((a, b) => a.missingCount - b.missingCount)[0];
      return {
        ok: false,
        message: `Need any of: (${rule.anyOf.length}). Best match: ${best?.message ?? "none"}`,
        evidence: best?.evidence ?? [],
        missingCount: best?.missingCount ?? 1,
      };
    }

    case "ALL_OF": {
      const parts = rule.allOf.map((r) => evalRule(packIndex, r));
      const ok = parts.every((p) => p.ok);
      const evidence = parts.flatMap((p) => p.evidence);
      const missingCount = parts.reduce((sum, p) => sum + (p.ok ? 0 : p.missingCount), 0);
      return {
        ok,
        message: ok ? "All satisfied." : parts.filter((p) => !p.ok).map((p) => p.message).join(" "),
        evidence,
        missingCount,
      };
    }
  }
}

export function evaluateRequirements(packIndex: any, reqs: PackRequirement[]): RequirementResult[] {
  return reqs.map((req) => {
    if (!req.required) {
      // optional: mark satisfied if present, otherwise optional
      const res = evalRule(packIndex, req.rule);
      const status: RequirementStatus = res.ok ? "SATISFIED" : "OPTIONAL";
      return {
        requirement: req,
        status,
        satisfiedCount: res.evidence.length,
        missingCount: res.ok ? 0 : 0,
        evidence: res.evidence.map(toEvidence),
        message: res.ok ? res.message : "Optional item not present.",
      };
    }

    const res = evalRule(packIndex, req.rule);

    let status: RequirementStatus = "MISSING";
    if (res.ok) status = "SATISFIED";
    else if (res.evidence.length > 0) status = "PARTIAL";

    return {
      requirement: req,
      status,
      satisfiedCount: res.evidence.length,
      missingCount: res.missingCount,
      evidence: res.evidence.map(toEvidence),
      message: res.message,
    };
  });
}

export function summarizeCoverage(results: RequirementResult[]): CoverageSummary {
  let satisfied = 0, missing = 0, partial = 0, optional = 0, totalRequired = 0;

  for (const r of results) {
    if (r.requirement.required) totalRequired += 1;
    if (r.status === "SATISFIED") satisfied += 1;
    else if (r.status === "MISSING") missing += 1;
    else if (r.status === "PARTIAL") partial += 1;
    else optional += 1;
  }

  return { satisfied, missing, partial, optional, totalRequired };
}