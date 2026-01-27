/**
 * Read Omega belief state.
 *
 * Queries omega://state/{type}/{id} for the authoritative belief
 * of an entity. Returns the belief data or a graceful failure.
 *
 * Rules:
 * - URI must exist in mapping.json state_views[]
 * - Never caches
 * - Never mutates
 * - Failure → { ok: false } only
 *
 * Server-only.
 */
import "server-only";

import { invokeOmega, type OmegaResult } from "./invokeOmega";
import { omegaStateUri, type OmegaStateType } from "./uri";
import { getFullMapping } from "./mapping";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReadOmegaStateOpts {
  stateType: OmegaStateType;
  id: string;
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read Omega state for a given entity.
 *
 * - Validates URI against mapping.json state_views
 * - Calls invokeOmega (never throws)
 * - Returns structured result
 */
export async function readOmegaState<T = unknown>(
  opts: ReadOmegaStateOpts,
): Promise<OmegaResult<T>> {
  const { stateType, id, correlationId } = opts;

  // Build URI
  const uri = omegaStateUri(stateType, id);

  // Validate that this state view exists in mapping
  const mapping = getFullMapping();
  const viewExists = mapping.state_views.some(
    (sv) => sv.omega_state_uri_template === `omega://state/${stateType}/{${getTemplateVar(stateType)}}`,
  );

  if (!viewExists) {
    return { ok: false, error: `unmapped_state_view: ${stateType}` };
  }

  return invokeOmega<T>({
    resource: uri,
    correlationId,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map state type to its template variable name. */
function getTemplateVar(stateType: OmegaStateType): string {
  switch (stateType) {
    case "underwriting_case":
    case "credit_decision":
    case "examiner_drop":
      return "dealId";
    case "borrower":
      return "borrowerId";
    case "policy_context":
      return "bankId";
  }
}
