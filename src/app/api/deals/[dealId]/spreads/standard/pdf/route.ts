import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

async function renderStandardPdf(req: NextRequest, dealId: string) {
  const token = process.env.PDF_RENDER_SECRET;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "PDF_RENDER_SECRET is not set" },
      { status: 500 },
    );
  }

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host") || "localhost:3000";
  const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");
  const previewUrl = `${protocol}://${host}/deals/${dealId}/spreads/standard/print?token=${encodeURIComponent(token)}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "x-pdf-render-token": token });
    await page.goto(previewUrl, { waitUntil: "networkidle" });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      landscape: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.6in", left: "0.5in" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="font-size:8px; width:100%; padding:0 0.5in; color:#999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial;">
          <span>Financial Analysis • Institutional Spread Package</span>
        </div>
      `,
      footerTemplate: `
        <div style="font-size:8px; width:100%; padding:0 0.5in; color:#999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial;">
          <span style="float:left;">Confidential — For Internal Use Only</span>
          <span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
    });

    const pdfArrayBuffer = Uint8Array.from(pdfBuffer).buffer;
    const pdfBlob = new Blob([pdfArrayBuffer], { type: "application/pdf" });

    return new NextResponse(pdfBlob, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="financial-analysis-${dealId}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await ctx.params;
  return renderStandardPdf(req, dealId);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await ctx.params;
  return renderStandardPdf(req, dealId);
}
