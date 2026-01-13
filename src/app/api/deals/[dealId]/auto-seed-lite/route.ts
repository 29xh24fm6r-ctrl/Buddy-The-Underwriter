import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildChecklistForLoanType } from "@/lib/deals/checklistPresets";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function defaultRequiredYearsFromKey(checklistKeyRaw: string): number[] | null {
  const key = String(checklistKeyRaw || "").toUpperCase();
  const m = key.match(/_(\d)Y\b/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Filing-season aware: early in the year (pre-April 16), most borrowers haven't filed
  // the prior year yet, so the latest *filed* year is typically currentYear-2.
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1..12
  const day = now.getUTCDate();
  const afterApr15 = month > 4 || (month === 4 && day >= 16);
  const lastFiled = afterApr15 ? currentYear - 1 : currentYear - 2;
  const years: number[] = [];
  for (let i = 0; i < n; i++) years.push(lastFiled - i);
  return years;
}

function getRequestId(req: NextRequest) {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-buddy-request-id") ||
    crypto.randomUUID()
  );
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms),
    ),
  ]);
}

async function getChecklistTotals(sb: ReturnType<typeof supabaseAdmin>, dealId: string) {
  const [{ count: received }, { count: requiredPending }, { count: optional }] = await Promise.all([
    sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "received"),
    sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("required", true)
      .neq("status", "received"),
    sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("required", false),
  ]);

  return {
    received_total: received ?? 0,
    pending_total: requiredPending ?? 0,
    optional_total: optional ?? 0,
  };
}

