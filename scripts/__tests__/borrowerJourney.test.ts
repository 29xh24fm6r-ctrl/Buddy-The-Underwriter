import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { BorrowerHttp, runBorrowerJourney, scenarioSchema, verifyBorrowerZip, type Scenario } from "../lib/borrowerJourney";
import { BORROWER_PACKAGE_FILES, LENDER_PACKAGE_FILES } from "../../src/lib/brokerage/lenderPackageFiles";

const dealId = "11111111-1111-4111-8111-111111111111";
const bundleId = "22222222-2222-4222-8222-222222222222";
const scenario: Scenario = {
  synthetic: true, ownership: { structure: "solo", owners: [{ full_name: "Synthetic QA Owner", ownership_pct: 100 }] },
  chapters: [{ n: 2, data: { purposes: ["working_capital"], totalAmount: 250000 } }],
  answers: [{ questionId: "loan.amount_requested", value: 250000 }],
  documents: [{ path: "tax.pdf", checklistKey: "business_tax_return" }, { path: "financials.pdf", checklistKey: "business_financial_statement" }],
  assumptions: { revenueStreams: [{ name: "Synthetic sales", baseAnnualRevenue: 500000 }] },
};

async function packageZip(options: { missing?: string; memo?: boolean; run?: string; corrupt?: string } = {}) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const pdfBytes = await pdf.save();
  const xlsx = new ExcelJS.Workbook(); xlsx.addWorksheet("Synthetic projections").addRow(["Revenue", 500000]);
  const xlsxBytes = await xlsx.xlsx.writeBuffer();
  const zip = new JSZip();
  for (const file of BORROWER_PACKAGE_FILES) {
    if (file.filename !== options.missing) zip.file(file.filename, file.filename === options.corrupt ? new Uint8Array([1, 2, 3]) : file.filename.endsWith(".pdf") ? pdfBytes : xlsxBytes);
  }
  if (options.memo) zip.file("05-credit-memo.pdf", pdfBytes);
  zip.file("Read-me.txt", `Prepared loan package\nRun: ${options.run ?? bundleId}\n`);
  return zip.generateAsync({ type: "uint8array" });
}

