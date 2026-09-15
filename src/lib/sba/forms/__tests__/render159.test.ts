import "server-only";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderForm159Pdf } from "../render159";
import { buildSbaForm159 } from "../build159";
import { FORM_159_TEXT_FIELDS, FORM_159_CHECKBOX_FIELDS } from "../form159/pdfFieldMap";

const { fields } = buildSbaForm159({
  dealId: "synthetic-test", applicantName: "Example LLC", loanAmount: 500000,
  lenderBankId: null, lenderBankName: "Example Lender",
  agentName: "Example Agent", agentAddress: "1 Test Street",
  feeLedger: [{ fee_type: "borrower_packaging", payer_type: "borrower", payee_type: "brokerage", amount_cents: 100000, bps: null, basis_amount_cents: null, status: "disclosed" }],
});

function client(filePath: string) {
  let uploaded: Uint8Array | null = null;
  const chain: any = {
    select: () => chain, is: () => chain, eq: () => chain,
    maybeSingle: async () => ({ data: { id: "template", file_path: filePath }, error: null }),
  };
  return {
    sb: {
      from: () => chain,
      storage: { from: () => ({ upload: async (_key: string, bytes: Uint8Array) => { uploaded = bytes; return { error: null }; } }) },
    } as any,
    uploaded: () => uploaded,
  };
}

test("159 renders the deployed official template into a four-page PDF", async () => {
  const f = client("sba-templates/SBA_159.pdf");
  const result = await renderForm159Pdf({ supabase: f.sb, dealId: fields.deal_id, fields });
  assert.equal(result.ok, true);
  assert.ok(f.uploaded());
  const pdf = await PDFDocument.load(f.uploaded()!);
  assert.equal(pdf.getPageCount(), 4);
  assert.equal(pdf.getForm().getFields().length, 0);
});

for (const [label, fieldName, wrongType] of [
  ["missing text field", FORM_159_TEXT_FIELDS.agent_name, false],
  ["wrong checkbox type", FORM_159_CHECKBOX_FIELDS.agent_type_independent_loan_packager, true],
] as const) {
  test(`159 rejects ${label} before uploading a partial disclosure`, async () => {
    const dir = await mkdtemp(path.join(process.cwd(), "public", "qa-159-"));
    try {
      const pdf = await PDFDocument.load(await readFile("public/sba-templates/SBA_159.pdf"));
      const form = pdf.getForm();
      form.removeField(form.getField(fieldName));
      if (wrongType) form.createTextField(fieldName);
      const file = path.join(dir, "template.pdf");
      await writeFile(file, await pdf.save());
      const f = client(path.relative(path.join(process.cwd(), "public"), file));
      const result = await renderForm159Pdf({ supabase: f.sb, dealId: fields.deal_id, fields });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "fill_failed");
      assert.equal(f.uploaded(), null);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
