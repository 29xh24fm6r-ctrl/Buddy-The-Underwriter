// src/lib/ocr/runOcrJob.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runGeminiOcrJob } from "./runGeminiOcrJob";

type RunArgs = { dealId: string; jobId: string; reqId?: string; bankId?: string };

function nowIso() {
  return new Date().toISOString();
}

function safeError(e: any) {
  return {
    name: e?.name ?? "Error",
    message: e?.message ?? String(e),
    stack: e?.stack ?? null,
    code: e?.code ?? null,
  };
}

function inferMimeTypeFromName(name: string | null | undefined): string {
  const fileName = String(name || "").toLowerCase();
  const ext = fileName.split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "bmp") return "image/bmp";
  return "application/pdf";
}

type PageMapRow = {
  page_number: number;
  page_text: string;
  global_char_start: number;
  global_char_end: number;
};

function buildAuditMapFromMarkers(extractedText: string): PageMapRow[] | null {
  const text = String(extractedText || "");
  const re = /^\[Page\s+(\d+)\]\s*$/gim;

  const markers: Array<{ page: number; index: number; len: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const page = Number.parseInt(m[1] || "", 10);
    if (!Number.isFinite(page) || page < 1) continue;
    markers.push({ page, index: m.index, len: m[0].length });
  }

  if (markers.length === 0) return null;

  // Sort markers by appearance, then build page slices between markers.
  markers.sort((a, b) => a.index - b.index);

  const rows: PageMapRow[] = [];
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const next = markers[i + 1];

    const contentStart = cur.index + cur.len;
    const contentEnd = next ? next.index : text.length;
    const pageText = text.slice(contentStart, contentEnd).replace(/^\s+/, "");

    rows.push({
      page_number: cur.page,
      page_text: pageText,
      global_char_start: Math.max(0, contentStart),
      global_char_end: Math.max(0, contentEnd),
    });
  }

  // If markers were out-of-order (e.g. duplicate page numbers), normalize ordering by page_number.
  rows.sort((a, b) => a.page_number - b.page_number);
  return rows;
}

