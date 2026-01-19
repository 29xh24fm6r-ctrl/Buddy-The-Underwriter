#!/usr/bin/env node
import { execSync } from "node:child_process";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const dealId = process.env.DEAL_ID || process.argv[2];
if (!dealId) {
  console.error("[verify:underwrite] Provide DEAL_ID env or first CLI arg.");
  process.exit(1);
}

const previewUrl =
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

const authCookie =
  process.env.BUDDY_AUTH_COOKIE ||
  process.env.AUTH_COOKIE ||
  process.env.COOKIE ||
  "";

const requestHeaders = authCookie ? { cookie: authCookie } : {};

const fetchJson = async (url) => {
  const res = await fetch(url, { headers: requestHeaders });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
};

console.log(`[verify:underwrite] Using preview ${baseUrl}`);

const underwriteRes = await fetch(`${baseUrl}/underwrite/${dealId}`, {
  headers: requestHeaders,
  redirect: "manual",
});

const underwriteHtml = await underwriteRes.text();

console.log("[verify:underwrite] Underwrite status", underwriteRes.status);

if (underwriteHtml.includes("Underwriting not started yet")) {
  console.error("[verify:underwrite] Dead-end fallback detected in HTML.");
  process.exit(1);
}

const contextRes = await fetchJson(`${baseUrl}/api/deals/${dealId}/context`);
console.log("[verify:underwrite] Context", {
  ok: contextRes.ok,
  status: contextRes.status,
  keys: contextRes.json && typeof contextRes.json === "object" ? Object.keys(contextRes.json) : [],
});

const pipelineRes = await fetchJson(`${baseUrl}/api/deals/${dealId}/pipeline/latest`);
if (pipelineRes.ok) {
  const latestKey = pipelineRes.json?.latest?.event_key || pipelineRes.json?.event_key || null;
  const okKeys = new Set([
    "deal.underwriting.started",
    "underwriting.activated",
    "underwriting.already_activated",
  ]);
  console.log("[verify:underwrite] Pipeline latest", { latestKey });
  if (latestKey && !okKeys.has(String(latestKey))) {
    console.warn("[verify:underwrite] Latest pipeline key not an underwriting activation.");
  }
}

let checklistCount = 0;
let lastChecklist = null;
for (let i = 0; i < 6; i += 1) {
  const checklistRes = await fetchJson(`${baseUrl}/api/deals/${dealId}/checklist`);
  lastChecklist = checklistRes;
  const items = checklistRes.json?.items || [];
  checklistCount = Array.isArray(items) ? items.length : 0;
  console.log("[verify:underwrite] Checklist", {
    ok: checklistRes.ok,
    status: checklistRes.status,
    count: checklistCount,
  });
  if (checklistCount > 0) break;
  await sleep(1000);
}

if (checklistCount === 0) {
  console.error("[verify:underwrite] Checklist still empty after retry window.");
  console.error(JSON.stringify(lastChecklist?.json ?? {}, null, 2));
  process.exit(1);
}

console.log("[verify:underwrite] Success: checklist seeded.");
