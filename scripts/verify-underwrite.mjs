#!/usr/bin/env node
import { execSync } from "node:child_process";

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
  console.log(`\nUsage:\n  node scripts/verify-underwrite.mjs --base <url> --deal <dealId>\n\nOptions:\n  --base     Preview base URL (or set PREVIEW_URL/VERCEL_URL)\n  --deal     Deal id (or set DEAL_ID)\n  --help     Show this help\n\nUI verification intentionally removed — server invariant is canonical.\n`);
  process.exit(0);
}

const dealId = process.env.DEAL_ID || args.deal || args._[0];
if (!dealId) {
  console.error("[verify:underwrite] Provide DEAL_ID env or --deal.");
  process.exit(1);
}

const previewUrl =
  args.base ||
  process.env.PREVIEW_URL ||
  process.env.VERCEL_URL ||
  tryRun("node scripts/vercel-latest-url.mjs");

if (!previewUrl) {
  console.error("[verify:underwrite] Unable to determine preview URL.");
  process.exit(1);
}

const baseUrl = previewUrl.startsWith("http")
  ? previewUrl
  : `https://${previewUrl}`;

const verifyUrl = `${baseUrl}/api/_builder/verify/underwrite?dealId=${dealId}`;

console.log(`[verify:underwrite] Using preview ${baseUrl}`);
console.log(`[verify:underwrite] Verify URL ${verifyUrl}`);

const res = await fetch(verifyUrl);
const text = await res.text();
let payload = null;
try {
  payload = JSON.parse(text);
} catch {
  payload = { raw: text };
}

if (!res.ok) {
  console.error("[verify:underwrite] Request failed", { status: res.status });
  console.error(JSON.stringify(payload ?? {}, null, 2));
  process.exit(1);
}

if (!payload?.ok) {
  console.error("[verify:underwrite] Assertion failed: ok !== true");
  console.error(JSON.stringify(payload ?? {}, null, 2));
  process.exit(1);
}

if (!payload?.intake?.initialized) {
  console.error("[verify:underwrite] Assertion failed: intake.initialized !== true");
  console.error(JSON.stringify(payload ?? {}, null, 2));
  process.exit(1);
}

if (!(payload?.intake?.checklistCount > 0)) {
  console.error("[verify:underwrite] Assertion failed: checklistCount <= 0");
  console.error(JSON.stringify(payload ?? {}, null, 2));
  process.exit(1);
}

if (!payload?.underwriting?.activated) {
  console.error("[verify:underwrite] Assertion failed: underwriting.activated !== true");
  console.error(JSON.stringify(payload ?? {}, null, 2));
  process.exit(1);
}

console.log("[verify:underwrite] Success:", {
  checklistCount: payload?.intake?.checklistCount,
  intakeEvent: payload?.ledger?.intakeEvent,
  underwritingEvent: payload?.ledger?.underwritingEvent,
});