/**
 * POST /api/deals/[dealId]/auto-seed-lite
 *
 * Edge-safe, fast checklist seeding for Vercel Preview reliability.
 * - Seeds checklist items from intake.loan_type
 * - Keeps the same readiness/force semantics as the canonical route
 * - Does NOT reconcile uploads or mutate deal_documents (safe for match=0)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = getRequestId(req);

  try {
    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", requestId },
        { status: 401 },
      );
    }

    const { dealId } = await ctx.params;
    const bankId = await withTimeout(getCurrentBankId(), 10_000, "getCurrentBankId");
    const sb = supabaseAdmin();

    // Tenant enforcement: ensure deal belongs to active bank.
    const { data: deal, error: dealErr } = await withTimeout(
      sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
      10_000,
      "dealLookup",
    );

    if (dealErr) {
      return NextResponse.json(
        { ok: false, error: dealErr.message, requestId },
        { status: 500 },
      );
    }

    if (!deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found", requestId },
        { status: 404 },
      );
    }

    if (deal.bank_id !== bankId) {
      return NextResponse.json(
        { ok: false, error: "tenant_mismatch", requestId },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const expectedRaw = url.searchParams.get("expected");
    const expected = expectedRaw ? Math.max(0, parseInt(expectedRaw, 10) || 0) : null;
    const partial = url.searchParams.get("partial") === "1";
    const force = url.searchParams.get("force") === "1";

    // Persisted docs = source of truth for readiness checks.
    const { count, error: countErr } = await withTimeout(
      sb
        .from("deal_documents")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId),
      12_000,
      "count_deal_documents",
    );

    if (countErr) {
      return NextResponse.json(
        { ok: false, error: countErr.message, requestId },
        { status: 500 },
      );
    }

    const persisted = count ?? 0;
    const exp = expected ?? persisted;
    const remaining = Math.max(0, exp - persisted);
    const ready = remaining === 0;

    // Admin gate (Clerk): only admins can force.
    const adminIds = (process.env.ADMIN_CLERK_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const isAdmin = userId ? adminIds.includes(userId) : false;

    if (!ready && !partial) {
      if (force && !isAdmin) {
        return NextResponse.json(
          { ok: false, error: "Forbidden", status: "forbidden", requestId },
          { status: 403 },
        );
      }
      if (!force) {
        return NextResponse.json(
          {
            ok: false,
            error: "Uploads still processing",
            remaining,
            status: "blocked",
            requestId,
          },
          { status: 409 },
        );
      }
      // force + admin => allowed
    }

    // Get intake (loan_type).
    const { data: intake, error: intakeErr } = await withTimeout(
      sb
        .from("deal_intake")
        .select("loan_type, sba_program")
        .eq("deal_id", dealId)
        .single(),
      12_000,
      "fetch_deal_intake",
    );

    if (intakeErr || !intake?.loan_type) {
      return NextResponse.json({
        ok: true,
        status: "pending",
        message: "Deal intake incomplete. Please set loan type first.",
        checklist: { seeded: 0, matched: 0, total: 0 },
        requestId,
      });
    }

    const baseRows = buildChecklistForLoanType(intake.loan_type as any);
    const checklistRowsWithBank = baseRows.map((r) => {
      const years = defaultRequiredYearsFromKey(r.checklist_key);
      return {
        deal_id: dealId,
        bank_id: bankId,
        checklist_key: r.checklist_key,
        title: r.title,
        description: r.description ?? null,
        required: r.required,
        ...(years ? { required_years: years } : null),
      } as any;
    });

    const checklistRowsWithoutYears = checklistRowsWithBank.map((r: any) => {
      const { required_years: _requiredYears, ...rest } = r || {};
      return rest;
    });

    const attempt1 = await withTimeout(
      sb
        .from("deal_checklist_items")
        .upsert(checklistRowsWithBank as any, { onConflict: "deal_id,checklist_key" }),
      20_000,
      "seed_checklist_upsert",
    );

    let seedErr = attempt1.error;
    if (seedErr) {
      const msg = String(seedErr.message || "");
      const lower = msg.toLowerCase();
      // Schema-tolerant: older DBs may not have year-aware checklist columns yet.
      if (lower.includes("required_years") && lower.includes("does not exist")) {
        const attempt2 = await withTimeout(
          sb
            .from("deal_checklist_items")
            .upsert(checklistRowsWithoutYears as any, { onConflict: "deal_id,checklist_key" }),
          20_000,
          "seed_checklist_upsert_fallback_without_required_years",
        );
        seedErr = attempt2.error;
      } else if (
        // Schema-tolerant: some DBs may have required_years as an int (not int[]).
        // Postgres then tries to cast the JSON array to int and throws:
        //   invalid input syntax for type integer: "[2024,2023,2022]"
        lower.includes("invalid input syntax for type integer") &&
        msg.includes("[") &&
        msg.includes("]")
      ) {
        const attempt2 = await withTimeout(
          sb
            .from("deal_checklist_items")
            .upsert(checklistRowsWithoutYears as any, { onConflict: "deal_id,checklist_key" }),
          20_000,
          "seed_checklist_upsert_fallback_required_years_type_mismatch",
        );
        seedErr = attempt2.error;
      }
    }

    if (seedErr) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          error: "Failed to create checklist items",
          details: seedErr.message,
          requestId,
        },
        { status: 500 },
      );
    }

    // Ensure deterministic initial state for newly seeded rows.
    try {
      const seededKeys = checklistRowsWithBank.map((r) => r.checklist_key);
      await withTimeout(
        sb
          .from("deal_checklist_items")
          .update({ status: "missing" })
          .eq("deal_id", dealId)
          .in("checklist_key", seededKeys)
          .is("status", null),
        12_000,
        "seed_status_normalization",
      );
    } catch (e) {
      console.warn("[auto-seed-lite] status normalization failed (non-fatal):", e);
    }

    const totals = await withTimeout(getChecklistTotals(sb, dealId), 15_000, "checklist_totals");

    return NextResponse.json({
      ok: true,
      status: "done",
      message: "Checklist seeded",
      checklist: {
        seeded: checklistRowsWithBank.length,
        matched: 0,
        ...totals,
      },
      requestId,
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    const status = msg.startsWith("timeout:") ? 504 : 500;
    console.error("[auto-seed-lite] error", { requestId, error: msg });
    return NextResponse.json(
      { ok: false, error: msg, requestId },
      { status },
    );
  }
}
