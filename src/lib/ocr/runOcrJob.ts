// src/lib/ocr/runOcrJob.ts
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runClaudeOcrJob } from "./runClaudeOcrJob";

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

function estimatePagesFromRaw(raw: any): number | null {
  const pages = raw?.analyzeResult?.pages;
  return Array.isArray(pages) ? pages.length : null;
}

function extractTextPreview(raw: any, maxChars = 14000): string {
  const text = typeof raw?.analyzeResult?.content === "string"
    ? raw.analyzeResult.content
    : "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export async function runOcrJob({ dealId, jobId, reqId, bankId }: RunArgs) {
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

  const jobsDir = path.join("/tmp/buddy_ocr_jobs", dealId);
  const jobPath = path.join(jobsDir, `${jobId}.json`);

  await fs.mkdir(jobsDir, { recursive: true });

  // 🔑 CREATE OR LOAD JOB (no race condition)
  let job: any;
  try {
    job = JSON.parse(await fs.readFile(jobPath, "utf-8"));
  } catch {
    job = {
      job_id: jobId,
      deal_id: dealId,
      status: "queued",
      created_at: nowIso(),
      updated_at: nowIso(),
      stored_name: null,
      result: null,
      error: null,
    };
    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");
  }

  const storedName = job.stored_name ?? job.file_name;
  if (!storedName) {
    throw new Error("Job exists but has no stored_name");
  }

  job.status = "processing";
  job.updated_at = nowIso();
  job.error = null;
  await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

  const uploadPath = path.join("/tmp/buddy_uploads", dealId, storedName);

  let fileBytes: Buffer;
  try {
    fileBytes = await fs.readFile(uploadPath);
  } catch (e: any) {
    job.status = "failed";
    job.updated_at = nowIso();
    job.error = { message: "Uploaded file not found" };
    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");
    throw e;
  }

  // 🚀 CLAUDE OCR: Use Claude if enabled
  if (process.env.USE_CLAUDE_OCR === "true") {
    const started = Date.now();
    try {
      // Infer MIME type from file extension
      const ext = storedName.toLowerCase().split(".").pop();
      const mimeType = ext === "pdf" ? "application/pdf" :
                       ext === "png" ? "image/png" :
                       ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
                       ext === "gif" ? "image/gif" :
                       ext === "webp" ? "image/webp" : "application/pdf";

      const claudeResult = await runClaudeOcrJob({
        fileBytes,
        mimeType,
        fileName: storedName,
      });

      const result = {
        engine: "claude_anthropic",
        model: "claude-sonnet-4-5-20250514",
        elapsed_ms: Date.now() - started,
        pages_estimate: claudeResult.pageCount,
        text_preview: claudeResult.text.slice(0, 14000),
        raw: { claudeText: claudeResult.text },
        classification: null,
        c4: null,
      };

      job.status = "succeeded";
      job.updated_at = nowIso();
      job.result = result;
      job.error = null;
      await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

      // 🔥 LEDGER: Log OCR completion
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
            engine: "claude",
          },
        });
      }

      return result;
    } catch (e: any) {
      job.status = "failed";
      job.updated_at = nowIso();
      job.error = safeError(e);
      await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

      // 🔥 LEDGER: Log OCR failure
      if (bankId) {
        await sb.from("deal_pipeline_ledger").insert({
          deal_id: dealId,
          bank_id: bankId,
          stage: "ocr_complete",
          status: "error",
          payload: { job_id: jobId, engine: "claude" },
          error: e?.message ?? String(e),
        });
      }

      throw e;
    }
  }

  // 🔵 AZURE DI OCR: Fallback to Azure Document Intelligence
  const endpoint =
    process.env.AZURE_DI_ENDPOINT ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const apiKey =
    process.env.AZURE_DI_KEY ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !apiKey) {
    throw new Error(
      "Missing Azure DI env vars. Set AZURE_DI_ENDPOINT/AZURE_DI_KEY (or AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/AZURE_DOCUMENT_INTELLIGENCE_KEY).",
    );
  }

  const started = Date.now();

  try {
    const { AzureKeyCredential, DocumentAnalysisClient } = await import(
      "@azure/ai-form-recognizer"
    );

    const client = new DocumentAnalysisClient(
      endpoint,
      new AzureKeyCredential(apiKey)
    );

    const poller = await client.beginAnalyzeDocument(
      "prebuilt-layout",
      fileBytes
    );

    const analyzeResult = await poller.pollUntilDone();
    const raw = { analyzeResult };

    const result = {
      engine: "azure_document_intelligence",
      model: "prebuilt-layout",
      elapsed_ms: Date.now() - started,
      pages_estimate: estimatePagesFromRaw(raw),
      text_preview: extractTextPreview(raw),
      raw,
      classification: null,
      c4: null,
    };

    job.status = "succeeded";
    job.updated_at = nowIso();
    job.result = result;
    job.error = null;

    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

    // 🔥 LEDGER: Log OCR completion
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
        },
      });
    }

    return result;
  } catch (e: any) {
    job.status = "failed";
    job.updated_at = nowIso();
    job.error = safeError(e);
    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

    // 🔥 LEDGER: Log OCR failure
    if (bankId) {
      await sb.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: bankId,
        stage: "ocr_complete",
        status: "error",
        payload: { job_id: jobId },
        error: e?.message ?? String(e),
      });
    }

    throw e;
  }
}
