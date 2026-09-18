import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { BORROWER_PACKAGE_FILES, LENDER_PACKAGE_FILES } from "../../src/lib/brokerage/lenderPackageFiles";

// Inputs must be deliberately supplied synthetic QA data. Never manufacture
// answers, financial facts, identities, signatures, or readiness in the DB.
export const scenarioSchema = z.object({
  synthetic: z.literal(true),
  ownership: z.object({
    structure: z.enum(["solo", "multi"]),
    owners: z.array(z.object({ full_name: z.string().min(1), ownership_pct: z.number().min(0).max(100) })).min(1),
  }),
  chapters: z.array(z.object({ n: z.number().int().min(2).max(5), data: z.record(z.string(), z.unknown()) })).default([]),
  answers: z.array(z.object({ questionId: z.string().min(1), ownerName: z.string().min(1).optional(), value: z.unknown(), confirmed: z.boolean().optional() })).min(1),
  documents: z.array(z.object({ path: z.string().min(1), checklistKey: z.string().min(1) })).min(2),
  assumptions: z.record(z.string(), z.unknown()),
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type SourceDocument = { filename: string; checklistKey: string; bytes: Uint8Array };
export type Step = { name: string; status: "passed" | "failed" | "blocked"; detail: string };
export type JourneyReport = {
  status: "package_verified" | "failed" | "blocked";
  exitCode: number;
  dealId?: string;
  bundleId?: string;
  steps: Step[];
  // HTTP integration is not browser verification, signature proof or delivery.
  notVerified: string[];
};
export class JourneyStop extends Error {
  constructor(message: string, readonly blocked = false) { super(message); }
}

export async function loadScenario(path: string): Promise<{ scenario: Scenario; documents: SourceDocument[] }> {
  const scenario = scenarioSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const documents: SourceDocument[] = [];
  for (const source of scenario.documents) {
    const bytes = await readFile(resolve(dirname(path), source.path));
    // The previous 35-byte pseudo-PDF could upload but could never be extracted.
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() < 1) throw new JourneyStop("Each source PDF must have at least one page.");
    documents.push({ filename: basename(source.path), checklistKey: source.checklistKey, bytes });
  }
  if (new Set(documents.map(d => d.filename)).size !== documents.length)
    throw new JourneyStop("Use distinct source filenames so resume checks are unambiguous.");
  return { scenario, documents };
}

/** An origin-bound, in-memory cookie jar. Never prints or persists credentials. */
export class BorrowerHttp {
  readonly jar = new Map<string, string>();
  readonly origin: string;
  constructor(base: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new JourneyStop("BUDDY_BASE_URL must be an origin without credentials, path, or query.");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      throw new JourneyStop("Use HTTPS, or localhost for a local test server.");
    this.origin = url.origin;
  }
  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new JourneyStop("Refusing to send borrower cookies to a different origin.");
    const headers = new Headers(init.headers);
    if (this.jar.size) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await this.fetcher(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(60_000) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      const key = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (separator < 1 || !key.startsWith("buddy_")) continue;
      if (!value || /max-age=0(?:;|$)|expires=Thu, 01 Jan 1970/i.test(cookie)) this.jar.delete(key);
      else this.jar.set(key, value);
    }
    return response;
  }
  async json(path: string, body?: object): Promise<any> {
    const response = await this.raw(path, body === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      // Don't print response bodies: they can contain facts, URLs or sessions.
      const code = typeof result?.error === "string" && /^[a-z_]+$/.test(result.error) ? ` (${result.error})` : "";
      throw new JourneyStop(`HTTP ${response.status}${code}. Inspect the borrower UI and request logs.`, [401, 403].includes(response.status));
    }
    return result;
  }
  async upload(document: SourceDocument, dealId: string) {
    const signed = await this.json(`/api/borrower/portal/${dealId}/files/sign`, {
      filename: document.filename, mime_type: "application/pdf", size_bytes: document.bytes.byteLength, checklist_key: document.checklistKey,
    });
    const upload = signed.upload;
    if (!upload?.signed_url || !upload.file_id || !upload.object_path || !upload.upload_session_id)
      throw new JourneyStop("Upload signing response is missing its storage path or session.");
    const url = new URL(upload.signed_url);
    if (url.protocol !== "https:") throw new JourneyStop("Signed upload URL must use HTTPS.");
    // The storage URL is issued by the authenticated sign route. No borrower
    // cookies or API credentials cross over to the storage host.
    const put = await this.fetcher(url, {
      method: "PUT", redirect: "error", headers: upload.headers ?? { "content-type": "application/pdf" },
      body: Buffer.from(document.bytes), signal: AbortSignal.timeout(60_000),
    });
    if (!put.ok) throw new JourneyStop(`Source upload failed: HTTP ${put.status}.`);
    const response = await this.raw(`/api/portal/${dealId}/files/record`, {
      method: "POST", headers: { "content-type": "application/json", "x-buddy-upload-session-id": upload.upload_session_id },
      body: JSON.stringify({
        file_id: upload.file_id, object_path: upload.object_path, upload_session_id: upload.upload_session_id,
        original_filename: document.filename, mime_type: "application/pdf", size_bytes: document.bytes.byteLength,
        checklist_key: document.checklistKey,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok === false || !result) throw new JourneyStop(`Recording upload failed: HTTP ${response.status}.`);
  }
}

export async function verifyBorrowerZip(bytes: Uint8Array, bundleId: string): Promise<void> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const expected = [...BORROWER_PACKAGE_FILES.map(f => f.filename), "Read-me.txt"].sort();
  const actual = Object.keys(zip.files).filter(key => !zip.files[key].dir).sort();
  if (!isDeepStrictEqual(actual, expected)) throw new JourneyStop("Download contains missing, unexpected, or lender-only files.");
  const readme = await zip.file("Read-me.txt")!.async("string");
  if (!readme.split(/\r?\n/).includes(`Run: ${bundleId}`)) throw new JourneyStop("Downloaded package is from a different generation run.");
  for (const file of BORROWER_PACKAGE_FILES) {
    const content = await zip.file(file.filename)!.async("uint8array");
    if (file.filename.endsWith(".pdf")) {
      const pdf = await PDFDocument.load(content);
      if (pdf.getPageCount() < 1) throw new JourneyStop(`${file.label} has no pages.`);
    } else {
      const workbook = await JSZip.loadAsync(content, { checkCRC32: true });
      if (!workbook.file("[Content_Types].xml") || !workbook.file("xl/workbook.xml"))
        throw new JourneyStop("Projections download is not an XLSX workbook.");
      const parsed = new ExcelJS.Workbook();
      await parsed.xlsx.load(Uint8Array.from(content).buffer);
      if (!parsed.worksheets.some(sheet => sheet.actualRowCount > 0))
        throw new JourneyStop("Projections workbook has no populated worksheets.");
    }
  }
}

type Options = {
  http: BorrowerHttp;
  email: string;
  otp?: string;
  sendCodeOnly?: boolean;
  resumeDealId?: string;
  scenario?: Scenario;
  documents?: SourceDocument[];
  allowGeneration?: boolean;
  maxPolls?: number;
  pause?: () => Promise<void>;
  onStep?: (step: Step) => void;
};

export async function runBorrowerJourney(options: Options): Promise<JourneyReport> {
  const { http } = options;
  const report: JourneyReport = {
    status: "blocked", exitCode: 2, steps: [],
    notVerified: ["Browser usability", "Real identity verification", "Completed SBA signatures", "Final submission and lender receipt"],
  };
  let current = "Test prerequisites";
  const record = (status: Step["status"], detail: string) => {
    const entry = { name: current, status, detail };
    report.steps.push(entry); options.onStep?.(entry);
  };
  const step = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    current = name;
    const value = await work(); record("passed", ""); return value;
  };
  function require(ok: unknown, detail: string, blocked = false): asserts ok {
    if (!ok) throw new JourneyStop(detail, blocked);
  }
  try {
    require(options.email.trim(), "BORROWER_QA_EMAIL is required.", true);
    if (!options.sendCodeOnly) {
      require(options.otp?.trim(), "Authenticate the configured QA borrower with a real email code. No request was sent.", true);
      if (options.resumeDealId) {
        require(/^[0-9a-f-]{36}$/i.test(options.resumeDealId), "Invalid QA application ID.");
        require(!options.scenario, "Continuation is read-only for captured inputs; do not supply a scenario when resuming.");
        report.notVerified.push("Initial capture and uploads before this resumed session");
      } else {
        require(options.scenario?.synthetic === true && (options.documents?.length ?? 0) >= 2, "Supply a validated synthetic scenario and at least two real PDF source files.", true);
      }
      require(options.allowGeneration === true, "Set BUDDY_E2E_ALLOW_GENERATION=true to authorize one paid final-package run.", true);
    }
    await step("Public borrower entry", async () => {
      const response = await http.raw("/start");
      require(response.status === 200, `HTTP ${response.status}. Use the canonical site origin (https://www.buddysba.com).`);
    });
    if (options.sendCodeOnly) {
      await step("Send QA verification email", () => http.json("/api/brokerage/session", { action: "send", email: options.email, name: "Buddy QA Borrower" }));
      current = "Email verification";
      throw new JourneyStop("Code requested only; the borrower journey has NOT passed. Continue with the delivered code through your secure local environment.", true);
    }
    // Never resend here: sending again invalidates the code the operator just read.
    await step("Verify email", () => http.json("/api/brokerage/session", { action: "verify", email: options.email, code: options.otp }));
    await step("Verify QA identity", () => http.json("/api/qa/borrower/applications"));
    const application = await step("Select isolated QA application", () => http.json("/api/qa/borrower/applications", options.resumeDealId
      ? { action: "resume", dealId: options.resumeDealId } : { action: "create" }));
    const dealId = application.dealId;
    require(typeof dealId === "string" && /^[0-9a-f-]{36}$/i.test(dealId), "QA chooser returned no valid deal ID.");
    report.dealId = dealId;
    const actions = `/api/brokerage/deals/${dealId}/borrower-actions/`;
    await step("Confirm test isolation", async () => {
      const state = await http.json(actions + "package-status");
      require(state.readiness?.evidence?.isTestDeal === true, "Refusing to change an application that is not confirmed is_test=true.", true);
    });
    const savedAnswers: Array<{ questionId: string; value: unknown }> = [];
    if (!options.resumeDealId) {
    const scenario = options.scenario!;
    await step("Save ownership", () => http.json("/api/brokerage/concierge", { action: "save_ownership", ...scenario.ownership }));
    for (const chapter of scenario.chapters) {
      await step(`Save intake chapter ${chapter.n}`, () => http.json("/api/borrower/intake/progress", { chapter: chapter.n, data: chapter.data }));
    }
    for (const answer of scenario.answers) {
      await step(`Save guided answer ${answer.questionId}`, async () => {
        const { snapshot } = await http.json(`/api/brokerage/concierge?dealId=${dealId}`);
        require(Array.isArray(snapshot?.questions) && !snapshot.readErrors?.length, "Guided answers could not be read.");
        // Owner-scoped IDs include a server-generated UUID. Resolve it from
        // this session's snapshot, never guess IDs or select a fuzzy match.
        const candidates = snapshot.questions.filter((q: any) => answer.ownerName
          ? q.field?.registryEntry?.factPath === answer.questionId && q.ownerName === answer.ownerName
          : q.id === answer.questionId);
        require(candidates.length === 1, "Scenario answer did not resolve to exactly one question.");
        const question = candidates[0];
        require(question?.responsibility === "borrower" && question.state !== "not_applicable", "Scenario answer is not applicable to this application.");
        // Protected identifiers / legal attestations are completed by the QA
        // operator in the product, not invented to advance a test.
        require(!question.field?.requiresPiiVault, "Protected identifier requires the borrower's secure UI.", true);
        const saved = await http.json("/api/brokerage/concierge", {
          action: "guided_answer", dealId, questionId: question.id, value: answer.value,
          confirmed: answer.confirmed, expectedValue: question.value, source: "text",
        });
        const confirmed = saved.snapshot?.questions?.find((q: any) => q.id === question.id);
        require(confirmed?.state === "saved", "Answer was not confirmed saved by the server.");
        savedAnswers.push({ questionId: question.id, value: confirmed.value });
      });
    }
    for (const document of options.documents!) {
      await step(`Upload source ${document.filename}`, () => http.upload(document, dealId));
    }
    }
    const snapshotPath = `/api/brokerage/concierge?dealId=${dealId}`;
    const documentPath = `/api/borrower/portal/${dealId}/documents`;
    await step("Anonymous document access denied", async () => {
      const session = new Map(http.jar); http.jar.clear();
      try {
        const response = await http.raw(documentPath);
        require([401, 403, 404].includes(response.status), `Unauthenticated document request returned HTTP ${response.status}.`);
      } finally { http.jar.clear(); for (const [key, value] of session) http.jar.set(key, value); }
    });
    await step("Reload saved answers and source documents", async () => {
      const { snapshot } = await http.json(snapshotPath);
      require(Array.isArray(snapshot?.questions) && !snapshot.readErrors?.length, "Saved answers could not be verified.");
      for (const saved of savedAnswers) {
        const question = snapshot?.questions?.find((q: any) => q.id === saved.questionId);
        require(question?.state === "saved" && isDeepStrictEqual(question.value, saved.value), "A saved answer did not survive reload.");
      }
      const { documents } = await http.json(documentPath);
      require(Array.isArray(documents) && documents.length >= 2, "At least two uploaded documents must survive reload.");
      for (const source of options.documents ?? [])
        require(documents.filter((d: any) => (d.file_name ?? d.filename ?? d.name) === source.filename).length === 1, "An uploaded document was missing or duplicated after reload.");
    });
    await step(options.resumeDealId ? "Verify existing confirmed assumptions" : "Confirm reviewed financial assumptions", async () => {
      const saved = await http.json(actions + "assumptions");
      const confirmed = options.resumeDealId ? saved : await http.json(actions + "assumptions", { assumptions: options.scenario!.assumptions, revision: saved.revision, confirmed: true });
      require(confirmed.status === "confirmed", "Assumptions are not confirmed.");
      const reloaded = await http.json(actions + "assumptions");
      require(reloaded.status === "confirmed" && reloaded.revision === confirmed.revision && isDeepStrictEqual(reloaded.assumptions, confirmed.assumptions), "Confirmed assumptions did not survive reload.");
    });
    await step("Authoritative package readiness", async () => {
      const state = await http.json(actions + "package-status");
      // No admin writes, injected facts, lowered gates or repeated paid retries.
      require(state.readiness?.readyToGenerate === true, `Package is not ready (${state.readiness?.blockers?.length ?? "unknown"} blockers). Review the package screen; no generation was started.`, true);
    });
    const generation = await step("Request final-package generation once", () => http.json(actions + "build-package", {}));
    require(typeof generation.bundleId === "string" && generation.bundleId.length > 0, "Generation did not return a bundle ID.");
    report.bundleId = generation.bundleId;
    if (generation.completed === true) report.notVerified.push("Fresh generation (an existing completed run was reused)");
    await step("Wait for all six artifacts from this run", async () => {
      const maxPolls = options.maxPolls ?? 60;
      require(Number.isInteger(maxPolls) && maxPolls >= 1 && maxPolls <= 120, "Poll limit must be between 1 and 120.");
      for (let i = 0; i < maxPolls; i++) {
        const state = await http.json(actions + "package-status");
        const bundle = state.bundle;
        require(bundle?.id === generation.bundleId, "Status is not for the generation started by this test.");
        require(!["failed", "cancelled"].includes(bundle.status), "Package generation failed. Inspect its stage and error in the package screen.");
        if (bundle.status === "succeeded") {
          require(LENDER_PACKAGE_FILES.every(file => bundle[file.column]), "Final run succeeded but is missing required artifacts.");
          return;
        }
        require(["pending", "running"].includes(bundle.status), "Unknown package generation state.");
        if (i + 1 < maxPolls) await (options.pause ?? (() => new Promise(resolve => setTimeout(resolve, 15_000))))();
      }
      throw new JourneyStop("Timed out waiting for the package. The existing job may still run; do not start a duplicate.", true);
    });
    await step("Download and inspect the borrower package", async () => {
      const response = await http.raw(`/api/brokerage/deals/${dealId}/trident/download/complete_package`);
      require(response.ok && response.headers.get("content-type")?.includes("application/zip"), `Package download returned HTTP ${response.status}, not a ZIP.`);
      await verifyBorrowerZip(new Uint8Array(await response.arrayBuffer()), generation.bundleId);
    });
    await step("Internal credit memo remains lender-only", async () => {
      const response = await http.raw(`/api/brokerage/deals/${dealId}/trident/download/credit_memo`);
      require(response.status === 404, "Borrower must not receive the internal credit memo.");
    });
    report.status = "package_verified"; report.exitCode = 0;
    // Deliberately no seal/submit/kyc/esign mutations: QA must never deliver a
    // synthetic package to a lender or sign real legal forms automatically.
  } catch (error) {
    const blocked = error instanceof JourneyStop && error.blocked;
    record(blocked ? "blocked" : "failed", error instanceof JourneyStop ? error.message : "Unexpected request or document-validation failure; inspect locally without publishing credentials or borrower data.");
    report.status = blocked ? "blocked" : "failed"; report.exitCode = blocked ? 2 : 1;
  }
  return report;
}
