import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/deals/[dealId]/memos/[docId]/render-pdf
 *
 * Render memo JSON to PDF using Playwright and upload to storage
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; docId: string }> },
) {
  try {
    const { dealId, docId } = await ctx.params;
    // Load generated document
    const supabase = supabaseAdmin();
    const { data: doc, error: docError } = await supabase
      .from("generated_documents")
      .select("*")
      .eq("id", docId)
      .eq("deal_id", dealId)
      .eq("doc_type", "credit_memo")
      .single();

    if (docError || !doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    if (!doc.content_json || typeof doc.content_json !== "object") {
      return NextResponse.json(
        { error: "No valid content_json" },
        { status: 400 },
      );
    }

    // Build preview URL
    const host = req.headers.get("host") || "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const previewUrl = `${protocol}://${host}/deals/${dealId}/memos/${docId}/preview`;

    // Launch Playwright + Chromium
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(previewUrl, { waitUntil: "networkidle" });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      printBackground: true,
    });

    await browser.close();

    // Upload to Supabase Storage
    const fileName = `${dealId}/${doc.doc_type}_${docId}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("generated-documents")
      .upload(fileName, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // Update document with PDF path
    const { data: updated, error: updateError } = await supabase
      .from("generated_documents")
      .update({
        pdf_storage_path: fileName,
        status: "final",
      })
      .eq("id", docId)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to update document:", updateError);
      return NextResponse.json(
        { error: "Failed to update document" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      generated_document: updated,
      pdf_storage_path: fileName,
      previewUrl,
    });
  } catch (error) {
    console.error("Error rendering PDF:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
