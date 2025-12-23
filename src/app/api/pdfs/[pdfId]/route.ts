import { NextResponse } from "next/server";
import fs from "fs/promises";
import { getPdfArtifact } from "@/lib/db/pdfs";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ pdfId: string }> }) {
  const params = await ctx.params;
  const pdfId = String(params?.pdfId ?? "");
  const artifact = getPdfArtifact(pdfId);

  if (!artifact) {
    return NextResponse.json({ error: "PDF not found" }, { status: 404 });
  }

  const bytes = await fs.readFile(artifact.filePath);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdfId}.pdf"`,
    },
  });
}
