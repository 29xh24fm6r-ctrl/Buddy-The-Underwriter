import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export type LenderProgram = {
  id: string;
  lender_name: string;
  program_name?: string | null;
  min_dscr?: number | null;
  max_ltv?: number | null;
  asset_types?: string[] | null;
  geography?: string[] | null;
  sba_only?: boolean | null;
  score_threshold?: number | null;
  notes?: string | null;
};

export type LenderMatchInput = {
  snapshot: DealFinancialSnapshotV1;
  score: number | null;
  sbaStatus: string | null;
  assetType: string | null;
  geography: string | null;
  programs: LenderProgram[];
};

export type LenderMatchResult = {
  matched: Array<{
    lender: string;
    program: string | null;
    fitScore: number;
    reasons: string[];
  }>;
  excluded: Array<{
    lender: string;
    reason: string;
  }>;
};

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().toUpperCase();
}

function normalizeList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((v) => String(v).trim().toUpperCase()).filter(Boolean);
}

function toNum(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function matchLenders(input: LenderMatchInput): LenderMatchResult {
  const dscr = toNum(input.snapshot.dscr?.value_num);
  const ltv = toNum(input.snapshot.ltv_net?.value_num);
  const sbaStatus = normalize(input.sbaStatus);
  const assetType = normalize(input.assetType);
  const geography = normalize(input.geography);

  const matched: LenderMatchResult["matched"] = [];
  const excluded: LenderMatchResult["excluded"] = [];

  for (const program of input.programs) {
    const reasons: string[] = [];
    const exclusions: string[] = [];

    const minDscr = toNum(program.min_dscr);
    const maxLtv = toNum(program.max_ltv);
    const scoreThreshold = toNum(program.score_threshold);
    const assetTypes = normalizeList(program.asset_types);
    const geos = normalizeList(program.geography);
    const sbaOnly = Boolean(program.sba_only);

    if (minDscr !== null && dscr !== null && dscr < minDscr) {
      exclusions.push(`DSCR ${dscr.toFixed(2)} below ${minDscr.toFixed(2)}.`);
    } else if (minDscr !== null && dscr !== null) {
      reasons.push(`DSCR ${dscr.toFixed(2)} meets minimum.`);
    }

    if (maxLtv !== null && ltv !== null && ltv > maxLtv) {
      exclusions.push(`LTV ${ltv.toFixed(0)}% above ${maxLtv.toFixed(0)}%.`);
    } else if (maxLtv !== null && ltv !== null) {
      reasons.push(`LTV ${ltv.toFixed(0)}% within limit.`);
    }

    if (scoreThreshold !== null && input.score !== null && input.score < scoreThreshold) {
      exclusions.push(`Score ${input.score.toFixed(0)} below ${scoreThreshold.toFixed(0)}.`);
    } else if (scoreThreshold !== null && input.score !== null) {
      reasons.push(`Score ${input.score.toFixed(0)} meets threshold.`);
    }

    if (sbaOnly && sbaStatus !== "ELIGIBLE") {
      exclusions.push("SBA eligibility required.");
    } else if (sbaOnly && sbaStatus === "ELIGIBLE") {
      reasons.push("SBA eligible.");
    }

    if (assetTypes.length && assetType && !assetTypes.includes(assetType)) {
      exclusions.push(`Asset type ${assetType} not in program.`);
    } else if (assetTypes.length && assetType) {
      reasons.push("Asset type matches.");
    }

    if (geos.length && geography && !geos.includes(geography)) {
      exclusions.push(`Geography ${geography} not supported.`);
    } else if (geos.length && geography) {
      reasons.push("Geography matches.");
    }

    if (exclusions.length) {
      excluded.push({ lender: program.lender_name, reason: exclusions[0] });
      continue;
    }

    const fitScore = Math.round(
      100 - Math.max(0, 5 * (assetTypes.length && !assetType ? 1 : 0) + 5 * (geos.length && !geography ? 1 : 0))
    );

    matched.push({
      lender: program.lender_name,
      program: program.program_name ?? null,
      fitScore,
      reasons,
    });
  }

  matched.sort((a, b) => b.fitScore - a.fitScore);

  return { matched, excluded };
}