export async function runOcrJob({ dealId, jobId, reqId: _reqId, bankId }: RunArgs) {
  const sb = supabaseAdmin();

  // 🔥 LEDGER: Log OCR start
  if (bankId) {
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: bankId,
      stage: "ocr_running",
      status: "pending",
      payload: { job_id: jobId },
    });
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // Prefer durable DB-backed job if it exists
  const dbJob = await (sb as any)
    .from("document_jobs")
    .select("id, deal_id, attachment_id, job_type, status")
    .eq("id", jobId)
    .maybeSingle();

  const hasDbJob = !dbJob.error && Boolean(dbJob.data);
  const attachmentId: string | null = hasDbJob ? String((dbJob.data as any).attachment_id) : null;

  // Legacy /tmp job fallback (kept for local/dev screens)
  const jobsDir = path.join("/tmp/buddy_ocr_jobs", dealId);
  const jobPath = path.join(jobsDir, `${jobId}.json`);
  await fs.mkdir(jobsDir, { recursive: true });

  let legacyJob: any = null;
  if (!hasDbJob) {
    try {
      legacyJob = JSON.parse(await fs.readFile(jobPath, "utf-8"));
    } catch {
      legacyJob = {
        job_id: jobId,
        deal_id: dealId,
        status: "queued",
        created_at: nowIso(),
        updated_at: nowIso(),
        stored_name: null,
        result: null,
        error: null,
      };
      await fs.writeFile(jobPath, JSON.stringify(legacyJob, null, 2), "utf-8");
    }

    legacyJob.status = "processing";
    legacyJob.updated_at = nowIso();
    legacyJob.error = null;
    await fs.writeFile(jobPath, JSON.stringify(legacyJob, null, 2), "utf-8");
  }

  // Determine storage source
  const storedName = legacyJob?.stored_name ?? legacyJob?.file_name ?? null;
  let fileBytes: Buffer | null = null;
  let mimeType: string | null = null;
  let sourceFileName: string | null = storedName;
  let resolvedAttachmentId: string | null = attachmentId;
  let storageBucket: string | null = null;
  let storagePath: string | null = null;

  // If we have an attachment id, prefer deal_documents storage download.
  if (resolvedAttachmentId) {
    // 1) Banker/canonical docs
    const docRes = await (sb as any)
      .from("deal_documents")
      .select("id, storage_bucket, storage_path, original_filename, mime_type")
      .eq("deal_id", dealId)
      .eq("id", resolvedAttachmentId)
      .maybeSingle();

    if (!docRes.error && docRes.data) {
      storageBucket = String(docRes.data.storage_bucket || "deal-documents");
      storagePath = String(docRes.data.storage_path || "");
      sourceFileName = String(docRes.data.original_filename || storagePath || "");
      mimeType = String(docRes.data.mime_type || inferMimeTypeFromName(sourceFileName));

      const dl = await sb.storage.from(storageBucket).download(storagePath);
      if (dl.error) throw new Error(`storage_download_failed:${dl.error.message}`);
      fileBytes = Buffer.from(await dl.data.arrayBuffer());
    } else {
      // 2) Borrower uploads
      const attRes = await (sb as any)
        .from("borrower_attachments")
        .select("id, application_id, file_key, stored_name, mime_type")
        .eq("application_id", dealId)
        .eq("id", resolvedAttachmentId)
        .maybeSingle();

      if (attRes.error || !attRes.data) {
        throw new Error("attachment_not_found_for_job");
      }

      const fileKey = String(attRes.data.file_key || "");
      if (!fileKey) throw new Error("attachment_missing_file_key");

      storageBucket = "deal_uploads";
      storagePath = fileKey;
      sourceFileName = String(attRes.data.stored_name || fileKey);
      mimeType = String(attRes.data.mime_type || inferMimeTypeFromName(sourceFileName));

      const dl = await sb.storage.from(storageBucket).download(storagePath);
      if (dl.error) throw new Error(`storage_download_failed:${dl.error.message}`);
      fileBytes = Buffer.from(await dl.data.arrayBuffer());
    }
  } else {
    // Try to resolve legacy stored_name into canonical deal_documents id
    if (storedName) {
      const docRes = await (sb as any)
        .from("deal_documents")
        .select("id, storage_bucket, storage_path, original_filename, mime_type")
        .eq("deal_id", dealId)
        .eq("storage_path", storedName)
        .maybeSingle();

      if (!docRes.error && docRes.data) {
        resolvedAttachmentId = String(docRes.data.id);
        storageBucket = String(docRes.data.storage_bucket || "deal-documents");
        storagePath = String(docRes.data.storage_path || "");
        sourceFileName = String(docRes.data.original_filename || storagePath || storedName);
        mimeType = String(docRes.data.mime_type || inferMimeTypeFromName(sourceFileName));

        const dl = await sb.storage.from(storageBucket).download(storagePath);
        if (dl.error) throw new Error(`storage_download_failed:${dl.error.message}`);
        fileBytes = Buffer.from(await dl.data.arrayBuffer());
      }

      // If not in deal_documents, try borrower_attachments.file_key match
      if (!fileBytes) {
        const attRes = await (sb as any)
          .from("borrower_attachments")
          .select("id, application_id, file_key, stored_name, mime_type")
          .eq("application_id", dealId)
          .eq("file_key", storedName)
          .maybeSingle();

        if (!attRes.error && attRes.data) {
          resolvedAttachmentId = String(attRes.data.id);
          storageBucket = "deal_uploads";
          storagePath = String(attRes.data.file_key || storedName);
          sourceFileName = String(attRes.data.stored_name || storagePath || storedName);
          mimeType = String(attRes.data.mime_type || inferMimeTypeFromName(sourceFileName));

          const dl = await sb.storage.from(storageBucket).download(storagePath);
          if (dl.error) throw new Error(`storage_download_failed:${dl.error.message}`);
          fileBytes = Buffer.from(await dl.data.arrayBuffer());
        }
      }
    }

    // Final fallback: /tmp upload bytes
    if (!fileBytes) {
      if (!storedName) {
        throw new Error("Job exists but has no stored_name");
      }
      const uploadPath = path.join("/tmp/buddy_uploads", dealId, storedName);
      try {
        fileBytes = await fs.readFile(uploadPath);
      } catch (e: any) {
        if (legacyJob) {
          legacyJob.status = "failed";
          legacyJob.updated_at = nowIso();
          legacyJob.error = { message: "Uploaded file not found" };
          await fs.writeFile(jobPath, JSON.stringify(legacyJob, null, 2), "utf-8");
        }
        throw e;
      }
      mimeType = inferMimeTypeFromName(storedName);
    }

    mimeType = mimeType || inferMimeTypeFromName(storedName);
  }

  // 🚀 GEMINI OCR: Use Gemini if enabled (priority over Mistral/Claude/Azure)
  if (process.env.USE_GEMINI_OCR !== "true") {
    throw new Error(
      "Gemini OCR is required. Set USE_GEMINI_OCR=\"true\". (Mistral/Azure DI OCR are disabled.)",
    );
  }

  {
    const started = Date.now();
    try {
      if (!fileBytes) {
        throw new Error("ocr_missing_file_bytes");
      }

      const finalMimeType = mimeType || inferMimeTypeFromName(sourceFileName || storedName);

      const geminiResult = await runGeminiOcrJob({
        fileBytes,
        mimeType: finalMimeType,
        fileName: sourceFileName || storedName || undefined,
      });

      const auditMap = buildAuditMapFromMarkers(geminiResult.text);
      const findings = [
        { kind: "engine", note: "gemini_google" },
        { kind: "model", note: geminiResult.model || null },
        { kind: "page_markers", note: auditMap ? "present" : "missing" },
      ];

      const result = {
        engine: "gemini_google",
        model: geminiResult.model,
        elapsed_ms: Date.now() - started,
        pages_estimate: geminiResult.pageCount,
        text_preview: geminiResult.text.slice(0, 14000),
        raw: {
          geminiText: geminiResult.text,
          auditMap,
          findings,
        },
        classification: null,
        c4: null,
      };

      // Persist durable OCR result if we have an attachment id
      if (resolvedAttachmentId) {
        const up = await (sb as any).from("document_ocr_results").upsert(
          {
            deal_id: dealId,
            attachment_id: resolvedAttachmentId,
            provider: "gemini_google",
            status: "SUCCEEDED",
            raw_json: result.raw,
            extracted_text: geminiResult.text,
            tables_json: null,
            error: null,
            updated_at: nowIso(),
          },
          { onConflict: "attachment_id" },
        );
        if (up.error) throw up.error;

        // Best-effort: write page map from [Page N] markers (enables true page citations)
        if (auditMap && auditMap.length) {
          await (sb as any)
            .from("document_ocr_page_map")
            .delete()
            .eq("deal_id", dealId)
            .eq("attachment_id", resolvedAttachmentId);

          const rows = auditMap.map((p) => ({
            deal_id: dealId,
            attachment_id: resolvedAttachmentId,
            page_number: p.page_number,
            page_text: p.page_text,
            global_char_start: p.global_char_start,
            global_char_end: p.global_char_end,
          }));

          const ins = await (sb as any).from("document_ocr_page_map").insert(rows);
          if (ins.error) throw ins.error;
        }
      }

      // Update durable job metadata/status if applicable
      if (hasDbJob) {
        const upd = await (sb as any)
          .from("document_jobs")
          .update({
            status: "SUCCEEDED",
            updated_at: nowIso(),
            error: null,
            metadata: {
              engine: "gemini_google",
              model: result.model,
              pages_estimate: result.pages_estimate,
              storage_bucket: storageBucket,
              storage_path: storagePath,
              attachment_id: resolvedAttachmentId,
              auditMap,
              findings,
            },
          })
          .eq("id", jobId);
        if (upd.error) throw upd.error;
      }

      // Update legacy /tmp job record if applicable
      if (legacyJob) {
        legacyJob.status = "succeeded";
        legacyJob.updated_at = nowIso();
        legacyJob.result = result;
        legacyJob.error = null;
        await fs.writeFile(jobPath, JSON.stringify(legacyJob, null, 2), "utf-8");
      }

      if (bankId) {
        await sb.from("deal_pipeline_ledger").insert({
          deal_id: dealId,
          bank_id: bankId,
          stage: "ocr_complete",
          status: "ok",
          payload: {
            job_id: jobId,
            pages: result.pages_estimate,
            elapsed_ms: result.elapsed_ms,
            engine: "gemini",
          },
        });
      }

      return result;
    } catch (e: any) {
      if (hasDbJob) {
        await (sb as any)
          .from("document_jobs")
          .update({
            status: "FAILED",
            updated_at: nowIso(),
            error: e?.message ?? String(e),
          })
          .eq("id", jobId);
      }

      if (legacyJob) {
        legacyJob.status = "failed";
        legacyJob.updated_at = nowIso();
        legacyJob.error = safeError(e);
        await fs.writeFile(jobPath, JSON.stringify(legacyJob, null, 2), "utf-8");
      }

      if (bankId) {
        await sb.from("deal_pipeline_ledger").insert({
          deal_id: dealId,
          bank_id: bankId,
          stage: "ocr_complete",
          status: "error",
          payload: { job_id: jobId, engine: "gemini" },
          error: e?.message ?? String(e),
        });
      }

      throw e;
    }
  }
}
