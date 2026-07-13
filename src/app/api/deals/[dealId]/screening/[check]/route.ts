import "server-only";

/**
 * ARC-00 (SPEC S4 B-2/C-3) — POST /api/deals/[dealId]/screening/[check]
 * check ∈ {"caivrs", "credit-pull", "sam"}
 *
 * Consolidates the 3 previously-separate screening-check route files
 * (caivrs/run, credit-pull/request, sam/run — no UI caller used any of
 * them by their old paths, confirmed before this rename) into one
 * dynamic-segment dispatcher — route/page slot budget discipline (see the
 * Drift Log).
 */

import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";
import { runCaivrsCheck } from "@/lib/integrations/caivrs/service";
import { runCaivrsVendorCheck } from "@/lib/integrations/caivrs/client";
import { requestSoftPull } from "@/lib/integrations/creditBureau/request";
import { requestVendorSoftPull, currentVendor } from "@/lib/integrations/creditBureau/client";
import { runSamCheck } from "@/lib/integrations/samGov/service";
import { fetchSamExclusions } from "@/lib/integrations/samGov/client";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; check: string }> };
const CONSENT_VERSION = "v1.0";

async function consentTextHash(templateFile: string): Promise<string> {
  const filePath = path.join(process.cwd(), "public", "consent-templates", templateFile);
  const text = await readFile(filePath, "utf8");
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId, check } = await ctx.params;
    const { dealId, bankId } = await assertDealAccess(rawDealId);
    const sb = supabaseAdmin();
    const body = await req.json().catch(() => null);

    if (check === "caivrs") {
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
          consentTextHash: await consentTextHash("caivrs-consent-v1.md"),
          consentAt: new Date().toISOString(),
        },
        { sb: sb as any, vendor: { runCaivrsVendorCheck } },
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
    }

    if (check === "credit-pull") {
      const ownershipEntityId = body?.ownership_entity_id;
      if (typeof ownershipEntityId !== "string" || !ownershipEntityId) {
        return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
      }
      if (body?.consent_acknowledged !== true) {
        return NextResponse.json({ ok: false, error: "consent_not_acknowledged" }, { status: 400 });
      }

      const { data: owner } = await sb
        .from("ownership_entities")
        .select("display_name, tax_id_last4, date_of_birth, home_address_street, home_address_city, home_address_state, home_address_zip")
        .eq("id", ownershipEntityId)
        .eq("deal_id", dealId)
        .maybeSingle();

      if (!owner) {
        return NextResponse.json({ ok: false, error: "owner_not_found" }, { status: 404 });
      }
      if (!owner.tax_id_last4 || !owner.date_of_birth || !owner.home_address_street) {
        return NextResponse.json({ ok: false, error: "owner_profile_incomplete" }, { status: 422 });
      }

      const [firstName, ...rest] = (owner.display_name ?? "").trim().split(/\s+/);
      const lastName = rest.join(" ") || firstName;

      const result = await requestSoftPull(
        {
          dealId,
          bankId,
          ownershipEntityId,
          taxIdLast4: owner.tax_id_last4,
          dateOfBirth: owner.date_of_birth,
          firstName: firstName || "Unknown",
          lastName,
          address: {
            line1: owner.home_address_street,
            city: owner.home_address_city ?? "",
            state: owner.home_address_state ?? "",
            postalCode: owner.home_address_zip ?? "",
          },
          consentVersion: CONSENT_VERSION,
          consentTextHash: await consentTextHash("credit-pull-consent-v1.md"),
          consentIp: req.headers.get("x-forwarded-for"),
          consentUserAgent: req.headers.get("user-agent"),
          consentAt: new Date().toISOString(),
        },
        { sb, vendor: { requestVendorSoftPull, currentVendor } },
      );

      if (!result.ok) {
        const status = result.reason === "MISSING_CONSENT" ? 400 : 502;
        return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
      }

      return NextResponse.json({ ok: true, pull_id: result.pullId, status: result.status, reused: result.reused, abnormality_count: result.abnormalityCount });
    }

    if (check === "sam") {
      const ownershipEntityId: string | undefined = body?.ownership_entity_id;
      const borrowerId: string | undefined = body?.borrower_id;
      if (!ownershipEntityId && !borrowerId) {
        return NextResponse.json({ ok: false, error: "missing_ownership_entity_id_or_borrower_id" }, { status: 400 });
      }

      let name: string | null = null;
      let ein: string | null = null;
      if (ownershipEntityId) {
        const { data: owner } = await sb.from("ownership_entities").select("display_name").eq("id", ownershipEntityId).eq("deal_id", dealId).maybeSingle();
        if (!owner) return NextResponse.json({ ok: false, error: "owner_not_found" }, { status: 404 });
        name = owner.display_name;
      } else if (borrowerId) {
        const { data: borrower } = await sb.from("borrowers").select("legal_name, ein").eq("id", borrowerId).maybeSingle();
        if (!borrower) return NextResponse.json({ ok: false, error: "borrower_not_found" }, { status: 404 });
        name = borrower.legal_name;
        ein = borrower.ein;
      }

      if (!name) {
        return NextResponse.json({ ok: false, error: "subject_missing_name" }, { status: 422 });
      }

      const result = await runSamCheck(
        { dealId, bankId, ownershipEntityId: ownershipEntityId ?? null, borrowerId: borrowerId ?? null, name, ein },
        { sb, vendor: { fetchSamExclusions } },
      );

      if (!result.ok) {
        const status = result.reason === "MISSING_SUBJECT" ? 400 : 502;
        return NextResponse.json({ ok: false, error: result.reason, detail: result.detail }, { status });
      }

      return NextResponse.json({ ok: true, check_id: result.checkId, status: result.status, hit_count: result.hitCount, reused: result.reused });
    }

    return NextResponse.json({ ok: false, error: `unsupported_check: ${check}` }, { status: 400 });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/screening/[check]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
