import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function renderPdf(req: NextRequest, dealId: string) {
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
  const previewUrl = `${protocol}://${host}/credit-memo/${dealId}/canonical/print`;

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
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      printBackground: true,
    });

    const pdfArrayBuffer = Uint8Array.from(pdfBuffer).buffer;
    const pdfBlob = new Blob([pdfArrayBuffer], { type: "application/pdf" });

    return new NextResponse(pdfBlob, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="credit-memo-canonical-${dealId}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await ctx.params;
  return renderPdf(req, dealId);
}

// Back-compat: allow GET for manual testing.
export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await ctx.params;
  return renderPdf(req, dealId);
}
