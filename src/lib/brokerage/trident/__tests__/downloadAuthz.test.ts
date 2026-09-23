import test from "node:test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
import { LENDER_PACKAGE_FILES } from "../../lenderPackageFiles";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
let borrowerReleased = true;
require.cache[require.resolve("@/lib/brokerage/borrowerArtifactRelease")] = {
  id: "release-stub", filename: "release-stub", loaded: true,
  exports: { getBorrowerArtifactRelease: async () => ({ released: borrowerReleased, reason: borrowerReleased ? "released" : "bank_selection_required", sealedPackageId: "seal-1" }) },
} as any;
const { renderProjectionsXlsx } =
  require("../projectionsXlsx") as typeof import("../projectionsXlsx");

// ─── Mock state ────────────────────────────────────────────────────────
const storedFiles = new Map<string, Buffer>();
let lenderIdentity: any = null;
let seals: any[] = [];
let grants: any[] = [];
let uploadError = false;
let onUpload: (() => void) | null = null;
let signedPaths: string[] = [];
require.cache[require.resolve("@/lib/brokerage/lenderAuth")] = {
  id: "lender-stub", filename: "lender-stub", loaded: true,
  exports: { resolveLenderIdentity: async () => lenderIdentity },
} as any;
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
  borrowerReleased = true;
  lenderIdentity = null; seals = []; grants = []; uploadError = false; onUpload = null; signedPaths = [];
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
            const rows = _table === "buddy_sealed_packages" ? seals : _table === "marketplace_package_access" ? grants :
              _table === "deals" ? [{ id: "deal-1", bank_id: "bank-1" }] : state.bundles;
            const match = rows.find(
              (b) =>
                Object.entries(this._filters).every(([k, v]) => b[k] === v) &&
                this._isNull.every((col: string) => b[col] == null),
            );
            return Promise.resolve({
              data: state.queryError ? null : (match ?? null),
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
              return bytes
                ? { data: new Blob([new Uint8Array(bytes)]), error: null }
                : { data: null, error: { message: "missing object" } };
            },
            async upload(filePath: string, bytes: Uint8Array) {
              onUpload?.();
              if (uploadError) return { data: null, error: { message: "write unavailable" } };
              if (storedFiles.has(filePath)) return { data: null, error: { message: "duplicate" } };
              storedFiles.set(filePath, Buffer.from(bytes));
              return { data: { path: filePath }, error: null };
            },
            async createSignedUrl(_p: string, _ttl: number) {
              signedPaths.push(_p);
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
const routeModule =
  require("../../../../app/api/brokerage/deals/[dealId]/trident/download/[kind]/route") as typeof import("../../../../app/api/brokerage/deals/[dealId]/trident/download/[kind]/route");
const { GET } = routeModule;

function mkReq(query = ""): any {
  return { headers: new Map(), nextUrl: new URL("https://example.test/route" + query) };
}
async function call(dealId: string, kind: string) {
  const res = await GET(mkReq(), {
    params: Promise.resolve({ dealId, kind }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────────
test("borrower previews and complete package stay locked before bank claim plus selection", async () => {
  resetState();
  borrowerReleased = false;
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  for (const kind of ["business_plan", "projections_pdf", "projections_xlsx", "feasibility", "spreads", "complete_package"]) {
    const { status, body } = await call("deal-1", kind);
    assert.equal(status, 403);
    assert.equal(body.url, undefined);
  }
  resetState();
});

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

test("borrower package excludes the internal memo and fails closed for missing visible documents", async () => {
  resetState();
  storedFiles.clear();
  state.session = { deal_id: "deal-1", bank_id: "bank-1" };
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Synthetic package test");
  const pdfBytes = Buffer.from(await pdf.save());
  const workbook = await renderProjectionsXlsx({
    dealName: "Synthetic QA",
    baseYear: {
      revenue: 100000,
      cogs: 40000,
      operatingExpenses: 20000,
      ebitda: 40000,
      netIncome: 25000,
    },
    annualProjections: [
      {
        year: 1,
        revenue: 110000,
        ebitda: 44000,
        dscr: 2,
        totalDebtService: 22000,
      },
    ],
    monthlyProjections: [],
    sensitivityScenarios: [],
    sourcesAndUses: null,
    balanceSheetProjections: null,
    assumptions: {
      revenue_streams: [{ name: "Services", growthRateYear1: 0.1 }],
      loan_impact: { loanAmount: 50000 },
    },
    assumptionsNarrative:
      "Revenue grows by 10 percent based on the synthetic customer contract.",
  });
  const bundle: any = {
    id: "run",
    deal_id: "deal-1",
    bank_id: "bank-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    snapshot_manifest_json: { sources: { documents: [] } },
  };
  seals = [{ id: "seal-1", deal_id: "deal-1", bank_id: "bank-1", unsealed_at: null, sealed_snapshot: { tridentFinal: { bundleId: "run" } } }];
  for (const file of LENDER_PACKAGE_FILES) {
    bundle[file.column] = `deal-1/final/run/${file.filename}`;
    storedFiles.set(
      bundle[file.column],
      file.kind === "projections_xlsx" ? workbook : pdfBytes,
    );
  }
  state.bundles.push(bundle);
  const response = await GET(mkReq(), {
    params: Promise.resolve({ dealId: "deal-1", kind: "complete_package" }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /application\/json/);
  const signed = await response.json();
  assert.equal(signed.ok, true);
  assert.equal(signed.bundleId, "run");
  const zip = await JSZip.loadAsync(storedFiles.get(signedPaths.at(-1)!)!);
  assert.equal(Object.keys(zip.files).length, 7);
  assert.equal(zip.file("05-credit-memo.pdf"), null);
  for (const file of LENDER_PACKAGE_FILES.filter(
    (file) => file.kind !== "credit_memo",
  )) {
    const bytes = await zip.file(file.filename)!.async("nodebuffer");
    if (file.kind === "projections_xlsx") {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes as any);
      assert.equal(wb.worksheets.length, 6);
      const rows = wb.getWorksheet("Assumptions")!.getSheetValues();
      assert.ok(JSON.stringify(rows).includes("growth Rate Year1"));
      assert.ok(JSON.stringify(rows).includes("0.1"));
    } else assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  }
  for (const file of LENDER_PACKAGE_FILES.filter(
    (file) => file.kind !== "credit_memo",
  )) {
    const path = bundle[file.column];
    const bytes = storedFiles.get(path)!;
    storedFiles.delete(path);
    const unavailable = await GET(mkReq(), {
      params: Promise.resolve({ dealId: "deal-1", kind: "complete_package" }),
    });
    assert.equal(unavailable.status, 503, file.kind);
    storedFiles.set(path, bytes);
  }
  state.session = { deal_id: "other", bank_id: "bank-1" };
  assert.equal(
    (
      await GET(mkReq(), {
        params: Promise.resolve({ dealId: "deal-1", kind: "complete_package" }),
      })
    ).status,
    404,
  );
});

test("a borrower cannot request the internal credit memo directly", async () => {
  resetState();
  state.session = { deal_id: "deal-1", bank_id: "bank-1" };
  const { status } = await call("deal-1", "credit_memo");
  assert.equal(status, 404);
});

async function archiveFixture() {
  resetState(); storedFiles.clear(); auditWrites.length = 0;
  state.session = { deal_id: "deal-1", bank_id: "bank-1" };
  const pdf = await PDFDocument.create(); pdf.addPage().drawText("Synthetic source return");
  const bytes = Buffer.from(await pdf.save());
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Projections").addRow(["Revenue", 1200000]);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const documents = [
    { id: "tax-2023", original_filename: "tax.pdf", source: "borrower", doc_year: 2023 },
    { id: "tax-2024", original_filename: "tax.pdf", source: "borrower", doc_year: 2024 },
    { id: "tax-2025", original_filename: "../../tax.pdf", source: "borrower", doc_year: 2025 },
    { id: "balance", original_filename: "opening-balance.pdf", source: "borrower" },
    { id: "review", original_filename: "budget.pdf", source: "borrower", intake_status: "CLASSIFIED_PENDING_REVIEW" },
    { id: "internal", original_filename: "private-lender-evidence.pdf", source: "internal" },
    { id: "withdrawn", original_filename: "withdrawn.pdf", source: "borrower", status: "withdrawn" },
    { id: "inactive", original_filename: "inactive.pdf", source: "borrower", is_active: false },
    { id: "system", original_filename: "internal-memo.pdf", source: "system" },
  ].map(doc => ({ deal_id: "deal-1", bank_id: "bank-1", is_active: true, intake_status: "USER_CONFIRMED",
    quality_status: "PASSED", storage_bucket: "deal-files", storage_path: `deal-1/${doc.id}.pdf`,
    size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...doc }));
  for (const doc of documents) storedFiles.set(doc.storage_path, bytes);
  const bundle: any = { id: "frozen-run", deal_id: "deal-1", bank_id: "bank-1", mode: "final", status: "succeeded",
    superseded_at: null, snapshot_manifest_json: { sources: { documents } } };
  for (const file of LENDER_PACKAGE_FILES) {
    bundle[file.column] = `deal-1/final/frozen-run/${file.filename}`;
    storedFiles.set(bundle[file.column], file.kind === "projections_xlsx" ? xlsx : bytes);
  }
  state.bundles = [bundle];
  seals = [{ id: "seal-1", deal_id: "deal-1", bank_id: "bank-1", unsealed_at: null,
    sealed_snapshot: { tridentFinal: { bundleId: "frozen-run" } } }];
  grants = [{ id: "grant", deal_id: "deal-1", lender_bank_id: "lender-bank", sealed_package_id: "seal-1", access_level: "full", revoked_at: null }];
  return { bundle, documents, bytes };
}
async function archiveCall(kind = "complete_package", query = "") {
  return GET(mkReq(query), { params: Promise.resolve({ dealId: "deal-1", kind }) });
}
async function savedArchive() {
  const zip = await JSZip.loadAsync(storedFiles.get(signedPaths.at(-1)!)!, { checkCRC32: true });
  return { zip, inventory: JSON.parse(await zip.file("Package-inventory.json")!.async("string")) };
}

test("complete borrower delivery includes frozen tax returns and supporting evidence with verified inventory", async () => {
  const { documents } = await archiveFixture();
  assert.equal((await archiveCall()).status, 200);
  const { zip, inventory } = await savedArchive();
  assert.equal(inventory.actor, "borrower");
  assert.equal(inventory.bundleId, "frozen-run");
  const sources = inventory.files.filter((file: any) => file.category === "source");
  assert.equal(sources.length, 5);
  assert.deepEqual(sources.flatMap((file: any) => file.years).sort(), [2023, 2024, 2025]);
  assert.equal(sources.find((file: any) => file.documentId === "review").reviewStatus, "review_required");
  assert.equal(zip.file("05-credit-memo.pdf"), null);
  assert.ok(!JSON.stringify(inventory).includes("private-lender-evidence"));
  assert.ok(!JSON.stringify(inventory).includes("storage_path"));
  assert.ok(Object.keys(zip.files).every(name => !name.includes("..") && !name.startsWith("/")));
  for (const item of inventory.files) {
    const data = await zip.file(item.filename)!.async("nodebuffer");
    assert.equal(data.length, item.sizeBytes);
    assert.equal(createHash("sha256").update(data).digest("hex"), item.sha256);
    if (item.category === "source") assert.equal(item.sha256, documents.find(d => d.id === item.documentId)!.sha256);
  }
  const firstPath = signedPaths.at(-1);
  assert.equal((await archiveCall()).status, 200, "identical create-once archive can be reused");
  assert.equal(signedPaths.at(-1), firstPath);
});

test("lender archive includes memo and internal source evidence, bound to its authorized seal", async () => {
  await archiveFixture(); state.session = null; lenderIdentity = { lenderBankId: "lender-bank", userId: "lender-user" };
  // A different current bundle must not replace the seal's version.
  state.bundles.unshift({ ...state.bundles[0], id: "unrelated-run", snapshot_manifest_json: { sources: { documents: [] } } });
  assert.equal((await archiveCall("complete_package", "?accessId=grant")).status, 200);
  const { zip, inventory } = await savedArchive();
  assert.ok(zip.file("05-credit-memo.pdf"));
  assert.equal(inventory.bundleId, "frozen-run");
  assert.equal(inventory.files.filter((file: any) => file.category === "source").length, 6);
  assert.ok(signedPaths.at(-1)!.includes("/lender/"));
});

test("source-only archive uses the same evidence and authorization without generated documents", async () => {
  await archiveFixture();
  assert.equal((await archiveCall("source_docs")).status, 200);
  const { zip, inventory } = await savedArchive();
  assert.ok(inventory.files.every((file: any) => file.category === "source"));
  assert.equal(zip.file("01-business-plan.pdf"), null);
  borrowerReleased = false;
  assert.equal((await archiveCall("source_docs")).status, 403);
});

for (const [name, mutate] of [
  ["missing source bytes", ({ documents }: any) => storedFiles.delete(documents[0].storage_path)],
  ["wrong digest at same size", ({ documents, bytes }: any) => storedFiles.set(documents[0].storage_path, Buffer.alloc(bytes.length, 65))],
  ["missing byte identity", ({ documents }: any) => { documents[0].size_bytes = null; }],
  ["missing frozen source manifest", ({ bundle }: any) => { bundle.snapshot_manifest_json = null; }],
  ["cross-deal source", ({ documents }: any) => { documents[0].deal_id = "other-deal"; }],
  ["cross-bank source", ({ documents }: any) => { documents[0].bank_id = "other-bank"; }],
  ["duplicate source identity", ({ documents }: any) => { documents.push(documents[0]); }],
  ["oversized archive", ({ documents }: any) => { documents[0].size_bytes = 41 * 1024 * 1024; }],
  ["invalid generated PDF", ({ bundle }: any) => storedFiles.set(bundle.business_plan_pdf_path, Buffer.from("%PDF-not-a-document"))],
  ["invalid generated workbook", ({ bundle }: any) => storedFiles.set(bundle.projections_xlsx_path, Buffer.from("PK-not-a-workbook"))],
  ["storage write failure", () => { uploadError = true; }],
  ["audit failure", () => { state.auditError = true; }],
] as const) test(`archive fails closed for ${name}`, async () => {
  const fixture = await archiveFixture(); mutate(fixture);
  assert.equal((await archiveCall()).status, 503);
  assert.equal(signedPaths.length, 0, "no partial archive link");
});

for (const [name, mutate] of [
  ["preview grant", () => { grants[0].access_level = "preview"; }],
  ["revoked grant", () => { grants[0].revoked_at = "2026-09-23"; }],
  ["wrong lender", () => { lenderIdentity.lenderBankId = "other"; }],
  ["other deal's seal", () => { seals[0].deal_id = "other"; }],
  ["unsealed package", () => { seals[0].unsealed_at = "2026-09-23"; }],
  ["missing seal binding", () => { grants[0].sealed_package_id = null; }],
] as const) test(`no archive is exposed for ${name}`, async () => {
  await archiveFixture(); state.session = null; lenderIdentity = { lenderBankId: "lender-bank", userId: "lender-user" }; mutate();
  assert.ok([404, 409].includes((await archiveCall("complete_package", "?accessId=grant")).status));
  assert.equal(signedPaths.length, 0);
});

test("revocation during assembly withholds the stored archive URL", async () => {
  await archiveFixture(); onUpload = () => { borrowerReleased = false; };
  assert.equal((await archiveCall()).status, 403);
  assert.equal(signedPaths.length, 0);
});

test("browser anchor receives a private redirect instead of a large function response", async () => {
  const { documents } = await archiveFixture();
  const large = Buffer.alloc(5 * 1024 * 1024, 65);
  documents[0].size_bytes = large.length; documents[0].sha256 = createHash("sha256").update(large).digest("hex");
  storedFiles.set(documents[0].storage_path, large);
  const response = await archiveCall("complete_package", "?redirect=1");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("location"), "https://signed.example/path");
});
