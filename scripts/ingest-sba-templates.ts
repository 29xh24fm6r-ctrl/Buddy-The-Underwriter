#!/usr/bin/env tsx
/**
 * ARC-00 Phase 0.C — Official SBA/IRS template ingestion pipeline.
 *
 * Downloads current official PDFs from sba.gov / irs.gov, parses their
 * AcroForm fields, commits the PDF to public/sba-templates/, and upserts one
 * global (bank_id-agnostic) row per form into bank_document_templates with
 * metadata = { revision, source_url, sha256, field_count, fill_strategy }.
 *
 * Principle #28 (ARC-00): official templates are versioned artifacts.
 * Revision date + sha256 are recorded at ingestion time and the renderer
 * refuses to fill a form when the stored revision no longer matches the
 * SBA-published current revision list. This script never fabricates a PDF —
 * if a source can't be fetched or the PDF has no AcroForm fields it is
 * surfaced (fill_strategy: "overlay" + a TODO) rather than guessed at.
 *
 * Usage:
 *   npx tsx scripts/ingest-sba-templates.ts               # ingest all forms
 *   npx tsx scripts/ingest-sba-templates.ts --form SBA_159 # single form
 *   npx tsx scripts/ingest-sba-templates.ts --dry-run      # fetch+parse, no DB writes / no file commit
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

type TemplateSource = {
  templateKey: string;
  name: string;
  /**
   * SBA/IRS forms page for this form — NOT hardcoded to a specific PDF
   * revision. The script must resolve the current direct-download PDF URL
   * from this page at execution time (AP-6: never hardcode a revision from
   * a spec doc — the source page is the ground truth, this file is not).
   */
  sourcePageUrl: string;
};

// Bank-agnostic template set required by ARC-00 Phase 0.C.
const SOURCES: TemplateSource[] = [
  { templateKey: "SBA_1919", name: "SBA Form 1919 — Borrower Information Form", sourcePageUrl: "https://www.sba.gov/document/sba-form-1919-borrower-information-form" },
  { templateKey: "SBA_413", name: "SBA Form 413 — Personal Financial Statement", sourcePageUrl: "https://www.sba.gov/document/sba-form-413-personal-financial-statement" },
  { templateKey: "SBA_912", name: "SBA Form 912 — Statement of Personal History", sourcePageUrl: "https://www.sba.gov/document/sba-form-912-statement-personal-history" },
  { templateKey: "SBA_1244", name: "SBA Form 1244 — Application for Section 504 Loan", sourcePageUrl: "https://www.sba.gov/document/sba-form-1244-504-loan-application" },
  { templateKey: "SBA_159", name: "SBA Form 159 — Fee Disclosure and Compensation Agreement", sourcePageUrl: "https://www.sba.gov/document/sba-form-159-fee-disclosure-compensation-agreement" },
  { templateKey: "SBA_148", name: "SBA Form 148 — Unconditional Guarantee", sourcePageUrl: "https://www.sba.gov/document/sba-form-148-unconditional-guarantee" },
  { templateKey: "SBA_148L", name: "SBA Form 148L — Limited Guarantee", sourcePageUrl: "https://www.sba.gov/document/sba-form-148l-limited-guarantee" },
  { templateKey: "SBA_601", name: "SBA Form 601 — Agreement of Compliance", sourcePageUrl: "https://www.sba.gov/document/sba-form-601-agreement-compliance-hud-regulations" },
  { templateKey: "SBA_155", name: "SBA Form 155 — Standby Creditor's Agreement", sourcePageUrl: "https://www.sba.gov/document/sba-form-155-standby-creditors-agreement" },
  { templateKey: "IRS_4506C", name: "IRS Form 4506-C — IVES Request for Transcript of Tax Return", sourcePageUrl: "https://www.irs.gov/forms-pubs/about-form-4506-c" },
];

const TEMPLATE_DIR = path.join(process.cwd(), "public", "sba-templates");

type IngestResult = {
  templateKey: string;
  ok: boolean;
  reason?: string;
  revision?: string;
  sha256?: string;
  fieldCount?: number;
  fillStrategy?: "acroform" | "overlay";
};

async function resolvePdfUrl(sourcePageUrl: string): Promise<{ pdfUrl: string; revision: string | null }> {
  const pageRes = await fetch(sourcePageUrl, { redirect: "follow" });
  if (!pageRes.ok) {
    throw new Error(`source page fetch failed: ${pageRes.status} ${pageRes.statusText}`);
  }
  const html = await pageRes.text();

  // sba.gov document pages link the current PDF from a fixed CDN path
  // pattern. Do not hardcode a specific file name/revision — parse it off
  // the page every run so a superseded revision is never silently reused.
  const match = html.match(/href="(https:\/\/www\.sba\.gov\/sites\/[^"]+\.pdf)"/i);
  if (!match) {
    throw new Error("could not locate a .pdf link on the source page — page structure may have changed");
  }

  const revisionMatch = html.match(/Revision date:\s*([A-Za-z]+\s+\d{4})/i);
  return { pdfUrl: match[1], revision: revisionMatch?.[1]?.trim() ?? null };
}

