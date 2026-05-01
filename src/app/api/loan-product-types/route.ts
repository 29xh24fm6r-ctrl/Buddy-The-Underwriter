import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getProductTypesForBank } from "@/lib/loanRequests/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sibling cockpit-supporting routes use 60s. We don't need that much, but the
// default plan ceiling can be lower than the frontend's 15s AbortController,
// which silently truncates the response — which is exactly what was happening:
// no terminal status in Vercel logs and the section permanently saw a timeout.
export const maxDuration = 30;

/**
 * Run a promise with a hard timeout. Resolves with `null` on timeout / failure,
 * never throws. Used to bound each step of the route so a single slow call
 * (cold-start auth, hung membership provisioning) can't pin the whole request
 * past the frontend's AbortController ceiling.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<{ ok: true; value: T } | { ok: false; reason: "timeout" | "error"; error?: string; ms: number }> {
  const started = Date.now();
  let timer: NodeJS.Timeout | null = null;
  try {
    const value = await Promise.race<T>([
      p,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return { ok: true, value };
  } catch (err: any) {
    if (timer) clearTimeout(timer);
    const elapsed = Date.now() - started;
    const isTimeout = String(err?.message ?? "").startsWith("timeout:");
    return {
      ok: false,
      reason: isTimeout ? "timeout" : "error",
      error: err?.message ?? String(err),
      ms: elapsed,
    };
  }
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || `lpt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const t0 = Date.now();
  console.log("[loan-product-types] start", { requestId });

  try {
    let bankId = req.nextUrl.searchParams.get("bankId") || null;
    let bankIdSource: "query" | "auth" | "none" = bankId ? "query" : "none";
    let bankResolveMs = 0;
    let bankResolveStatus: "ok" | "timeout" | "error" | "skipped" = "skipped";

    // Auto-resolve bank_id from authenticated banker context only if not provided.
    // Bound this step at 5s so a cold-start Clerk + profile/membership provisioning
    // chain can't pin the whole request — fall back to global product types instead.
    if (!bankId) {
      const tBank = Date.now();
      const importRes = await withTimeout(
        import("@/lib/tenant/getCurrentBankId"),
        2_000,
        "import_getCurrentBankId",
      );
      if (importRes.ok) {
        const resolveRes = await withTimeout(
          importRes.value.getCurrentBankId(),
          5_000,
          "getCurrentBankId",
        );
        bankResolveMs = Date.now() - tBank;
        if (resolveRes.ok) {
          bankId = resolveRes.value;
          bankIdSource = "auth";
          bankResolveStatus = "ok";
        } else {
          bankResolveStatus = resolveRes.reason;
          console.warn("[loan-product-types] bank resolve failed", {
            requestId,
            reason: resolveRes.reason,
            error: resolveRes.error,
            ms: bankResolveMs,
          });
        }
      } else {
        bankResolveMs = Date.now() - tBank;
        bankResolveStatus = importRes.reason;
        console.warn("[loan-product-types] getCurrentBankId import failed", {
          requestId,
          reason: importRes.reason,
          error: importRes.error,
          ms: bankResolveMs,
        });
      }
    }

    // Fetch product types. Bound at 8s — DB queries on this path are simple
    // selects and should resolve in well under a second; anything slower is
    // pathological and we'd rather degrade than hang.
    const tProducts = Date.now();
    const productsRes = await withTimeout(
      getProductTypesForBank(bankId),
      8_000,
      "getProductTypesForBank",
    );
    const productsMs = Date.now() - tProducts;

    if (!productsRes.ok) {
      console.error("[loan-product-types] product fetch failed", {
        requestId,
        reason: productsRes.reason,
        error: productsRes.error,
        ms: productsMs,
        bankId,
        bankIdSource,
        bankResolveStatus,
      });
      return NextResponse.json(
        {
          ok: false,
          error: productsRes.reason === "timeout" ? "product_fetch_timeout" : "product_fetch_failed",
          details: productsRes.error,
          requestId,
        },
        { status: 503 },
      );
    }

    const productTypes = productsRes.value;
    const elapsed = Date.now() - t0;
    console.log("[loan-product-types] ok", {
      requestId,
      elapsed_ms: elapsed,
      bankIdSource,
      bankResolveStatus,
      bank_resolve_ms: bankResolveMs,
      products_ms: productsMs,
      productCount: productTypes.length,
      degraded: bankResolveStatus !== "ok" && bankIdSource !== "query",
    });

    return NextResponse.json({
      ok: true,
      productTypes,
      // Surface a degraded flag so the UI / observability can see when we
      // returned global fallback rather than bank-specific overrides.
      degraded: bankResolveStatus !== "ok" && bankIdSource !== "query",
      requestId,
    });
  } catch (e: any) {
    const elapsed = Date.now() - t0;
    console.error("[loan-product-types] uncaught", {
      requestId,
      elapsed_ms: elapsed,
      error: e?.message ?? String(e),
      stack: e?.stack,
    });
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error", requestId },
      { status: 500 },
    );
  }
}
