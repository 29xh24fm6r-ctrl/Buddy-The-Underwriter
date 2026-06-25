// Cheap, deterministic checklist-satisfaction self-heal.
//
// SPEC-LIFECYCLE-CHECKLIST-READINESS-CANONICAL-FLOW-1.
//
// This is the focused, evidence-only half of checklist reconciliation: it
// repairs checklist rows that are STILL "missing" even though valid evidence
// already exists (a received_document_id pointing at a valid doc, or a valid
// finalized doc of a compatible type). It is intentionally cheap so it can run
// on the canonical readiness path before unfinalized_required_documents is
// counted — closing the gap where a repairable checklist could still emit a
// stale document blocker.
//
// It deliberately does NOT:
//   • seed new checklist rows
//   • run OCR / AI classification / extraction / spreads / research
//   • satisfy year-count items (IRS_*, *_<n>Y) — those need per-year doc data
//     and stay with the full year-aware reconcileDealChecklist
//   • mark inactive / failed / rejected / superseded / wrong-type docs received
//     (docValidity enforces this)
//
// Failures are non-fatal: collected into `errors` and surfaced as diagnostics.
//
// NOTE: this module intentionally does NOT import "server-only" and lazily loads
// supabaseAdmin only when no client is injected — mirroring other injectable
// DB helpers (e.g. seedIntakePrereqsCoreImpl) so it is unit-testable with a fake
// client under node:test. Real server callers still pull supabaseAdmin (and its
// server-only guard) at runtime.

import { isDocValidForChecklistKey } from "./docValidity";

const ALREADY_SATISFIED = new Set(["received", "waived", "satisfied"]);

export type ReconcileChecklistSatisfactionResult = {
  ok: boolean;
  itemsMarkedReceived: number;
  repairedKeys: string[];
  errors?: string[];
};

export type ReconcileChecklistSatisfactionArgs = {
  dealId: string;
  bankId?: string;
  /** "self_heal" (default) = cheap evidence-only repair. "full" is reserved. */
  mode?: "self_heal" | "full";
  /** Injectable client for tests; defaults to supabaseAdmin(). */
  sb?: any;
};

/**
 * A checklist key whose satisfaction depends on matching specific tax YEARS
 * (or a consecutive-year run). The cheap path can't reason about years without
 * per-doc year data, so it leaves these to the full year-aware reconcile.
 */
function isYearCountKey(itemKey: string): boolean {
  const key = String(itemKey || "").toUpperCase();
  if (!key) return true; // unknown → be conservative, skip
  if (key.startsWith("IRS_")) return true;
  if (/_(\d)Y\b/.test(key)) return true;
  return false;
}