async function ingestOne(source: TemplateSource, dryRun: boolean): Promise<IngestResult> {
  let pdfUrl: string;
  let revision: string | null;
  try {
    ({ pdfUrl, revision } = await resolvePdfUrl(source.sourcePageUrl));
  } catch (err: any) {
    return { templateKey: source.templateKey, ok: false, reason: `resolve failed: ${err?.message ?? err}` };
  }

  const pdfRes = await fetch(pdfUrl, { redirect: "follow" });
  if (!pdfRes.ok) {
    return { templateKey: source.templateKey, ok: false, reason: `pdf fetch failed: ${pdfRes.status} ${pdfRes.statusText}` };
  }
  const bytes = Buffer.from(await pdfRes.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let fieldCount = 0;
  let fillStrategy: "acroform" | "overlay" = "overlay";
  try {
    const pdfDoc = await PDFDocument.load(bytes);
    const fields = pdfDoc.getForm().getFields();
    fieldCount = fields.length;
    fillStrategy = fieldCount > 0 ? "acroform" : "overlay";
  } catch (err: any) {
    return { templateKey: source.templateKey, ok: false, reason: `AcroForm parse failed: ${err?.message ?? err}` };
  }

  const fileName = `${source.templateKey}.pdf`;
  const relPath = `sba-templates/${fileName}`;

  if (!dryRun) {
    await mkdir(TEMPLATE_DIR, { recursive: true });
    await writeFile(path.join(TEMPLATE_DIR, fileName), bytes);

    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    const sb = createClient(url, key);

    const row = {
      template_key: source.templateKey,
      name: source.name,
      version: revision ?? "unknown",
      file_path: relPath,
      mime_type: "application/pdf",
      file_sha256: sha256,
      is_active: true,
      metadata: {
        revision,
        source_url: pdfUrl,
        sha256,
        field_count: fieldCount,
        fill_strategy: fillStrategy,
        ingested_at: new Date().toISOString(),
      },
    };

    // bank_id IS NULL marks a global template. Postgres treats NULL != NULL
    // so a plain UNIQUE(bank_id, template_key, version) constraint can't
    // enforce "one global row per form" — do a manual select-then-write
    // instead of relying on ON CONFLICT.
    const { data: existing, error: selectError } = await sb
      .from("bank_document_templates")
      .select("id")
      .is("bank_id", null)
      .eq("template_key", source.templateKey)
      .maybeSingle();
    if (selectError) {
      return { templateKey: source.templateKey, ok: false, reason: `db lookup failed: ${selectError.message}` };
    }

    const { error } = existing
      ? await sb.from("bank_document_templates").update(row).eq("id", existing.id)
      : await sb.from("bank_document_templates").insert({ ...row, bank_id: null });
    if (error) {
      return { templateKey: source.templateKey, ok: false, reason: `db write failed: ${error.message}` };
    }
  }

  return {
    templateKey: source.templateKey,
    ok: true,
    revision: revision ?? "unknown",
    sha256,
    fieldCount,
    fillStrategy,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const formArgIdx = args.indexOf("--form");
  const onlyForm = formArgIdx >= 0 ? args[formArgIdx + 1] : null;

  const targets = onlyForm ? SOURCES.filter((s) => s.templateKey === onlyForm) : SOURCES;
  if (onlyForm && targets.length === 0) {
    console.error(`[ingest-sba-templates] Unknown --form ${onlyForm}. Known: ${SOURCES.map((s) => s.templateKey).join(", ")}`);
    process.exit(1);
  }

  console.log(`[ingest-sba-templates] Ingesting ${targets.length} form(s)${dryRun ? " (dry-run)" : ""}...`);

  const results: IngestResult[] = [];
  for (const source of targets) {
    console.log(`  → ${source.templateKey} ...`);
    const result = await ingestOne(source, dryRun);
    results.push(result);
    if (result.ok) {
      console.log(`    ok — revision=${result.revision} fields=${result.fieldCount} strategy=${result.fillStrategy} sha256=${result.sha256?.slice(0, 12)}…`);
    } else {
      console.log(`    FAILED — ${result.reason}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[ingest-sba-templates] ${results.length - failed.length}/${results.length} succeeded.`);
  if (failed.length > 0) {
    console.log("Failed forms (no placeholder committed — see AP-6):");
    for (const f of failed) console.log(`  - ${f.templateKey}: ${f.reason}`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[ingest-sba-templates] fatal:", e);
  process.exit(1);
});