type Changes = {
  nonQA?: boolean; realDeal?: boolean; readinessBlocked?: boolean;
  uploadFails?: boolean; answerFails?: boolean; missingArtifact?: boolean;
  generationState?: string; wrongBundle?: boolean; leakMemo?: boolean;
  zip?: Uint8Array; persistenceLost?: boolean;
  prepared?: boolean;
  releaseLocked?: boolean;
  releaseUnavailable?: boolean;
  leakPackage?: boolean;
  preparation?: "succeeded" | "failed" | "running" | "wrong-run";
};
async function harness(changes: Changes = {}) {
  const calls: Array<{ path: string; method: string; body: any; cookie: string | null }> = [];
  let value: any = changes.prepared ? 250000 : null;
  let generationStarted = false;
  let preparationPolls = 0;
  let assumption: any = changes.prepared ? scenario.assumptions : null;
  let assumptionsRevision: string | null = changes.prepared ? "revision-1" : null;
  const files: string[] = changes.prepared ? ["tax.pdf", "financials.pdf"] : [];
  const zip = changes.zip ?? await packageZip();
  const json = (body: object, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ path, method, body, cookie: headers.get("cookie") });
    if (url.hostname === "storage.example.test") {
      assert.equal(headers.get("cookie"), null, "borrower cookies must not reach storage");
      return new Response(null, { status: changes.uploadFails ? 500 : 200 });
    }
    if (path === "/start") return new Response("<html>Start</html>");
    if (path === "/api/brokerage/session") {
      if (body.action === "send") return json({ ok: true });
      assert.equal(body.action, "verify");
      return json({ ok: true, qaNeedsChooser: true }, 200, { "set-cookie": "buddy_qa_chooser=identity; Path=/; HttpOnly" });
    }
    if (path === "/api/qa/borrower/applications") {
      if (changes.nonQA) return json({ ok: false, error: "unauthorized" }, 401);
      if (method === "GET") return json({ ok: true, applications: [] });
      assert.ok(["create", "resume"].includes(body.action));
      return json({ ok: true, dealId }, body.action === "create" ? 201 : 200, { "set-cookie": "buddy_borrower_session=session; Path=/; HttpOnly" });
    }
    if (path.endsWith("/package-status")) {
      const preparing = generationStarted && changes.preparation;
      const preparationStatus = preparationPolls++ === 0 ? "running" : changes.preparation;
      return json({ ok: true,
        release: { released: !changes.releaseLocked && !changes.releaseUnavailable, reason: changes.releaseUnavailable ? "state_unavailable" : changes.releaseLocked ? "bank_selection_required" : "released" },
        preparation: preparing ? { id: changes.preparation === "wrong-run" ? "other-preparation" : "prep", status: preparationStatus, bundleId: preparationStatus === "succeeded" ? bundleId : null } : null,
        readiness: { evidence: { isTestDeal: !changes.realDeal }, readyToPrepare: !changes.readinessBlocked, readyToGenerate: !changes.readinessBlocked, blockers: changes.readinessBlocked ? ["Validation is missing"] : [],
          packageFiles: LENDER_PACKAGE_FILES.map((file, i) => ({key:file.column, ready: !(changes.missingArtifact && i === 0)})) },
        bundle: generationStarted ? {
          id: changes.wrongBundle ? "another-run" : bundleId, status: changes.generationState ?? "succeeded",
        } : null,
      });
    }
    if (path === "/api/brokerage/concierge" && body.action === "save_ownership") return json({ ok: true });
    if (path === "/api/borrower/intake/progress") return json({ ok: true });
    const snapshot = () => ({ readErrors: [], questions: [{ id: "loan.amount_requested", value, responsibility: "borrower", state: value === null ? "missing" : "saved" }] });
    if (path === `/api/brokerage/concierge?dealId=${dealId}`) {
      if (changes.persistenceLost && files.length) value = null;
      return json({ ok: true, snapshot: snapshot() });
    }
    if (path === "/api/brokerage/concierge" && body.action === "guided_answer") {
      assert.equal(body.expectedValue, value);
      if (changes.answerFails) return json({ ok: false }, 409);
      value = body.value; return json({ ok: true, snapshot: snapshot() });
    }
    if (path.endsWith("/files/sign")) return json({ ok: true, upload: {
      signed_url: "https://storage.example.test/upload", file_id: "file", object_path: "source.pdf", upload_session_id: "session-id",
    } });
    if (path.endsWith("/files/record")) {
      assert.equal(headers.get("x-buddy-upload-session-id"), "session-id");
      files.push(body.original_filename); return json({ ok: true });
    }
    if (path.endsWith("/documents")) return headers.get("cookie")
      ? json({ ok: true, documents: files.map(filename => ({ filename })) }) : json({ ok: false }, 403);
    if (path.endsWith("/assumptions")) {
      if (method === "POST") { assert.equal(body.revision, assumptionsRevision); assumption = body.assumptions; assumptionsRevision = "revision-1"; }
      return json({ ok: true, assumptions: assumption, revision: assumptionsRevision, status: assumption ? "confirmed" : "draft" });
    }
    if (path.endsWith("/build-package")) { generationStarted = true; preparationPolls = 0; return json({ ok: true, ...(changes.preparation ? { preparationId: "prep" } : { bundleId }) }, 202); }
    if (path.endsWith("/download/complete_package")) return changes.releaseLocked && !changes.leakPackage
      ? json({ok:false,error:"bank_selection_required"},403)
      : new Response(Buffer.from(zip), { headers: { "content-type": "application/zip" } });
    if (path.endsWith("/download/credit_memo")) return json({ ok: changes.leakMemo === true }, changes.leakMemo ? 200 : 404);
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  const http = new BorrowerHttp("https://www.buddysba.com", fetcher);
  const documents = scenario.documents.map(d => ({ filename: d.path, checklistKey: d.checklistKey, bytes: new Uint8Array([1]) }));
  return { calls, http, options: { http, email: "qa@example.test", otp: "123456", scenario, documents, allowGeneration: true, maxPolls: 2, pause: async () => {} } };
}

