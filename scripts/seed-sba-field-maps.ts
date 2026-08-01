#!/usr/bin/env tsx
/**
 * §7b — Populate bank_document_template_fields and bank_template_field_maps
 * for the nine registered SBA/IRS templates from the hardcoded pdfFieldMap.ts
 * files, so the DB-driven path agrees with the renderer's hardcoded maps.
 *
 * Usage:
 *   npx tsx scripts/seed-sba-field-maps.ts
 *   npx tsx scripts/seed-sba-field-maps.ts --dry-run
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const dryRun = process.argv.includes("--dry-run");

const TEMPLATE_DIR = path.join(process.cwd(), "public", "sba-templates");

const TEMPLATE_KEYS = [
  "SBA_1919",
  "SBA_1244",
  "SBA_413",
  "SBA_912",
  "IRS_4506C",
  "SBA_155",
  "SBA_148",
  "SBA_601",
  "SBA_722",
];

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  for (const key of TEMPLATE_KEYS) {
    console.log(`\n--- ${key} ---`);

    const { data: template } = await sb
      .from("bank_document_templates")
      .select("id, file_path")
      .is("bank_id", null)
      .eq("template_key", key)
      .eq("is_active", true)
      .maybeSingle();

    if (!template) {
      console.log(`  SKIP: no active global template for ${key}`);
      continue;
    }

    const filePath = path.join(process.cwd(), "public", template.file_path);
    let pdfBytes: Buffer;
    try {
      pdfBytes = await readFile(filePath);
    } catch {
      console.log(`  SKIP: PDF not found at ${filePath}`);
      continue;
    }

    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = doc.getForm();
    const fields = form.getFields();

    console.log(`  Template ID: ${template.id}`);
    console.log(`  AcroForm fields: ${fields.length}`);

    if (dryRun) {
      for (const f of fields) {
        console.log(`    ${f.constructor.name.replace("PDF", "")}: ${f.getName()}`);
      }
      continue;
    }

    const { error: delFieldsErr } = await sb
      .from("bank_document_template_fields")
      .delete()
      .eq("template_id", template.id);
    if (delFieldsErr) console.log(`  WARN: field delete failed: ${delFieldsErr.message}`);

    const fieldRows = fields.map((f) => ({
      template_id: template.id,
      field_name: f.getName(),
      field_type: f.constructor.name.replace("PDF", "").toLowerCase(),
      is_required: false,
      meta: {},
    }));

    if (fieldRows.length > 0) {
      const { error: insertErr } = await sb
        .from("bank_document_template_fields")
        .insert(fieldRows);
      if (insertErr) {
        console.log(`  ERROR: field insert failed: ${insertErr.message}`);
      } else {
        console.log(`  Inserted ${fieldRows.length} field rows`);
      }
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
