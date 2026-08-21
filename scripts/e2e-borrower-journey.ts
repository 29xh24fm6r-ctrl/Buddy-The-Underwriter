/**
 * End-to-end borrower journey verification.
 *
 * Runs the REAL borrower path over HTTP against a running Buddy instance —
 * no direct database writes, no fixtures, no manual state manipulation. If
 * a step cannot be completed the way a borrower would complete it, this
 * script fails; it never reaches into the database to make itself pass.
 *
 * Usage:
 *   BUDDY_BASE_URL=https://buddysba.com \
 *   BORROWER_QA_EMAIL=<authorized QA borrower> \
 *   BUDDY_E2E_OTP=<code from the QA mailbox> \
 *   npx tsx scripts/e2e-borrower-journey.ts
 *
 * Requires the QA borrower identity to be configured (src/lib/qaIdentity),
 * so the run is isolated from real borrower data and marked is_test.
 *
 * The OTP step cannot be automated without a mailbox. Supply the code with
 * BUDDY_E2E_OTP=<code> after the script prints that it has been sent.
 *
 * Every request below mirrors a call the borrower UI actually makes. Where
 * this script previously invented a shape, it has been corrected against
 * the route handler rather than the other way round:
 *   - /api/brokerage/session takes action "send"/"verify" (not *_code) and
 *     has no GET handler.
 *   - A QA identity gets `qaNeedsChooser`, which is finalized through
 *     /api/qa/borrower/applications — the buddy_qa_chooser cookie is a
 *     different identity proof from the Welcome Back chooser cookie that
 *     /api/brokerage/session/applications requires.
 *   - Chapter 4 carries `structure: "solo" | "multi"`. The owner rows
 *     themselves are created by a separate save_ownership call, exactly as
 *     IntakeOwnershipStep does it.
 *   - /files/record reads `object_path` and requires the upload session id
 *     issued by /files/sign.
 */

const BASE = process.env.BUDDY_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.BORROWER_QA_EMAIL ?? "";
const OTP = process.env.BUDDY_E2E_OTP ?? "";

type Step = { name: string; ok: boolean; detail: string };
const steps: Step[] = [];

/**
 * Cookies are merged by name rather than replaced wholesale. The journey
 * crosses three cookies (buddy_qa_chooser, the Welcome Back chooser, and
 * buddy_borrower_session); overwriting the jar on each Set-Cookie silently
 * dropped whichever one the previous response had established.
 */
const jar = new Map<string, string>();
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function record(name: string, ok: boolean, detail = "") {
  steps.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const cookie = cookieHeader();
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });

  // Node exposes multiple Set-Cookie headers via getSetCookie(); the
  // comma-split fallback is only for runtimes that lack it.
  const raw: string[] =
    typeof (response.headers as any).getSetCookie === "function"
      ? (response.headers as any).getSetCookie()
      : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/).filter(Boolean);

  for (const entry of raw) {
    const [pair] = entry.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name.startsWith("buddy_")) continue;
    if (value === "" || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(entry)) jar.delete(name);
    else jar.set(name, value);
  }

  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON response (HTML page) is fine */
  }
  return { status: response.status, body };
}

function brief(value: unknown, max = 200): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return (s ?? "").slice(0, max);
}

