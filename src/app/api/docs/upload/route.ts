import { NextResponse } from "next/server";
import Busboy from "busboy";
import fs from "fs";
import path from "path";
import { ensureDealUploadDir, buildStoredFileName } from "@/lib/docs/storage";
import { addDocument } from "@/lib/db/docRecords";
import { upsertExtract } from "@/lib/db/extractRecords";

export const runtime = "nodejs";

/**
 * POST /api/docs/upload
 * multipart/form-data:
 * - dealId: string
 * - docType: string (optional; default "UNKNOWN")
 * - files: one or multiple file fields (any field name works)
 *
 * Returns: { ok, dealId, docs: [...] }
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const dealIdHolder = { value: "DEAL-DEMO-001" };
  const docTypeHolder = { value: "UNKNOWN" };
  const uploadedDocs: any[] = [];

  const uploadPromises: Promise<void>[] = [];

  const bb = Busboy({
    headers: Object.fromEntries(req.headers.entries()),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB per file (adjust later)
      files: 25,
    },
  });

  bb.on("field", (name, val) => {
    if (name === "dealId") dealIdHolder.value = String(val || "").trim() || dealIdHolder.value;
    if (name === "docType") docTypeHolder.value = String(val || "").trim() || docTypeHolder.value;
  });

  bb.on("file", (fieldname, file, info) => {
    const { filename, mimeType } = info;

    const p = (async () => {
      const dealDir = await ensureDealUploadDir(dealIdHolder.value);
      const storedName = buildStoredFileName(filename);
      const fullPath = path.join(dealDir, storedName);

      let sizeBytes = 0;

      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(fullPath);

        file.on("data", (d: Buffer) => {
          sizeBytes += d.length;
        });

        file.on("limit", () => {
          reject(new Error(`File too large: ${filename}`));
        });

        out.on("error", reject);
        out.on("finish", () => resolve());

        file.pipe(out);
      });

      const doc = addDocument({
        dealId: dealIdHolder.value,
        name: filename || storedName,
        type: docTypeHolder.value,
        status: "RECEIVED",
        filePath: fullPath,
        mimeType,
        sizeBytes,
      });

      uploadedDocs.push(doc);

      // OPTIONAL: auto-extract immediately for FINANCIALS
      if (doc.type === "FINANCIALS") {
        const { extractFinancialsFromPdf } = await import("@/lib/extract/financials");
        const { upsertExtract } = await import("@/lib/db/extractRecords");
        const { setDocStatus } = await import("@/lib/db/docRecords");

        const out = await extractFinancialsFromPdf({
          filePath: fullPath,
          docId: doc.id,
          docName: doc.name,
        });

        upsertExtract({
          dealId: doc.dealId,
          docId: doc.id,
          docName: doc.name,
          docType: doc.type,
          fields: out.fields,
          tables: out.tables,
          evidence: out.evidence,
        });

        setDocStatus(doc.id, "REVIEWED");
      }
    })();

    uploadPromises.push(p);
  });

  const stream = req.body;
  if (!stream) {
    return NextResponse.json({ error: "Missing request body" }, { status: 400 });
  }

  // Pipe the Web stream to busboy
  const reader = stream.getReader();
  const pump = async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bb.write(value);
    }
    bb.end();
  };

  try {
    await pump();
    await Promise.all(uploadPromises);
    return NextResponse.json({
      ok: true,
      dealId: dealIdHolder.value,
      docType: docTypeHolder.value,
      docs: uploadedDocs,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Upload failed" },
      { status: 500 }
    );
  }
}