test("missing OTP blocks without sending mail or falsely reporting success", async () => {
  const h = await harness(); const result = await runBorrowerJourney({ ...h.options, otp: undefined });
  assert.equal(result.status, "blocked"); assert.equal(result.exitCode, 2); assert.equal(h.calls.length, 0);
});
test("send-code mode is explicitly incomplete, not a passing journey", async () => {
  const h = await harness(); const result = await runBorrowerJourney({ ...h.options, sendCodeOnly: true, otp: undefined });
  assert.equal(result.exitCode, 2); assert.equal(h.calls.filter(c => c.body?.action === "send").length, 1);
  assert.equal(h.calls.some(c => c.path.includes("/applications")), false);
});
test("full HTTP path accepts 201, does not resend OTP, validates all files, and never signs/submits", async () => {
  const h = await harness(); const result = await runBorrowerJourney(h.options);
  assert.equal(result.status, "package_verified", JSON.stringify(result)); assert.equal(result.exitCode, 0);
  assert.equal(result.bundleId, bundleId); assert.equal(result.notVerified.length, 4);
  assert.equal(h.calls.filter(c => c.path.endsWith("/build-package")).length, 1);
  assert.equal(h.calls.some(c => c.body?.action === "send"), false);
  assert.equal(h.calls.some(c => /\/(seal|kyc|esign|mock-complete)/.test(c.path)), false);
  assert.ok(h.calls.some(c => c.path.endsWith("/files/record")));
});

