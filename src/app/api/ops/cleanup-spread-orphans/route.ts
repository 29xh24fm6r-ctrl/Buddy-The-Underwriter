import "server-only";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";
import { ALL_SPREAD_TYPES } from "@/lib/financialSpreads/types";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Valid spread types that the template registry knows about (excludes STANDARD which uses a dedicated route). */
const VALID_SPREAD_TYPES = ALL_SPREAD_TYPES.filter((t) => t !== "STANDARD");

/**
 * POST /api/ops/cleanup-spread-orphans
 *
 * Mark invalid or orphaned deal_spreads rows as error.
 * Does NOT delete rows — preserves audit trail.
 *
 * Body: { deal_id?: string }  — optional: scope to one deal, or system-wide
 * Auth: requireSuperAdmin() OR WORKER_SECRET
 */
export async function POST(req: NextRequest) {
  if (!hasValidWorkerSecret(req)) {
    try {
      await requireSuperAdmin();
    } catch {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dealId = typeof body?.deal_id === "string" ? body.deal_id : null;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  try {
    // ── Step 1: Mark rows with invalid spread_type ──────────────────────
    let invalidTypeQuery = (sb as any)
      .from("deal_spreads")
      .update({
        status: "error",
        error_code: "INVALID_SPREAD_TYPE",
        error: "Spread type is not in the template registry",
        finished_at: now,
        updated_at: now,
      })
      .in("status", ["queued", "generating"])
      .not("spread_type", "in", `(${VALID_SPREAD_TYPES.join(",")})`)
      .select("id");

    if (dealId) {
      invalidTypeQuery = invalidTypeQuery.eq("deal_id", dealId);
    }

    const { data: invalidRows, error: invalidErr } = await invalidTypeQuery;
    const invalidTypeCleaned = invalidRows?.length ?? 0;

    if (invalidErr) {
      console.warn("[cleanup-spread-orphans] invalid type cleanup error:", invalidErr.message);
    }

    // ── Step 2: Mark orphaned placeholders (no active job) ──────────────
    // Use RPC or raw SQL to check for orphans: queued/generating with no active deal_spread_jobs
    const dealFilter = dealId ? `AND ds.deal_id = '${dealId}'` : "";
    const { data: orphanRows, error: orphanErr } = await (sb as any).rpc(
      "exec_sql",
      {
        query: `
          UPDATE deal_spreads ds
          SET status = 'error',
              error_code = 'ORPHANED_PLACEHOLDER',
              error = 'No active spread job — orphaned placeholder',
              finished_at = COALESCE(ds.finished_at, NOW()),
              updated_at = NOW()
          WHERE ds.status IN ('queued', 'generating')
            ${dealFilter}
            AND NOT EXISTS (
              SELECT 1 FROM deal_spread_jobs j
              WHERE j.deal_id = ds.deal_id
                AND j.bank_id = ds.bank_id
                AND j.status IN ('QUEUED', 'RUNNING')
            )
          RETURNING ds.id
        `,
      },
    ).catch(() => ({ data: null, error: { message: "exec_sql not available" } }));

    // Fallback: if exec_sql RPC is not available, use a two-step approach
    let orphansCleaned = 0;
    if (orphanErr || orphanRows === null) {
      // Step 2 fallback: find orphaned rows manually
      let orphanQuery = (sb as any)
        .from("deal_spreads")
        .select("id, deal_id, bank_id")
        .in("status", ["queued", "generating"]);

      if (dealId) {
        orphanQuery = orphanQuery.eq("deal_id", dealId);
      }

      const { data: candidates } = await orphanQuery.limit(500);

      if (candidates?.length) {
        // Check which deals have active jobs
        const dealBankPairs = new Set(
          candidates.map((c: any) => `${c.deal_id}:${c.bank_id}`),
        );
        const dealIds = [...new Set(candidates.map((c: any) => c.deal_id))];

        const { data: activeJobs } = await (sb as any)
          .from("deal_spread_jobs")
          .select("deal_id, bank_id")
          .in("deal_id", dealIds)
          .in("status", ["QUEUED", "RUNNING"]);

        const activeSet = new Set(
          (activeJobs ?? []).map((j: any) => `${j.deal_id}:${j.bank_id}`),
        );

        const orphanIds = candidates
          .filter((c: any) => !activeSet.has(`${c.deal_id}:${c.bank_id}`))
          .map((c: any) => c.id);

        if (orphanIds.length > 0) {
          const { data: updated } = await (sb as any)
            .from("deal_spreads")
            .update({
              status: "error",
              error_code: "ORPHANED_PLACEHOLDER",
              error: "No active spread job — orphaned placeholder",
              finished_at: now,
              updated_at: now,
            })
            .in("id", orphanIds)
            .in("status", ["queued", "generating"]) // re-check to avoid race
            .select("id");

          orphansCleaned = updated?.length ?? 0;
        }
      }
    } else {
      orphansCleaned = Array.isArray(orphanRows) ? orphanRows.length : 0;
    }

    // ── Emit system events ──────────────────────────────────────────────
    if (invalidTypeCleaned > 0 || orphansCleaned > 0) {
      writeSystemEvent({
        event_type: "recovery",
        severity: "info",
        source_system: "api",
        deal_id: dealId ?? undefined,
        error_code: "SPREAD_ORPHAN_CLEANUP",
        error_message: `Cleaned ${invalidTypeCleaned} invalid-type + ${orphansCleaned} orphaned spread rows`,
        payload: { dealId, invalidTypeCleaned, orphansCleaned },
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      invalid_type_cleaned: invalidTypeCleaned,
      orphans_cleaned: orphansCleaned,
      scoped_to_deal: dealId ?? "all",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
