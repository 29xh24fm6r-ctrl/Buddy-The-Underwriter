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
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { OFFICIAL_TEMPLATE_SOURCES, type TemplateSource } from "@/lib/sba/templates/officialTemplateSources";
import { resolveCurrentTemplateRevision } from "@/lib/sba/templates/resolveCurrentTemplateRevision";

// Bank-agnostic template set required by ARC-00 Phase 0.C — shared with
// templateStalenessChecker.ts so the one-off ingester and the recurring
// cron check can never disagree about which forms exist or where they
// come from.
const SOURCES: TemplateSource[] = OFFICIAL_TEMPLATE_SOURCES;

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

async function ingestOne(source: TemplateSource, dryRun: boolean): Promise<IngestResult> {
  let pdfUrl: string;
  let revision: string | null;
  let sha256: string;
  let bytes: Buffer;
  try {
    ({ pdfUrl, revision, sha256, pdfBytes: bytes } = await resolveCurrentTemplateRevision(source.sourcePageUrl));
  } catch (err: any) {
    return { templateKey: source.templateKey, ok: false, reason: `resolve failed: ${err?.message ?? err}` };
  }

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