test("HTTP journey follows preparation into its exact final bundle", async () => {
  const h = await harness({ preparation: "succeeded" });
  const result = await runBorrowerJourney(h.options);
  assert.equal(result.status, "package_verified", JSON.stringify(result));
  assert.equal(result.bundleId, bundleId);
  assert.equal(h.calls.filter(call => call.path.endsWith("/build-package")).length, 1);
});
test("prepared but unreleased package verifies the lock and reports an incomplete journey", async () => {
  const h = await harness({releaseLocked:true});
  const report = await runBorrowerJourney(h.options);
  assert.equal(report.status,"blocked"); assert.equal(report.exitCode,2);
  assert.ok(report.steps.some(step=>step.name.includes("remain locked") && step.status === "passed"));
  assert.match(report.steps.at(-1)!.detail,/All six artifacts are prepared/);
  assert.ok(report.notVerified.some(item=>item.includes("file contents")));
});
test("the journey fails if unreleased documents leak", async () => {
  const h = await harness({releaseLocked:true,leakPackage:true});
  assert.equal((await runBorrowerJourney(h.options)).status,"failed");
});
test("unknown release state cannot produce a passing download", async () => {
  const h = await harness({releaseUnavailable:true});
  assert.equal((await runBorrowerJourney(h.options)).status,"blocked");
  assert.equal(h.calls.some(call=>call.path.endsWith("/download/complete_package")),false);
});
for (const preparation of ["failed", "running", "wrong-run"] as const) {
  test(`HTTP journey cannot pass with ${preparation} preparation`, async () => {
    const h = await harness({ preparation });
    const result = await runBorrowerJourney(h.options);
    assert.notEqual(result.status, "package_verified");
    assert.equal(h.calls.some(call => call.path.endsWith("/download/complete_package")), false);
  });
}
test("generation requires explicit spend permission before any requests", async () => {
  const h = await harness(); const result = await runBorrowerJourney({ ...h.options, allowGeneration: false });
  assert.equal(result.exitCode, 2); assert.equal(h.calls.length, 0);
});
test("continuation verifies existing inputs without overwriting answers, ownership, documents or assumptions", async () => {
  const h = await harness({ prepared: true });
  const result = await runBorrowerJourney({ ...h.options, resumeDealId: dealId, scenario: undefined, documents: undefined });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.ok(result.notVerified.includes("Initial capture and uploads before this resumed session"));
  const writes = h.calls.filter(c => c.method === "POST");
  assert.deepEqual(writes.map(c => c.path), ["/api/brokerage/session", "/api/qa/borrower/applications", `/api/brokerage/deals/${dealId}/borrower-actions/build-package`]);
});
for (const [name, change, exitCode, forbidden] of [
  ["non-QA session", { nonQA: true }, 2, "/files/sign"],
  ["real deal", { realDeal: true }, 2, "/files/sign"],
  ["failed answer save", { answerFails: true }, 1, "/files/sign"],
  ["failed storage upload", { uploadFails: true }, 1, "/files/record"],
  ["lost answer persistence", { persistenceLost: true }, 1, "/build-package"],
  ["unmet readiness", { readinessBlocked: true }, 2, "/build-package"],
  ["failed generation", { generationState: "failed" }, 1, "/download/complete_package"],
  ["generation timeout", { generationState: "running" }, 2, "/download/complete_package"],
  ["wrong generation run", { wrongBundle: true }, 1, "/download/complete_package"],
  ["missing sixth artifact", { missingArtifact: true }, 1, "/download/complete_package"],
] as const) {
  test(`${name} stops at the first boundary`, async () => {
    const h = await harness(change); const result = await runBorrowerJourney(h.options);
    assert.equal(result.exitCode, exitCode, JSON.stringify(result));
    assert.equal(h.calls.some(c => c.path.endsWith(forbidden)), false);
    assert.equal(result.steps.filter(s => s.status !== "passed").length, 1);
  });
}
test("borrower access to the internal memo fails the test", async () => {
  const h = await harness({ leakMemo: true }); assert.equal((await runBorrowerJourney(h.options)).exitCode, 1);
});
for (const [name, change] of [
  ["missing file", { missing: "04-financial-spreads.pdf" }],
  ["internal memo leak", { memo: true }],
  ["wrong run", { run: "stale-run" }],
  ["broken PDF", { corrupt: "01-business-plan.pdf" }],
  ["broken workbook", { corrupt: "02-projections-and-assumptions.xlsx" }],
] as const) {
  test(`ZIP validation rejects ${name}`, async () => {
    const bytes = await packageZip(change);
    await assert.rejects(() => verifyBorrowerZip(bytes, bundleId));
  });
}

test("cookies are merged/cleared by name and cannot leave the origin", async () => {
  let n = 0;
  const http = new BorrowerHttp("https://www.buddysba.com", async () => {
    n++;
    return Response.json({ ok: true }, { headers: { "set-cookie": n === 1 ? "buddy_qa_chooser=chooser; Path=/" : n === 2 ? "buddy_borrower_session=session; Path=/" : "buddy_qa_chooser=; Max-Age=0; Path=/" } });
  });
  await http.json("/first"); await http.json("/second"); assert.equal(http.jar.size, 2);
  await http.json("/third"); assert.equal(http.jar.size, 1); assert.equal(http.jar.get("buddy_borrower_session"), "session");
  await assert.rejects(() => http.raw("https://elsewhere.example.test")); assert.equal(n, 3);
});
test("rejects non-synthetic/incomplete scenarios and insecure remote origins", () => {
  assert.equal(scenarioSchema.safeParse({ ...scenario, synthetic: false }).success, false);
  assert.equal(scenarioSchema.safeParse({ ...scenario, documents: [] }).success, false);
  assert.throws(() => new BorrowerHttp("http://www.buddysba.com"));
  assert.throws(() => new BorrowerHttp("https://user:secret@www.buddysba.com"));
});
test("runner stays wired to the actual guided-answer and QA creation contracts", async () => {
  const concierge = await readFile("src/app/api/brokerage/concierge/route.ts", "utf8");
  const qa = await readFile("src/app/api/qa/borrower/applications/route.ts", "utf8");
  assert.match(concierge, /action === "guided_answer"/);
  assert.match(qa, /isNew: true }, 201/);
});
