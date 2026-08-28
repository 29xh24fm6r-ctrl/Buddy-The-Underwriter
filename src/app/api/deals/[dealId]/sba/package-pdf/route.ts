import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  isPdfSignature,
  parseSbaPackagePdfPath,
} from "@/lib/sba/sbaPackageArtifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

function json(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Params },
): Promise<Response> {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return json(access.error === "deal_not_found" ? 404 : 403, access.error);
    }

    const packageId = new URL(req.url).searchParams.get("packageId")?.trim();
    if (!packageId) return json(400, "package_id_required");

    const sb = supabaseAdmin();
    const { data: row, error: rowError } = await sb
      .from("buddy_sba_packages")
      .select("id, pdf_url")
      .eq("deal_id", dealId)
      .eq("id", packageId)
      .maybeSingle();

    if (rowError) {
      console.error("[sba/package-pdf] package lookup failed");
      return json(500, "package_lookup_failed");
    }
    if (!row) return json(404, "package_not_found");

    const pdfPath = parseSbaPackagePdfPath(dealId, row.pdf_url);
    if (!pdfPath) {
      console.error("[sba/package-pdf] invalid or missing package PDF path");
      return json(409, "package_pdf_not_ready");
    }

    const { data: blob, error: downloadError } = await sb.storage
      .from("deal-documents")
      .download(pdfPath);

    if (downloadError || !blob) {
      console.error("[sba/package-pdf] package PDF download failed");
      return json(404, "package_pdf_not_found");
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isPdfSignature(bytes)) {
      console.error("[sba/package-pdf] stored artifact is not a PDF");
      return json(409, "package_pdf_invalid");
    }

    const safePackageId = packageId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="buddy-sba-package-${safePackageId}.pdf"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "[sba/package-pdf] unexpected failure",
      error instanceof Error ? error.message : "unknown_error",
    );
    return json(500, "package_pdf_failed");
  }
}
