import "server-only";

/** SPEC S4 B-2 — POST /api/deals/[dealId]/credit-pull/request */

import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { requestSoftPull } from "@/lib/integrations/creditBureau/request";
import { requestVendorSoftPull, currentVendor } from "@/lib/integrations/creditBureau/client";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const CONSENT_VERSION = "v1.0";

async function consentTextHash(): Promise<string> {
  const filePath = path.join(process.cwd(), "public", "consent-templates", "credit-pull-consent-v1.md");
  const text = await readFile(filePath, "utf8");
  return crypto.createHash("sha256").update(text).digest("hex");
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await requireDealAccess(rawDealId);

    const body = await req.json().catch(() => null);
    const ownershipEntityId = body?.ownership_entity_id;
    if (typeof ownershipEntityId !== "string" || !ownershipEntityId) {
      return NextResponse.json({ ok: false, error: "missing_ownership_entity_id" }, { status: 400 });
    }
    if (body?.consent_acknowledged !== true) {
      return NextResponse.json({ ok: false, error: "consent_not_acknowledged" }, { status: 400 });
    }

    const sb = supabaseAdmin();
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
        consentTextHash: await consentTextHash(),
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
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/credit-pull/request]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
