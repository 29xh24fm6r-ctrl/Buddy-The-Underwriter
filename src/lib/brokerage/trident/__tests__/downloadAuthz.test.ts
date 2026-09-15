import test from "node:test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { LENDER_PACKAGE_FILES } from "../../lenderPackageFiles";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { renderProjectionsXlsx } = require("../projectionsXlsx") as typeof import("../projectionsXlsx");

// ─── Mock state ────────────────────────────────────────────────────────
const storedFiles = new Map<string, Buffer>();
const state: {
  session: any;
  bundles: any[];
  signedUrlReturns: { signedUrl?: string; error?: any };
  queryError: any;
  auditError: boolean;
} = {
  session: null,
  bundles: [],
  signedUrlReturns: { signedUrl: "https://signed.example/path" },
  queryError: null,
  auditError: false,
};

function resetState() {
  state.session = null;
  state.bundles = [];
  state.signedUrlReturns = { signedUrl: "https://signed.example/path" };
  state.queryError = null;
  state.auditError = false;
}

// Stub next/server with a minimal NextResponse/NextRequest shim.
// The route imports these from "next/server"; we let the real module load
// but we don't use its runtime behavior — only .json() via a plain Response.

// Stub getBorrowerSession.
require.cache[require.resolve("@/lib/brokerage/sessionToken")] = {
  id: "session-stub",
  filename: "session-stub",
  loaded: true,
  exports: {
    getBorrowerSession: async () => state.session,
  },
} as any;

// Stub supabaseAdmin with a query builder that serves state.bundles.
require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "admin-stub",
  filename: "admin-stub",
  loaded: true,
  exports: {
    supabaseAdmin: () => ({
      from(_table: string) {
        const q: any = {
          _filters: {} as Record<string, any>,
          _isNull: [] as string[],
          select() {
            return this;
          },
          eq(k: string, v: any) {
            this._filters[k] = v;
            return this;
          },
          is(col: string, _v: null) {
            this._isNull.push(col);
            return this;
          },
          maybeSingle() {
            const match = state.bundles.find(
              (b) =>
                Object.entries(this._filters).every(([k, v]) => b[k] === v) &&
                this._isNull.every((col: string) => b[col] == null),
            );
            return Promise.resolve({
              data: state.queryError ? null : match ?? null,
              error: state.queryError,
            });
          },
        };
        return q;
      },
      storage: {
        from(_b: string) {
          return {
            async download(path: string) {
              const bytes = storedFiles.get(path);
              return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: "missing object" } };
            },
            async createSignedUrl(_p: string, _ttl: number) {
              if (state.signedUrlReturns.error) {
                return { data: null, error: state.signedUrlReturns.error };
              }
              return {
                data: { signedUrl: state.signedUrlReturns.signedUrl },
                error: null,
              };
            },
          };
        },
      },
    }),
  },
} as any;

const auditWrites: any[] = [];
require.cache[require.resolve("@/lib/brokerage/packageDelivery")] = {
  id: "package-audit-stub",
  filename: "package-audit-stub",
  loaded: true,
  exports: {
    auditPackageDownload: async (entry: any) => {
      auditWrites.push(entry);
      return state.auditError
        ? { ok: false, error: "audit unavailable" }
        : { ok: true };
    },
  },
} as any;

// Load the route handler.
const routeModule = require(
  "../../../../app/api/brokerage/deals/[dealId]/trident/download/[kind]/route",
) as typeof import("../../../../app/api/brokerage/deals/[dealId]/trident/download/[kind]/route");
const { GET } = routeModule;

function mkReq(): any {
  return { headers: new Map(), nextUrl: new URL("https://example.test/route") };
}
async function call(dealId: string, kind: string) {
  const res = await GET(mkReq(), {
    params: Promise.resolve({ dealId, kind }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────────

test("no cookie → 404", async () => {
  resetState();
  state.session = null;
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test("cookie present but deal_id mismatches URL → 404 (never 403)", async () => {
  resetState();
  state.session = { deal_id: "deal-OTHER", tokenHash: "h" };
  const { status } = await call("deal-1", "business_plan");
  assert.equal(status, 404);
});

test("invalid kind → 404", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  const { status } = await call("deal-1", "not_a_kind");
  assert.equal(status, 404);
});

test("cookie + matching deal but no current bundle → 404", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  const { status } = await call("deal-1", "business_plan");
  assert.equal(status, 404);
});

test("cookie + matching deal + current final bundle → 200 with signed URL", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "deal-1/final/1_business_plan.pdf",
  });
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.url);
  assert.equal(body.mode, "final");
});

