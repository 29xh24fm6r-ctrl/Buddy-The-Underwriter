/**
 * SPEC-09 — canonical decision-override row contract.
 *
 * Used by `OverrideInlineEditor`, `OverrideAuditPanel`, the override
 * endpoints, and any future override consumers. Endpoints may emit extra
 * fields, but the core shape below MUST be present.
 */
export type DealOverrideSeverity = "info" | "warning" | "critical";

export type DealOverrideRow = {
  id: string;
  deal_id: string;
  decision_snapshot_id: string | null;
  field_path: string;
  old_value: unknown | null;
  new_value: unknown | null;
  reason: string | null;
  justification: string | null;
  /** Database stores as free-form string; we accept any string for now and
   *  narrow to the canonical union via the helper. */
  severity: DealOverrideSeverity | string;
  requires_review: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DealOverridesApi = {
  ok?: boolean;
  overrides?: DealOverrideRow[];
  error?: string;
};

const KNOWN_SEVERITY = new Set<DealOverrideSeverity>([
  "info",
  "warning",
  "critical",
]);

/** Coerces an arbitrary string severity into the canonical union. */
export function normalizeOverrideSeverity(
  raw: string | null | undefined,
): DealOverrideSeverity | null {
  if (!raw) return null;
  const lower = raw.toLowerCase() as DealOverrideSeverity;
  return KNOWN_SEVERITY.has(lower) ? lower : null;
}
