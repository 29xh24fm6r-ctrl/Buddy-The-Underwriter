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
  console.log(`\nUsage:\n  node scripts/verify-underwrite.mjs --base <url>\n\nOptions:\n  --base     Preview base URL (or set PREVIEW_URL/VERCEL_URL)\n  --help     Show this help\n\nRequires BUDDY_BUILDER_VERIFY_TOKEN.\n\nUI verification intentionally removed — server invariant is canonical.\n`);
  process.exit(0);
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

const token = process.env.BUDDY_BUILDER_VERIFY_TOKEN || "";
if (!token) {
  console.error("[verify:underwrite] Missing BUDDY_BUILDER_VERIFY_TOKEN env.");
  process.exit(1);
}

const baseUrl = previewUrl.startsWith("http")
  ? previewUrl
  : `https://${previewUrl}`;

const metaUrl = `${baseUrl}/api/_meta/build`;
const tokenStatusUrl = `${baseUrl}/api/builder/token/status`;
const auditUrl = `${baseUrl}/api/builder/stitch/audit`;
const mintUrl = `${baseUrl}/api/builder/deals/mint`;
const makeReadyUrl = `${baseUrl}/api/builder/deals/make-ready`;

console.log(`[verify:underwrite] Using preview ${baseUrl}`);

const metaRes = await fetch(metaUrl, { headers: { "Cache-Control": "no-store" } });
const metaText = await metaRes.text();
let metaPayload = null;
try {
  metaPayload = JSON.parse(metaText);
} catch {
  metaPayload = { raw: metaText };
}

console.log("[verify:underwrite] Build meta", {
  status: metaRes.status,
  sha: metaPayload?.git?.sha ?? null,
  ref: metaPayload?.git?.ref ?? null,
  deploymentId: metaPayload?.vercel?.deploymentId ?? null,
});

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

const tokenStatus = await fetchJson(tokenStatusUrl);
const audit = await fetchJson(auditUrl, {
  headers: { "x-buddy-builder-token": token, "Cache-Control": "no-store" },
});

const minted = await fetchJson(mintUrl, {
  method: "POST",
  headers: { "x-buddy-builder-token": token, "Cache-Control": "no-store" },
});

const dealId = minted.payload?.dealId ?? null;
if (!dealId) {
  console.error("[verify:underwrite] Failed to mint builder deal");
  console.error(JSON.stringify(minted.payload ?? {}, null, 2));
  process.exit(1);
}

const blocked = await fetchJson(`${baseUrl}/api/builder/verify/underwrite?dealId=${dealId}`, {
  headers: { "x-buddy-builder-token": token, "Cache-Control": "no-store" },
});

const ready = await fetchJson(makeReadyUrl, {
  method: "POST",
  headers: {
    "x-buddy-builder-token": token,
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ dealId }),
});

const verifiedReady = await fetchJson(`${baseUrl}/api/builder/verify/underwrite?dealId=${dealId}`, {
  headers: { "x-buddy-builder-token": token, "Cache-Control": "no-store" },
});

const decisionSnapshots = [];
for (let i = 0; i < 3; i += 1) {
  const snap = await fetchJson(`${baseUrl}/api/builder/deals/${dealId}/decision/latest`, {
    headers: { "x-buddy-builder-token": token, "Cache-Control": "no-store" },
  });
  decisionSnapshots.push({ status: snap.res.status, payload: snap.payload });
}

const financialDecision = await fetchJson(
  `${baseUrl}/api/builder/deals/${dealId}/financial-snapshot/decision`,
  { headers: { "x-buddy-builder-token": token, "Cache-Control": "no-store" } }
);

const output = {
  baseUrl,
  tokenStatus: tokenStatus.payload,
  stitchAudit: audit.payload,
  minted: minted.payload,
  blockedVerify: blocked.payload,
  readyMutation: ready.payload,
  readyVerify: verifiedReady.payload,
  decisionLatest: decisionSnapshots,
  financialSnapshotDecision: financialDecision.payload,
};

console.log(JSON.stringify(output, null, 2));
