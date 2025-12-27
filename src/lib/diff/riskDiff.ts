import type { RiskOutput } from "@/lib/ai/provider";

export type RiskDiff = {
  grade: { from: string; to: string; changed: boolean };
  pricing: { totalBpsFrom: number; totalBpsTo: number; delta: number };
  factorChanges: Array<{
    label: string;
    from?: number;
    to?: number;
    delta?: number;
    status: "added" | "removed" | "changed" | "unchanged";
  }>;
};

export function diffRisk(a: RiskOutput, b: RiskOutput): RiskDiff {
  const totalA = (a.baseRateBps ?? 0) + (a.riskPremiumBps ?? 0);
  const totalB = (b.baseRateBps ?? 0) + (b.riskPremiumBps ?? 0);

  const mapA = new Map(a.factors.map((f) => [f.label, f]));
  const mapB = new Map(b.factors.map((f) => [f.label, f]));

  const labels = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();

  const factorChanges = labels.map((label) => {
    const fa = mapA.get(label);
    const fb = mapB.get(label);

    if (!fa && fb) return { label, to: fb.contribution, status: "added" as const };
    if (fa && !fb) return { label, from: fa.contribution, status: "removed" as const };

    const from = fa!.contribution;
    const to = fb!.contribution;
    const delta = Number((to - from).toFixed(4));

    if (delta === 0) return { label, from, to, delta, status: "unchanged" as const };
    return { label, from, to, delta, status: "changed" as const };
  });

  return {
    grade: { from: a.grade, to: b.grade, changed: a.grade !== b.grade },
    pricing: { totalBpsFrom: totalA, totalBpsTo: totalB, delta: totalB - totalA },
    factorChanges,
  };
}