export async function reconcileChecklistSatisfactionForDeal(
  args: ReconcileChecklistSatisfactionArgs,
): Promise<ReconcileChecklistSatisfactionResult> {
  const errors: string[] = [];
  const repairedKeys: string[] = [];
  let itemsMarkedReceived = 0;

  try {
    const sb =
      args.sb ?? (await import("@/lib/supabase/admin")).supabaseAdmin();
    const dealId = args.dealId;

    // ── Read checklist items (schema-tolerant on received_document_id) ──────
    let items: any[] = [];
    {
      const attempt = await sb
        .from("deal_checklist_items")
        .select("id, checklist_key, status, required, received_at, received_document_id")
        .eq("deal_id", dealId);
      if (attempt.error) {
        const msg = String(attempt.error.message || "");
        if (
          msg.toLowerCase().includes("does not exist") &&
          msg.includes("received_document_id")
        ) {
          const fb = await sb
            .from("deal_checklist_items")
            .select("id, checklist_key, status, required, received_at")
            .eq("deal_id", dealId);
          if (fb.error) {
            return { ok: false, itemsMarkedReceived: 0, repairedKeys: [], errors: [String(fb.error.message)] };
          }
          items = fb.data || [];
        } else {
          return { ok: false, itemsMarkedReceived: 0, repairedKeys: [], errors: [msg] };
        }
      } else {
        items = attempt.data || [];
      }
    }

    // Nothing to repair if no required item is still unsatisfied.
    const repairable = (items || []).filter(
      (it: any) =>
        it?.required === true &&
        !ALREADY_SATISFIED.has(String(it?.status ?? "")) &&
        String(it?.checklist_key ?? "").trim() &&
        !isYearCountKey(String(it?.checklist_key ?? "")),
    );
    if (repairable.length === 0) {
      return { ok: true, itemsMarkedReceived: 0, repairedKeys: [] };
    }

    // ── Read candidate documents (schema-tolerant) ─────────────────────────
    let docs: any[] = [];
    {
      const attempt = await sb
        .from("deal_documents")
        .select("id, checklist_key, canonical_type, document_type, quality_status, finalized_at")
        .eq("deal_id", dealId);
      if (attempt.error) {
        const msg = String(attempt.error.message || "");
        if (
          msg.toLowerCase().includes("does not exist") &&
          (msg.includes("canonical_type") ||
            msg.includes("quality_status") ||
            msg.includes("finalized_at") ||
            msg.includes("document_type"))
        ) {
          const fb = await sb
            .from("deal_documents")
            .select("id, checklist_key")
            .eq("deal_id", dealId);
          if (fb.error) {
            return { ok: false, itemsMarkedReceived: 0, repairedKeys: [], errors: [String(fb.error.message)] };
          }
          docs = fb.data || [];
        } else {
          return { ok: false, itemsMarkedReceived: 0, repairedKeys: [], errors: [msg] };
        }
      } else {
        docs = attempt.data || [];
      }
    }

    const docById = new Map<string, any>();
    for (const d of docs) {
      const id = String(d?.id ?? "").trim();
      if (id) docById.set(id, d);
    }

    // ── Repair pass ────────────────────────────────────────────────────────
    for (const item of repairable) {
      const itemKey = String(item.checklist_key).trim();

      // (a) Explicit pointer: received_document_id → valid linked doc.
      let evidence: any = null;
      const linkedId = String(item?.received_document_id ?? "").trim();
      if (linkedId) {
        const linked = docById.get(linkedId);
        if (linked && isDocValidForChecklistKey(linked, itemKey)) evidence = linked;
      }

      // (b) Otherwise: any valid, FINALIZED, type-compatible active doc.
      // finalized_at presence is the "committed real document" signal (we don't
      // rely on is_active, which is not a migration-defined column).
      if (!evidence) {
        evidence =
          docs.find(
            (d: any) =>
              d?.finalized_at != null && isDocValidForChecklistKey(d, itemKey),
          ) ?? null;
      }

      if (!evidence) continue;

      // Mark received + stamp satisfied_at (schema-tolerant). Never writes
      // received_document_id, so existing pointers / banker overrides are kept.
      const nowIso = new Date().toISOString();
      const basePayload = {
        status: "received",
        received_at: item?.received_at ?? nowIso,
      };
      let upd = await sb
        .from("deal_checklist_items")
        .update({ ...basePayload, satisfied_at: nowIso } as any)
        .eq("id", item.id);
      if (upd.error) {
        const msg = String(upd.error.message || "");
        if (msg.toLowerCase().includes("does not exist") && msg.includes("satisfied_at")) {
          upd = await sb
            .from("deal_checklist_items")
            .update(basePayload as any)
            .eq("id", item.id);
        }
      }
      if (upd.error) {
        errors.push(`mark_received_failed:${itemKey}:${upd.error.message}`);
        continue;
      }

      itemsMarkedReceived += 1;
      repairedKeys.push(itemKey);
    }

    return {
      ok: true,
      itemsMarkedReceived,
      repairedKeys,
      ...(errors.length ? { errors } : {}),
    };
  } catch (e) {
    return {
      ok: false,
      itemsMarkedReceived,
      repairedKeys,
      errors: [...errors, e instanceof Error ? e.message : String(e)],
    };
  }
}
