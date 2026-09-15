import "server-only";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { assembleTenTabPackage } from "../assembleTenTabPackage";
import { appendFormContinuation } from "@/lib/sba/forms/formContinuation";
import {
  FORM_159_TEXT_FIELDS,
  FORM_159_CHECKBOX_FIELDS,
} from "@/lib/sba/forms/form159/pdfFieldMap";
function fixture(missing = false, wrongDeal = false) {
  const rows: Record<string, any> = {
    sba_package_runs: { id: "run", deal_id: wrongDeal ? "another" : "deal" },
    sba_package_run_items: [
      {
        id: "one",
        template_code: "SBA_148",
        title: "Guarantee",
        status: "generated",
        output_storage_path: "one",
        sort_order: 1,
      },
      {
        id: "two",
        template_code: "SBA_413",
        title: "PFS",
        status: "generated",
        output_storage_path: "two",
        sort_order: 2,
      },
    ],
    borrower_concierge_sessions: { confirmed_facts: {} },
  };
  let uploaded: Uint8Array | null = null;
  const sb: any = {
    from(table: string) {
      const chain: any = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        order() {
          return chain;
        },
        update() {
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[table], error: null });
        },
        then(resolve: any) {
          return Promise.resolve({ data: rows[table], error: null }).then(
            resolve,
          );
        },
      };
      return chain;
    },
    storage: {
      from() {
        return {
          async download(path: string) {
            if (missing && path === "two")
              return { data: null, error: { message: "unavailable" } };
            return {
              data: new Blob([
                readFileSync(
                  "public/sba-templates/" +
                    (path === "one" ? "SBA_148.pdf" : "SBA_413.pdf"),
                ),
              ]),
              error: null,
            };
          },
          async upload(_path: string, bytes: Uint8Array) {
            uploaded = bytes;
            return { error: null };
          },
        };
      },
    },
  };
  return { sb, getUploaded: () => uploaded };
}
test("package assembly fails rather than claiming a missing form was included", async () => {
  const f = fixture(true);
  const result = await assembleTenTabPackage({
    supabase: f.sb,
    dealId: "deal",
    packageRunId: "run",
  });
  assert.equal(result.ok, false);
  assert.equal(f.getUploaded(), null);
});
test("package assembly rejects a run belonging to another deal", async () => {
  const f = fixture(false, true);
  assert.equal(
    (
      await assembleTenTabPackage({
        supabase: f.sb,
        dealId: "deal",
        packageRunId: "run",
      })
    ).ok,
    false,
  );
});
test("successful package contains every source page", async () => {
  const f = fixture();
  const result = await assembleTenTabPackage({
    supabase: f.sb,
    dealId: "deal",
    packageRunId: "run",
  });
  assert.equal(result.ok, true);
  const pdf = await PDFDocument.load(f.getUploaded()!);
  assert.equal(pdf.getPageCount(), 11);
});
test("continuations paginate all overflow text and restored 159 has every mapped field", async () => {
  const pdf = await PDFDocument.create();
  await appendFormContinuation(pdf, "Applicant example", [
    {
      title: "Real estate",
      rows: Array.from({ length: 20 }, (_, i) => ({
        address: "Property " + i,
        description: "Detailed property information ".repeat(30),
      })),
    },
  ]);
  assert.ok(pdf.getPageCount() > 1);
  const form159 = (
    await PDFDocument.load(readFileSync("public/sba-templates/SBA_159.pdf"))
  ).getForm();
  for (const name of Object.values(FORM_159_TEXT_FIELDS))
    assert.ok(form159.getTextField(name));
  for (const name of Object.values(FORM_159_CHECKBOX_FIELDS))
    assert.ok(form159.getCheckBox(name));
});

test("restored 722 poster contains both official language pages", async () => {
  const pdf = await PDFDocument.load(
    readFileSync("public/sba-templates/SBA_722.pdf"),
  );
  assert.equal(pdf.getPageCount(), 2);
});
