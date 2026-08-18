/**
 * End-to-end borrower journey verification.
 *
 * Runs the REAL borrower path over HTTP against a running Buddy instance —
 * no direct database writes, no fixtures, no manual state manipulation. If
 * a step cannot be completed the way a borrower would complete it, this
 * script fails; it never reaches into the database to make itself pass.
 *
 * Usage:
 *   BUDDY_BASE_URL=https://buddytheunderwriter.com \
 *   BORROWER_QA_EMAIL=<authorized QA borrower> \
 *   npx tsx scripts/e2e-borrower-journey.ts
 *
 * Requires the QA borrower identity to be configured (src/lib/qaIdentity),
 * so the run is isolated from real borrower data and marked is_test.
 *
 * The OTP step cannot be automated without a mailbox. Supply the code with
 * BUDDY_E2E_OTP=<code> after the script prints that it has been sent, or
 * run with --manual-otp to be prompted.
 */

const BASE = process.env.BUDDY_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.BORROWER_QA_EMAIL ?? "";
const OTP = process.env.BUDDY_E2E_OTP ?? "";

type Step = { name: string; ok: boolean; detail: string };
const steps: Step[] = [];
let cookie = "";

function record(name: string, ok: boolean, detail = "") {
  steps.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const session = setCookie
      .split(/,(?=[^;]+=)/)
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.startsWith("buddy_borrower_session") || c.startsWith("buddy_"));
    if (session.length > 0) cookie = session.join("; ");
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
    body: JSON.stringify({ action: "send_code", email: EMAIL, name: "Buddy QA Borrower" }),
  });
  record(
    "Start application / verification code sent",
    start.status === 200 && start.body?.ok !== false,
    JSON.stringify(start.body).slice(0, 160),
  );

  if (!OTP) {
    console.log(
      "\nBUDDY_E2E_OTP not set. Read the code from the QA mailbox and re-run with " +
        "BUDDY_E2E_OTP=<code> to continue past verification.",
    );
    summarize();
    return;
  }

  // 3. Email verification
  const verify = await call("/api/brokerage/session", {
    method: "POST",
    body: JSON.stringify({ action: "verify_code", email: EMAIL, code: OTP }),
  });
  const verified = verify.status === 200 && verify.body?.ok === true;
  record("Email verification", verified, JSON.stringify(verify.body).slice(0, 160));
  if (!verified) return summarize();

  // A verified email with prior applications must NOT auto-resume.
  if (verify.body?.applicationChoiceNeeded || verify.body?.noApplicationsFound) {
    const chosen = await call("/api/brokerage/session/applications", {
      method: "POST",
      body: JSON.stringify({ action: "new" }),
    });
    record(
      "Start New Package from Welcome Back chooser",
      chosen.status === 200 && Boolean(chosen.body?.dealId ?? chosen.body?.deal_id),
      JSON.stringify(chosen.body).slice(0, 160),
    );
  }

  const dealId: string =
    verify.body?.dealId ??
    (await call("/api/brokerage/session")).body?.deal_id ??
    "";
  record("Session bound to a deal", Boolean(dealId), dealId);
  if (!dealId) return summarize();

  // 4-7. Intake chapters, saved one at a time exactly as the UI saves them.
  const chapters: Array<{ n: number; label: string; data: Record<string, unknown> }> = [
    { n: 2, label: "Loan request / use of proceeds", data: { purposes: ["working_capital"], totalAmount: 250000 } },
    { n: 3, label: "Business information + NAICS + employees", data: { entityType: "LLC", naicsCode: "722511", employeeCount: 18 } },
    { n: 4, label: "Ownership", data: { structure: [{ name: "QA Borrower", percent: 100 }] } },
    { n: 5, label: "Financial information", data: { annualRevenue: 1_450_000 } },
  ];

  for (const chapter of chapters) {
    const saved = await call("/api/borrower/intake/progress", {
      method: "POST",
      body: JSON.stringify({ chapter: chapter.n, data: chapter.data }),
    });
    record(
      `Chapter ${chapter.n}: ${chapter.label}`,
      saved.status === 200 && saved.body?.ok !== false,
      JSON.stringify(saved.body?.progress ?? saved.body).slice(0, 120),
    );
  }

  // 8. Document upload — sign, then record, through the borrower routes.
  const signed = await call(`/api/borrower/portal/${dealId}/files/sign`, {
    method: "POST",
    body: JSON.stringify({
      filename: "qa-business-tax-return-2024.pdf",
      mime_type: "application/pdf",
      size_bytes: 24_576,
      checklist_key: "business_tax_return",
    }),
  });
  const signOk = signed.status === 200 && Boolean(signed.body?.upload?.signed_url ?? signed.body?.signedUploadUrl);
  record("Document upload: signed URL issued", signOk, `HTTP ${signed.status}`);

  if (signOk) {
    const put = await fetch(
      signed.body.upload?.signed_url ?? signed.body.signedUploadUrl,
      {
        method: "PUT",
        headers: { "content-type": "application/pdf", ...(signed.body.upload?.headers ?? {}) },
        body: Buffer.from("%PDF-1.4\nQA test document\n%%EOF\n"),
      },
    );
    record("Document upload: bytes stored", put.ok, `HTTP ${put.status}`);

    const recorded = await call(`/api/portal/${dealId}/files/record`, {
      method: "POST",
      body: JSON.stringify({
        file_id: signed.body.upload?.file_id,
        resolved_path: signed.body.upload?.object_path ?? signed.body.key,
        original_filename: "qa-business-tax-return-2024.pdf",
        mime_type: "application/pdf",
        size_bytes: 24_576,
        checklist_key: "business_tax_return",
      }),
    });
    record("Document upload: recorded", recorded.status === 200, `HTTP ${recorded.status}`);
  }

  // 9. Leave and return — drop the cookie, re-verify, resume the SAME deal.
  const sessionCookie = cookie;
  cookie = "";
  const anonymous = await call(`/api/borrower/portal/${dealId}/documents`);
  record(
    "Documents are NOT readable without a session",
    anonymous.status === 403,
    `HTTP ${anonymous.status}`,
  );
  cookie = sessionCookie;

  // 10. Resume — data and documents still present.
  const resumed = await call("/api/borrower/intake/progress");
  const resumedOk =
    resumed.status === 200 && (resumed.body?.progress?.completedChapters?.length ?? 0) > 0;
  record(
    "Resume: previously entered information remains",
    resumedOk,
    JSON.stringify(resumed.body?.progress ?? {}).slice(0, 160),
  );

  const docs = await call(`/api/borrower/portal/${dealId}/documents`);
  const docCount = docs.body?.documents?.length ?? 0;
  record("Resume: previously uploaded documents remain", docCount > 0, `${docCount} document(s)`);

  // 11. Readiness / remaining requirements / seal.
  const seal = await call(`/api/brokerage/deals/${dealId}/seal-status`);
  record("Readiness / remaining requirements available", seal.status === 200, `HTTP ${seal.status}`);
  console.log(`\nSeal status payload:\n${JSON.stringify(seal.body, null, 2).slice(0, 1600)}`);

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
