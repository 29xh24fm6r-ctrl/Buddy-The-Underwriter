// src/lib/ocr/runOcrJob.ts
import "server-only";

type RunArgs = { dealId: string; jobId: string; reqId?: string };

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
  if (Array.isArray(pages)) return pages.length;
  return null;
}

function extractTextPreview(raw: any, maxChars = 14000): string {
  const content = raw?.analyzeResult?.content;
  const text = typeof content === "string" ? content : "";
  if (!text) return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export async function runOcrJob({ dealId, jobId, reqId }: RunArgs) {
  const endpoint = process.env.AZURE_DI_ENDPOINT;
  const apiKey = process.env.AZURE_DI_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("Missing AZURE_DI_ENDPOINT or AZURE_DI_KEY");
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // Job store
  const jobsDir = path.join("/tmp/buddy_ocr_jobs", dealId);
  const jobPath = path.join(jobsDir, `${jobId}.json`);

  // Load job
  let job: any = null;
  try {
    const raw = await fs.readFile(jobPath, "utf-8");
    job = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`OCR job not found or unreadable: ${jobPath} (${e?.message ?? String(e)})`);
  }

  const storedName = job?.stored_name ?? job?.file_name;
  if (!storedName) {
    throw new Error("Job is missing stored_name/file_name");
  }

  // Update job -> processing
  job.status = "processing";
  job.updated_at = nowIso();
  job.error = null;
  await fs.mkdir(jobsDir, { recursive: true });
  await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

  // Uploaded file path
  const uploadPath = path.join("/tmp/buddy_uploads", dealId, storedName);

  let fileBytes: Buffer;
  try {
    fileBytes = await fs.readFile(uploadPath);
  } catch (e: any) {
    const msg = `Uploaded file not found: ${uploadPath} (${e?.message ?? String(e)})`;
    job.status = "failed";
    job.updated_at = nowIso();
    job.error = { message: msg };
    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");
    throw new Error(msg);
  }

  const started = Date.now();

  try {
    // NOTE: This package must be installed: npm i @azure/ai-form-recognizer
    const { AzureKeyCredential, DocumentAnalysisClient } = await import("@azure/ai-form-recognizer");

    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));

    // prebuilt-layout = best general model for tables + text
    const poller = await client.beginAnalyzeDocument("prebuilt-layout", fileBytes);
    const analyzeResult = await poller.pollUntilDone();

    const raw = { analyzeResult };

    const text_preview = extractTextPreview(raw);
    const pages_estimate = estimatePagesFromRaw(raw);

    // Classification (now guaranteed to exist at src/lib/intelligence/classifyDocument.ts)
    let classification: any = null;
    try {
      const classifyMod = await import("@/lib/intelligence/classifyDocument");
      if (typeof (classifyMod as any).classifyDocument === "function") {
        classification = await (classifyMod as any).classifyDocument({ ocrText: text_preview });
      }
    } catch (e) {
      console.warn(`[runOcrJob ${reqId ?? ""}] classifyDocument skipped`, safeError(e));
    }

    // C4 extractor hook (optional)
    let c4: any = null;
    try {
      const c4Mod = await import("@/lib/intelligence/c4FinancialStatementExtract");
      if (typeof (c4Mod as any).c4FinancialStatementExtract === "function") {
        c4 = await (c4Mod as any).c4FinancialStatementExtract({ raw });
      }
    } catch (e) {
      console.warn(`[runOcrJob ${reqId ?? ""}] c4 extract skipped`, safeError(e));
    }

    const result = {
      engine: "azure_document_intelligence",
      model: "prebuilt-layout",
      elapsed_ms: Date.now() - started,
      pages_estimate,
      text_preview,
      raw,
      classification: classification ?? null,
      c4: c4 ?? null,
    };

    job.status = "succeeded";
    job.updated_at = nowIso();
    job.result = result;
    job.error = null;

    await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");

    return result;
  } catch (e: any) {
    const err = safeError(e);

    job.status = "failed";
    job.updated_at = nowIso();
    job.error = err;

    try {
      await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf-8");
    } catch {}

    throw e;
  }
}
