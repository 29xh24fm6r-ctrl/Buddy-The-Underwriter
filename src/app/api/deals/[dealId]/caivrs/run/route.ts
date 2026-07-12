import "server-only";

/** SPEC S4 C-3 — POST /api/deals/[dealId]/caivrs/run */

import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { runCaivrsCheck } from "@/lib/integrations/caivrs/service";
import { runCaivrsVendorCheck } from "@/lib/integrations/caivrs/client";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };
const CONSENT_VERSION = "v1.0";

async function consentTextHash(): Promise<string> {
  const filePath = path.join(process.cwd(), "public", "consent-templates", "caivrs-consent-v1.md");
  const text = await readFile(filePath, "utf8");
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await requireDealAccess(rawDealId);

    const body = await req.json().catch(() => null);
    const ownershipEntityId = body?.ownership_entity_id;
    const ssnFull = body?.ssn_full;
    if (typeof ownershipEntityId !== "string" || !ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
    }
    if (typeof ssnFull !== "string" || !/^\d{9}$/.test(ssnFull)) {
      return NextResponse.json({ ok: false, error: "missing_or_invalid_ssn_full" }, { status: 400 });
    }
    if (body?.consent_acknowledged !== true) {
      return NextResponse.json({ ok: false, error: "consent_not_acknowledged" }, { status: 400 });
    }

    const result = await runCaivrsCheck(
      {
        dealId,
        bankId,
        ownershipEntityId,
        ssnFull,
        consentVersion: CONSENT_VERSION,
        consentTextHash: await consentTextHash(),
        consentAt: new Date().toISOString(),
      },
      { sb: supabaseAdmin(), vendor: { runCaivrsVendorCheck } },
    );

    if (!result.ok) {
      const status = result.reason === "CAIVRS_CREDENTIALS_MISSING" ? 503 : result.reason === "MISSING_CONSENT" ? 400 : 502;
      return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
    }

    return NextResponse.json({
      ok: true,
      check_id: result.checkId,
      status: result.status,
      hit_count: result.hitCount,
      authorization_number: result.authorizationNumber,
      reused: result.reused,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/caivrs/run]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
