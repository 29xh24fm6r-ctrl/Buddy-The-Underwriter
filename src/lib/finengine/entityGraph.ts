/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 3
 *
 * Borrower / affiliate / guarantor ENTITY GRAPH. Nodes are the primary
 * operating company, affiliates, EPC/OC entities, and individual guarantors /
 * spouses. Edges carry ownership %, distributions, guarantees, and related-party
 * rent / fees. The graph is the substrate for true global cash flow without
 * double-counting (methods/global.ts).
 *
 * Pure — no DB, no server-only. Display names only (never deals.name /
 * borrower_name — Samaritus leak guard G5).
 */

import type { EntityNode } from "@/lib/finengine/contracts";

export type EntityEdgeType =
  | "ownership"
  | "distribution"
  | "guarantee"
  | "related_party_rent"
  | "related_party_fee";

export type EntityEdge = {
  from: string; // node id
  to: string; // node id
  type: EntityEdgeType;
  /** Ownership fraction (0..1) for 'ownership' edges. */
  pct?: number;
  /** Dollar amount for distribution / rent / fee edges (actual historical). */
  amount?: number;
};

export type EntityGraph = {
  nodes: EntityNode[];
  edges: EntityEdge[];
};

export function buildEntityGraph(nodes: EntityNode[], edges: EntityEdge[]): EntityGraph {
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      throw new Error(`[entityGraph] edge references unknown node: ${e.from} -> ${e.to}`);
    }
  }
  return { nodes, edges };
}

export function getNode(graph: EntityGraph, id: string): EntityNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/** Operating entities (primary OPCO + affiliates that are not individuals). */
export function operatingNodes(graph: EntityGraph): EntityNode[] {
  return graph.nodes.filter((n) => n.form !== "INDIVIDUAL" && n.ownerType !== "guarantor" && n.ownerType !== "spouse");
}

/** Individual guarantors / spouses (the personal side). */
export function guarantorNodes(graph: EntityGraph): EntityNode[] {
  return graph.nodes.filter((n) => n.form === "INDIVIDUAL" || n.ownerType === "guarantor" || n.ownerType === "spouse");
}

export function edgesOfType(graph: EntityGraph, type: EntityEdgeType): EntityEdge[] {
  return graph.edges.filter((e) => e.type === type);
}

/** Total actual distributions flowing INTO a (personal) node. */
export function distributionsInto(graph: EntityGraph, nodeId: string): number {
  return edgesOfType(graph, "distribution")
    .filter((e) => e.to === nodeId)
    .reduce((s, e) => s + (e.amount ?? 0), 0);
}

/** Total distributions flowing OUT of a (business) node. */
export function distributionsOutOf(graph: EntityGraph, nodeId: string): number {
  return edgesOfType(graph, "distribution")
    .filter((e) => e.from === nodeId)
    .reduce((s, e) => s + (e.amount ?? 0), 0);
}

/**
 * Related-party rent/fee edges represent intercompany flows that must be
 * eliminated on consolidation (one entity's expense is another's income).
 * Returns the total intercompany rent+fee to net out.
 */
export function intercompanyEliminations(graph: EntityGraph): number {
  return graph.edges
    .filter((e) => e.type === "related_party_rent" || e.type === "related_party_fee")
    .reduce((s, e) => s + (e.amount ?? 0), 0);
}