test("cookie + matching deal + only preview bundle → 200 with preview URL", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "preview",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "deal-1/preview/1_business_plan.pdf",
  });
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 200);
  assert.equal(body.mode, "preview");
});

test("bundle exists but artifact path missing → 404", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "path.pdf",
    projections_xlsx_path: null, // asking for XLSX — not present
  });
  const { status } = await call("deal-1", "projections_xlsx");
  assert.equal(status, 404);
});

test("bundle database outage returns 503 rather than a misleading 404", async () => {
  resetState();
  state.session = { deal_id: "deal-1", bank_id: "bank-1", tokenHash: "h" };
  state.queryError = { message: "database unavailable" };
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 503);
  assert.equal(body.error, "package_state_unavailable");
});

test("signed artifact is withheld when download audit persistence fails", async () => {
  resetState();
  state.session = { deal_id: "deal-1", bank_id: "bank-1", tokenHash: "h" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "deal-1/final/1_business_plan.pdf",
  });
  state.auditError = true;
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 503);
  assert.equal(body.error, "download_audit_persistence_failed");
  assert.equal(body.url, undefined);
});

test("complete package downloads all six real files, including model assumptions, and fails closed for any missing file", async () => {
  resetState(); storedFiles.clear();
  state.session = { deal_id: "deal-1", bank_id: "bank-1" };
  const pdf = await PDFDocument.create(); pdf.addPage().drawText("Synthetic package test");
  const pdfBytes = Buffer.from(await pdf.save());
  const workbook = await renderProjectionsXlsx({
    dealName: "Synthetic QA", baseYear: { revenue: 100000, cogs: 40000, operatingExpenses: 20000, ebitda: 40000, netIncome: 25000 },
    annualProjections: [{ year: 1, revenue: 110000, ebitda: 44000, dscr: 2, totalDebtService: 22000 }], monthlyProjections: [], sensitivityScenarios: [], sourcesAndUses: null, balanceSheetProjections: null,
    assumptions: { revenue_streams: [{ name: "Services", growthRateYear1: 0.10 }], loan_impact: { loanAmount: 50000 } },
    assumptionsNarrative: "Revenue grows by 10 percent based on the synthetic customer contract.",
  });
  const bundle: any = { id: "run", deal_id: "deal-1", bank_id: "bank-1", mode: "final", status: "succeeded", superseded_at: null };
  for (const file of LENDER_PACKAGE_FILES) { bundle[file.column] = `deal-1/final/run/${file.filename}`; storedFiles.set(bundle[file.column], file.kind === "projections_xlsx" ? workbook : pdfBytes); }
  state.bundles.push(bundle);
  const response = await GET(mkReq(), { params: Promise.resolve({ dealId: "deal-1", kind: "complete_package" }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/zip");
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  assert.equal(Object.keys(zip.files).length, 7);
  for (const file of LENDER_PACKAGE_FILES) {
    const bytes = await zip.file(file.filename)!.async("nodebuffer");
    if (file.kind === "projections_xlsx") {
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as any);
      assert.equal(wb.worksheets.length, 6);
      const rows = wb.getWorksheet("Assumptions")!.getSheetValues();
      assert.ok(JSON.stringify(rows).includes("growth Rate Year1"));
      assert.ok(JSON.stringify(rows).includes("0.1"));
    } else assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  }
  for (const file of LENDER_PACKAGE_FILES) {
    const path = bundle[file.column]; const bytes = storedFiles.get(path)!;
    storedFiles.delete(path);
    const unavailable = await GET(mkReq(), { params: Promise.resolve({ dealId: "deal-1", kind: "complete_package" }) });
    assert.equal(unavailable.status, 503, file.kind);
    storedFiles.set(path, bytes);
  }
  state.session = { deal_id: "other", bank_id: "bank-1" };
  assert.equal((await GET(mkReq(), { params: Promise.resolve({ dealId: "deal-1", kind: "complete_package" }) })).status, 404);
});