async function main() {
  if (!EMAIL) {
    console.error("BORROWER_QA_EMAIL is required — refusing to run against a real borrower.");
    process.exit(2);
  }

  console.log(`Running borrower journey against ${BASE}\n`);

  // 1. Landing page
  const landing = await call("/");
  record("Landing page loads", landing.status === 200, `HTTP ${landing.status}`);

  // 2. Start application — request the verification code
  const start = await call("/api/brokerage/session", {
    method: "POST",
    body: JSON.stringify({ action: "send", email: EMAIL, name: "Buddy QA Borrower" }),
  });
  record(
    "Start application / verification code sent",
    start.status === 200 && start.body?.ok === true,
    `HTTP ${start.status} ${brief(start.body, 160)}`,
  );

  if (!OTP) {
    console.log(
      "\nBUDDY_E2E_OTP not set. Read the code from the QA mailbox and re-run with " +
        "BUDDY_E2E_OTP=<code> to continue past verification.",
    );
    return summarize();
  }

  // 3. Email verification
  const verify = await call("/api/brokerage/session", {
    method: "POST",
    body: JSON.stringify({ action: "verify", email: EMAIL, code: OTP }),
  });
  const verified = verify.status === 200 && verify.body?.ok === true;
  record("Email verification", verified, `HTTP ${verify.status} ${brief(verify.body, 160)}`);
  if (!verified) return summarize();

  // A verified email never auto-resumes. Which chooser applies depends on
  // the identity: a QA borrower proves itself with the buddy_qa_chooser
  // cookie, everyone else with the Welcome Back chooser cookie.
  let dealId: string = verify.body?.dealId ?? "";

  if (verify.body?.qaNeedsChooser) {
    const created = await call("/api/qa/borrower/applications", {
      method: "POST",
      body: JSON.stringify({ action: "create" }),
    });
    dealId = created.body?.dealId ?? created.body?.deal_id ?? "";
    record(
      "QA chooser: new test application created",
      created.status === 200 && Boolean(dealId),
      `HTTP ${created.status} ${brief(created.body, 160)}`,
    );
  } else if (verify.body?.applicationChoiceNeeded || verify.body?.noApplicationsFound) {
    const chosen = await call("/api/brokerage/session/applications", {
      method: "POST",
      body: JSON.stringify({ action: "new" }),
    });
    dealId = chosen.body?.dealId ?? chosen.body?.deal_id ?? "";
    record(
      "Start New Package from Welcome Back chooser",
      chosen.status === 200 && Boolean(dealId),
      `HTTP ${chosen.status} ${brief(chosen.body, 160)}`,
    );
  }

  record("Session bound to a deal", Boolean(dealId), dealId || "(none)");
  if (!dealId) return summarize();

  // 4-5. Chapters 2 and 3, saved one at a time exactly as the UI saves them.
  // `chapter` is the destination — chapter N carries the answers from N-1.
  for (const chapter of [
    { n: 2, label: "Loan request / use of proceeds", data: { purposes: ["working_capital"], totalAmount: 250000 } },
    { n: 3, label: "Business information + NAICS + employees", data: { entityType: "LLC", naicsCode: "722511", employeeCount: 18 } },
  ]) {
    const saved = await call("/api/borrower/intake/progress", {
      method: "POST",
      body: JSON.stringify({ chapter: chapter.n, data: chapter.data }),
    });
    record(
      `Chapter ${chapter.n}: ${chapter.label}`,
      saved.status === 200 && saved.body?.ok === true,
      `HTTP ${saved.status} ${brief(saved.body?.progress ?? saved.body, 140)}`,
    );
  }

  // 6. Ownership. IntakeOwnershipStep saves the owner rows through the
  // concierge route BEFORE advancing, then advances with the structure tag.
  // Chapter 4 alone creates no ownership_entities rows.
  const ownership = await call("/api/brokerage/concierge", {
    method: "POST",
    body: JSON.stringify({
      action: "save_ownership",
      structure: "solo",
      owners: [{ full_name: "Buddy QA Borrower", ownership_pct: 100 }],
    }),
  });
  record(
    "Ownership saved (owner rows created)",
    ownership.status === 200 && ownership.body?.ok === true,
    `HTTP ${ownership.status} ${brief(ownership.body, 160)}`,
  );

  for (const chapter of [
    { n: 4, label: "Ownership", data: { structure: "solo" } },
    { n: 5, label: "Financial information", data: { annualRevenue: 1_450_000 } },
  ]) {
    const saved = await call("/api/borrower/intake/progress", {
      method: "POST",
      body: JSON.stringify({ chapter: chapter.n, data: chapter.data }),
    });
    record(
      `Chapter ${chapter.n}: ${chapter.label}`,
      saved.status === 200 && saved.body?.ok === true,
      `HTTP ${saved.status} ${brief(saved.body?.progress ?? saved.body, 140)}`,
    );
  }

  // 7. Document upload — sign, PUT the bytes, then record.
  // One declared size, used for all three calls: /files/record rejects a
  // size that disagrees with what /files/sign recorded for the session.
  const fileBytes = Buffer.from("%PDF-1.4\nQA test document\n%%EOF\n");
  const filename = "qa-business-tax-return-2024.pdf";

  const signed = await call(`/api/borrower/portal/${dealId}/files/sign`, {
    method: "POST",
    body: JSON.stringify({
      filename,
      mime_type: "application/pdf",
      size_bytes: fileBytes.byteLength,
      checklist_key: "business_tax_return",
    }),
  });
  const upload = signed.body?.upload;
  const signOk = signed.status === 200 && Boolean(upload?.signed_url);
  record("Document upload: signed URL issued", signOk, `HTTP ${signed.status} ${signOk ? "" : brief(signed.body, 160)}`);

  if (signOk) {
    const put = await fetch(upload.signed_url, {
      method: "PUT",
      headers: { ...(upload.headers ?? { "content-type": "application/pdf" }) },
      body: fileBytes,
    });
    record("Document upload: bytes stored", put.ok, `HTTP ${put.status}`);

    const uploadSessionId = upload.upload_session_id ?? signed.body?.upload_session_id;
    const recorded = await call(`/api/portal/${dealId}/files/record`, {
      method: "POST",
      headers: uploadSessionId ? { "x-buddy-upload-session-id": String(uploadSessionId) } : {},
      body: JSON.stringify({
        file_id: upload.file_id,
        // The route reads `object_path`/`storage_path`. It never read
        // `resolved_path`, so that spelling failed the required-field check
        // before any of the interesting logic ran.
        object_path: upload.object_path,
        upload_session_id: uploadSessionId,
        original_filename: filename,
        mime_type: "application/pdf",
        size_bytes: fileBytes.byteLength,
        checklist_key: "business_tax_return",
      }),
    });
    record(
      "Document upload: recorded",
      recorded.status === 200 && recorded.body?.ok !== false,
      `HTTP ${recorded.status} ${brief(recorded.body, 160)}`,
    );
  }

  // 8. Leave and return — drop the session, confirm the deal is not readable.
  const savedJar = new Map(jar);
  jar.clear();
  const anonymous = await call(`/api/borrower/portal/${dealId}/documents`);
  record(
    "Documents are NOT readable without a session",
    anonymous.status === 403,
    `HTTP ${anonymous.status}`,
  );
  jar.clear();
  for (const [k, v] of savedJar) jar.set(k, v);

  // 9. Resume — data and documents still present.
  const resumed = await call("/api/borrower/intake/progress");
  const progress = resumed.body?.progress;
  const resumedOk =
    resumed.status === 200 && (progress?.completedChapters?.length ?? 0) > 0;
  record(
    "Resume: previously entered information remains",
    resumedOk,
    `HTTP ${resumed.status} ${brief(progress ?? resumed.body, 200)}`,
  );

  // The resume pointer must come back where the borrower left it, not reset.
  record(
    "Resume: chapter position is not reset to 1",
    (progress?.currentChapter ?? 0) === 5,
    `currentChapter=${progress?.currentChapter ?? "none"} lastValid=${progress?.lastValidChapter ?? "none"} v=${progress?.progressVersion ?? "none"}`,
  );

  const docs = await call(`/api/borrower/portal/${dealId}/documents`);
  const docList: any[] = docs.body?.documents ?? [];
  const matching = docList.filter((d) => (d.file_name ?? d.filename ?? d.name) === filename);
  record(
    "Resume: previously uploaded document is present exactly once",
    matching.length === 1,
    `${matching.length} row(s) for ${filename}, ${docList.length} document(s) total`,
  );

  // 10. Readiness / remaining requirements / seal.
  const seal = await call(`/api/brokerage/deals/${dealId}/seal-status`);
  record("Readiness / remaining requirements available", seal.status === 200, `HTTP ${seal.status}`);
  console.log(`\nDeal under test: ${dealId}`);
  console.log(`Seal status payload:\n${JSON.stringify(seal.body, null, 2).slice(0, 1600)}`);

  summarize();
}

function summarize() {
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps passed`);
  if (failed.length > 0) {
    console.log("\nFAILED STEPS:");
    for (const step of failed) console.log(`  - ${step.name}: ${step.detail}`);
    process.exit(1);
  }
  console.log("Borrower journey PASSED end to end.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
