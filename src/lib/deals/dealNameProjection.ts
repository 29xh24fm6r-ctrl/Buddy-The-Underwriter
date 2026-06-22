import { resolveDealLabel } from "./dealLabel";

/**
 * SPEC-DEAL-NAME-SINGLE-SOURCE-OF-TRUTH-1
 *
 * One canonical projection of a deal's name. Every surface that renders a deal
 * label (server shell, /api/deals/[dealId]/name, header card, hooks, pipeline,
 * journey rail) derives from this shape so they can never disagree.
 *
 * This module is PURE (no server-only IO) so it is trivially unit-testable.
 * The server-bound loader lives in `loadDealNameProjection.ts`.
 */
export type DealNameProjection = {
  id: string;
  /** Canonical display label, resolved via the shared `resolveDealLabel`. */
  label: string;
  source: "display_name" | "nickname" | "borrower_name" | "name" | "fallback";
  /** true only when every name field is empty and `label` is the fallback. */
  needsName: boolean;
  display_name: string | null;
  name: string | null;
  nickname: string | null;
  borrower_name: string | null;
  borrower_id: string | null;
  name_locked: boolean;
  naming_method: string | null;
  naming_source: string | null;
  named_at: string | null;
};

/**
 * Proven-live `deals` columns for name resolution.
 *
 * NEVER add `legal_name` here. The `deals` table has no `legal_name` column —
 * selecting it makes the whole PostgREST query throw, the catch swallows it as
 * "no data", and the deal shell collapses to the `Deal <short-id>` fallback on
 * every hard refresh. That single bug is what this spec exists to kill.
 */
export const DEAL_NAME_SELECT =
  "id, display_name, nickname, borrower_name, name, borrower_id, name_locked, naming_method, naming_source, named_at";

/**
 * Minimal fallback set: the four columns required to derive a label, all of
 * which have existed since `deals` was created. Used when the full select
 * errors because an OPTIONAL naming column (e.g. naming_method) is absent in
 * some environment — so a missing optional column can never collapse the name.
 */
export const DEAL_NAME_SELECT_MINIMAL =
  "id, display_name, nickname, borrower_name, name";

function norm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Build the canonical projection from a raw `deals` row. Pure and total — it
 * never throws, and tolerates rows missing any optional column (a row with only
 * `display_name` still yields a correct label with `needsName: false`).
 */
export function buildDealNameProjection(
  dealId: string,
  row: Record<string, unknown> | null | undefined,
  opts?: { intakeBorrowerName?: string | null },
): DealNameProjection {
  const r = row ?? {};
  const display_name = norm(r.display_name);
  const nickname = norm(r.nickname);
  const borrower_name = norm(r.borrower_name) ?? norm(opts?.intakeBorrowerName);
  const name = norm(r.name);

  const resolved = resolveDealLabel({
    id: dealId,
    display_name,
    nickname,
    borrower_name,
    name,
  });

  return {
    id: dealId,
    label: resolved.label,
    source: resolved.source,
    needsName: resolved.needsName,
    display_name,
    name,
    nickname,
    borrower_name,
    borrower_id: typeof r.borrower_id === "string" ? r.borrower_id : null,
    name_locked: r.name_locked === true,
    naming_method: norm(r.naming_method),
    naming_source: norm(r.naming_source),
    named_at: typeof r.named_at === "string" ? r.named_at : null,
  };
}
