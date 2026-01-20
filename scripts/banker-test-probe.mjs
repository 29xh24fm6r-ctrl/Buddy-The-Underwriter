#!/usr/bin/env node
import { execSync } from "node:child_process";
import { redactSecrets } from "./_http.mjs";

const run = (cmd) =>
  execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const tryRun = (cmd) => {
  try {
    return run(cmd);
  } catch {
    return null;
  }
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`\nUsage:\n  node scripts/banker-test-probe.mjs --base <url> --deal <dealId>\n\nOptions:\n  --base     Preview base URL (or set PREVIEW_URL/VERCEL_URL)\n  --deal     Deal ID to probe\n  --help     Show this help\n\nRequires BUDDY_BUILDER_VERIFY_TOKEN.\n`);
  process.exit(0);
}

const previewUrl =
  args.base ||
  process.env.PREVIEW_URL ||
  process.env.VERCEL_URL ||
  tryRun("node scripts/vercel-latest-url.mjs");

if (!previewUrl) {
  console.error("[banker-test-probe] Unable to determine preview URL.");
  process.exit(1);
}

const dealId = String(args.deal || "").trim();
if (!dealId) {
  console.error("[banker-test-probe] Missing deal id. Use --deal <dealId>.");
  process.exit(1);
}

const token = process.env.BUDDY_BUILDER_VERIFY_TOKEN || "";
if (!token) {
  console.error("[banker-test-probe] Missing BUDDY_BUILDER_VERIFY_TOKEN env.");
  process.exit(1);
}

const baseUrl = previewUrl.startsWith("http")
  ? previewUrl
  : `https://${previewUrl}`;

const headers = { "x-buddy-builder-token": token, "Cache-Control": "no-store" };

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { res, payload };
};

const verify = await fetchJson(
  `${baseUrl}/api/builder/verify/underwrite?dealId=${dealId}`,
  { headers }
);

const ledger = await fetchJson(
  `${baseUrl}/api/builder/deals/${dealId}/verify-ledger`,
  { headers }
);

const verifyLedger = ledger.payload?.verify ?? null;
const verifyHint = verifyLedger?.details?.html
  ? "Underwrite endpoint returned HTML — likely auth-gated."
  : verifyLedger?.details?.metaFallback
    ? "Primary JSON unavailable, meta fallback used."
    : verifyLedger?.details?.auth === false
      ? "Session not authorized to start underwriting."
      : verifyLedger?.details?.error === "banker_test_mode"
        ? "Banker test mode blocks underwriting."
        : verifyLedger?.status === "fail"
          ? "Underwrite verification has not passed."
          : "Underwrite verification passed.";

const summary = {
  ok: verify.payload?.ok ?? false,
  dealId,
  verifyStatus: verify.payload?.ok ? "pass" : "fail",
  ledgerStatus: verifyLedger?.status ?? null,
  hint: verifyHint,
};

const output = {
  baseUrl,
  dealId,
  verify: verify.payload,
  ledger: ledger.payload,
  summary,
};

console.log(JSON.stringify(redactSecrets(output, [token]), null, 2));
