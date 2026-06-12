/**
 * Decision route family — pure path → handler routing table.
 *
 * Consolidation of the /api/deals/[dealId]/decision/** child routes into a single catch-all
 * dispatcher (../[...path]/route.ts) for Vercel route-cap headroom. This module is PURE (no
 * handler imports, no server-only) so the mapping + method support can be unit-tested without
 * loading the server-only handler modules. The dispatcher pairs each handler name with its
 * module and uses `methods` for 405 decisions.
 *
 * The mapping mirrors the original route tree exactly — same public URLs, same params, same
 * HTTP methods. Static first-segment names (generate/latest/audit-export) take precedence over a
 * [snapshotId], exactly as static routes did over the dynamic segment before consolidation.
 */

export type DecisionMethod = "GET" | "POST";

export type DecisionRoute = {
  /** handler module key (matched to a module in the dispatcher) */
  handler: string;
  /** HTTP methods the original route exported (drives 405 for anything else) */
  methods: DecisionMethod[];
};

export type DecisionMatch = { route: DecisionRoute; params: { snapshotId?: string } };

const STATIC_TOP: Record<string, DecisionRoute> = {
  generate: { handler: "generate", methods: ["POST"] },
  latest: { handler: "latest", methods: ["GET"] },
  "audit-export": { handler: "audit-export", methods: ["GET"] },
};

const SNAPSHOT_CHILD: Record<string, DecisionRoute> = {
  attest: { handler: "attest", methods: ["POST", "GET"] },
  "committee-status": { handler: "committee-status", methods: ["GET"] },
  counterfactual: { handler: "counterfactual", methods: ["POST", "GET"] },
  diff: { handler: "diff", methods: ["GET"] },
  finalize: { handler: "finalize", methods: ["POST"] },
  pdf: { handler: "pdf", methods: ["GET"] },
  "regulator-zip": { handler: "regulator-zip", methods: ["GET"] },
};

const COMMITTEE_CHILD: Record<string, DecisionRoute> = {
  dissent: { handler: "committee/dissent", methods: ["POST", "GET"] },
  minutes: { handler: "committee/minutes", methods: ["GET", "POST"] },
  status: { handler: "committee/status", methods: ["GET"] },
  vote: { handler: "committee/vote", methods: ["POST"] },
};

const SNAPSHOT_ROUTE: DecisionRoute = { handler: "snapshot", methods: ["GET", "POST"] };

/**
 * Map the catch-all path segments (everything after /decision/) to a handler + params.
 * Returns null for any unknown path (→ 404).
 */
export function matchDecisionPath(path: string[]): DecisionMatch | null {
  if (path.length === 1) {
    const [a] = path;
    const top = STATIC_TOP[a];
    if (top) return { route: top, params: {} };
    // Otherwise a snapshot id: /decision/[snapshotId]
    return { route: SNAPSHOT_ROUTE, params: { snapshotId: a } };
  }

  if (path.length === 2) {
    const [snapshotId, child] = path;
    const route = SNAPSHOT_CHILD[child];
    return route ? { route, params: { snapshotId } } : null;
  }

  if (path.length === 3 && path[1] === "committee") {
    const [snapshotId, , leaf] = path;
    const route = COMMITTEE_CHILD[leaf];
    return route ? { route, params: { snapshotId } } : null;
  }

  return null;
}
