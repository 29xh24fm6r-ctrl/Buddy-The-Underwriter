/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 13: Relationship / Entity Graph Intelligence.
 *
 * Extends the borrower/affiliate/guarantor substrate (`entityGraph.ts`) with a
 * richer RELATIONSHIP model — the full cast (holding co, opco, EPC/OC, trust,
 * related-party lender, landlord, customer-concentration entity) and the
 * exposure edges an underwriter rolls up (cross-guarantee, cross-collateral,
 * shared debt, contingent liability).
 *
 * Additive: the existing graph is untouched (it still drives GCF math). This
 * layer sits beside it and provides (a) exposure roll-up by relationship and
 * (b) a GCF bridge so global cash flow can consume the relationship set.
 *
 * Pure — no DB, display names only.
 */

export type RelationshipRole =
  | "BORROWER"
  | "GUARANTOR"
  | "SPOUSE"
  | "AFFILIATE"
  | "HOLDING_COMPANY"
  | "OPERATING_COMPANY"
  | "EPC"
  | "OC"
  | "TRUST"
  | "RELATED_PARTY_LENDER"
  | "LANDLORD"
  | "CUSTOMER_CONCENTRATION";

/** Roles that carry operating cash flow into a global roll-up. */
export const OPERATING_ROLES: ReadonlySet<RelationshipRole> = new Set([
  "BORROWER",
  "AFFILIATE",
  "OPERATING_COMPANY",
  "OC",
  "EPC",
  "HOLDING_COMPANY",
]);

/** Roles that carry PERSONAL cash flow (the guarantor side). */
export const PERSONAL_ROLES: ReadonlySet<RelationshipRole> = new Set(["GUARANTOR", "SPOUSE", "TRUST"]);

export type ExposureEdgeType =
  | "DIRECT_OBLIGATION"
  | "CROSS_GUARANTEE"
  | "CROSS_COLLATERAL"
  | "SHARED_DEBT"
  | "CONTINGENT_LIABILITY";

export type ExposureNode = {
  id: string;
  name?: string;
  role: RelationshipRole;
  /** Annual debt service this entity carries on its own obligations. */
  annualDebtService?: number;
  /** Annual cash flow this entity contributes (operating or personal). */
  annualCashFlow?: number;
};

export type ExposureEdge = {
  from: string;
  to: string;
  type: ExposureEdgeType;
  /** Dollar exposure carried by the edge (guaranteed amount, shared balance, etc.). */
  amount?: number;
  description?: string;
};

export type RelationshipGraph = {
  nodes: ExposureNode[];
  edges: ExposureEdge[];
};

export function buildRelationshipGraph(nodes: ExposureNode[], edges: ExposureEdge[]): RelationshipGraph {
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      throw new Error(`[relationshipGraph] edge references unknown node: ${e.from} -> ${e.to}`);
    }
  }
  return { nodes, edges };
}

export function getRelationshipNode(graph: RelationshipGraph, id: string): ExposureNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export type ExposureRollup = {
  entityId: string;
  /** Direct obligations owed by the entity. */
  direct: number;
  /** Amounts the entity has cross-guaranteed for others. */
  crossGuaranteed: number;
  /** Shared-debt exposure attributed to the entity. */
  sharedDebt: number;
  /** Contingent (non-direct) liabilities. */
  contingent: number;
  /** direct + crossGuaranteed + sharedDebt + contingent. */
  total: number;
  /** Entity ids reached while rolling up (for audit). */
  reached: string[];
};

/**
 * Roll up total exposure attributable to `entityId`: everything it is directly on
 * the hook for via its OUTBOUND edges — own direct obligations, plus what it
 * cross-guarantees / cross-collateralizes / shares / is contingently liable for.
 * It does NOT absorb a guaranteed entity's own separate obligations (that would
 * double count the guarantee). `reached` records the counterparties touched.
 */
export function rollUpExposureByRelationship(graph: RelationshipGraph, entityId: string): ExposureRollup {
  const reached = new Set<string>();
  let direct = 0;
  let crossGuaranteed = 0;
  let sharedDebt = 0;
  let contingent = 0;

  for (const e of graph.edges) {
    if (e.from !== entityId) continue;
    const amt = e.amount ?? 0;
    if (e.to !== entityId) reached.add(e.to);
    switch (e.type) {
      case "DIRECT_OBLIGATION":
        direct += amt;
        break;
      case "CROSS_GUARANTEE":
        crossGuaranteed += amt;
        break;
      case "SHARED_DEBT":
        sharedDebt += amt;
        break;
      case "CONTINGENT_LIABILITY":
      case "CROSS_COLLATERAL":
        contingent += amt;
        break;
    }
  }

  return {
    entityId,
    direct,
    crossGuaranteed,
    sharedDebt,
    contingent,
    total: direct + crossGuaranteed + sharedDebt + contingent,
    reached: [...reached],
  };
}

// ── GCF bridge ────────────────────────────────────────────────────────────────

export type GcfEntity = {
  id: string;
  side: "operating" | "personal";
  annualCashFlow: number;
  annualDebtService: number;
};

/**
 * Project the relationship graph into the entity set GCF consumes: operating
 * entities and personal (guarantor) entities, each with cash flow + debt
 * service. Roles not carrying cash flow (landlord, related-party lender,
 * customer-concentration) are excluded from the GCF roll-up.
 */
export function toGcfEntities(graph: RelationshipGraph): GcfEntity[] {
  const out: GcfEntity[] = [];
  for (const n of graph.nodes) {
    const isOperating = OPERATING_ROLES.has(n.role);
    const isPersonal = PERSONAL_ROLES.has(n.role);
    if (!isOperating && !isPersonal) continue;
    out.push({
      id: n.id,
      side: isOperating ? "operating" : "personal",
      annualCashFlow: n.annualCashFlow ?? 0,
      annualDebtService: n.annualDebtService ?? 0,
    });
  }
  return out;
}

export type GlobalCashFlowRollup = {
  operatingCashFlow: number;
  personalCashFlow: number;
  totalCashFlow: number;
  totalDebtService: number;
  globalDscr: number | null;
};

/** Roll up global cash flow + DSCR from the relationship graph (no double-count: one node = one contribution). */
export function rollUpGlobalCashFlow(graph: RelationshipGraph): GlobalCashFlowRollup {
  const entities = toGcfEntities(graph);
  const operatingCashFlow = entities.filter((e) => e.side === "operating").reduce((s, e) => s + e.annualCashFlow, 0);
  const personalCashFlow = entities.filter((e) => e.side === "personal").reduce((s, e) => s + e.annualCashFlow, 0);
  const totalCashFlow = operatingCashFlow + personalCashFlow;
  const totalDebtService = entities.reduce((s, e) => s + e.annualDebtService, 0);
  const globalDscr = totalDebtService > 0 ? totalCashFlow / totalDebtService : null;
  return { operatingCashFlow, personalCashFlow, totalCashFlow, totalDebtService, globalDscr };
}
