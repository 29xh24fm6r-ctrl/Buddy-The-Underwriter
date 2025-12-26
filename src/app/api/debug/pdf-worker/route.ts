import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

export async function GET() {
  const rel = "/pdfjs/pdf.worker.min.mjs";
  const abs = path.join(process.cwd(), "public", "pdfjs", "pdf.worker.min.mjs");

  const exists = fs.existsSync(abs);
  let sizeBytes = 0;

  try {
    if (exists) sizeBytes = fs.statSync(abs).size;
  } catch {}

  return NextResponse.json({
    ok: exists,
    workerPath: rel,
    absolutePath: abs,
    sizeBytes,
  });
}
