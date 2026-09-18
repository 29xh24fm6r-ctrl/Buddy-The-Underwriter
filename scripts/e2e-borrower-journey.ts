/**
 * Real HTTP borrower-to-package verification. See docs/borrower-journey-verification.md.
 * Exit 0 = the final package was generated and its downloaded files inspected.
 * Exit 1 = failure. Exit 2 = blocked/incomplete, NEVER an end-to-end pass.
 * No database writes, test-auth bypass, vendor impersonation or lender submission.
 */
import { BorrowerHttp, loadScenario, runBorrowerJourney } from "./lib/borrowerJourney";

async function main() {
  const sendCodeOnly = process.argv.includes("--send-code");
  const scenarioPath = process.env.BUDDY_E2E_SCENARIO;
  const input = !sendCodeOnly && scenarioPath ? await loadScenario(scenarioPath) : undefined;
  const report = await runBorrowerJourney({
    http: new BorrowerHttp(process.env.BUDDY_BASE_URL ?? "http://localhost:3000"),
    email: process.env.BORROWER_QA_EMAIL ?? "",
    otp: process.env.BUDDY_E2E_OTP,
    sendCodeOnly,
    resumeDealId: process.env.BUDDY_E2E_DEAL_ID,
    scenario: input?.scenario,
    documents: input?.documents,
    allowGeneration: process.env.BUDDY_E2E_ALLOW_GENERATION === "true",
    onStep: step => console.log(`${step.status.toUpperCase()} ${step.name}${step.detail ? ` — ${step.detail}` : ""}`),
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(report.status === "package_verified"
    ? "Final borrower package verified over HTTP. Identity, signatures and lender delivery are NOT verified."
    : "Borrower journey incomplete. No end-to-end success claim.");
  process.exitCode = report.exitCode;
}

main().catch(() => {
  console.error("Invalid scenario, source PDFs, or site origin. No end-to-end success claim. Check inputs locally; do not publish secrets.");
  process.exitCode = 1;
});
