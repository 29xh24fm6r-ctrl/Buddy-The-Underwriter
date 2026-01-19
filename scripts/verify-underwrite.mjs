#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { chromium } from "playwright";

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
  console.log(`\nUsage:\n  node scripts/verify-underwrite.mjs --base <url> --deal <dealId> [--storage <path>]\n  node scripts/verify-underwrite.mjs --base <url> --deal <dealId> --login [--storage <path>]\n\nOptions:\n  --base     Preview base URL (or set PREVIEW_URL/VERCEL_URL)\n  --deal     Deal id (or set DEAL_ID)\n  --login    Headed login to save storageState (no cookies)\n  --storage  Path to storageState.json for headless verify\n  --help     Show this help\n`);
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

const defaultStoragePath = path.resolve(".auth", "storageState.json");
const storagePath = args.storage ? path.resolve(args.storage) : defaultStoragePath;
const underwriteUrl = `${baseUrl}/underwrite/${dealId}`;

const okKeys = new Set([
  "deal.underwriting.started",
  "underwriting.activated",
  "underwriting.already_activated",
]);

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const promptEnter = async (message) => {
  console.log(message);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question("", resolve));
  rl.close();
};

const fetchJsonWithRequest = async (request, url) => {
  const res = await request.get(url);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok(), status: res.status(), json };
};

const saveArtifacts = async ({ html, page, suffix, finalUrl }) => {
  const artifactsDir = path.resolve("artifacts", "verify-underwrite");
  ensureDir(artifactsDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const htmlPath = path.join(artifactsDir, `underwrite-${suffix}-${stamp}.html`);
  const screenshotPath = path.join(artifactsDir, `underwrite-${suffix}-${stamp}.png`);
  const metaPath = path.join(artifactsDir, `underwrite-${suffix}-${stamp}.json`);
  fs.writeFileSync(htmlPath, html, "utf8");
  if (page) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  fs.writeFileSync(metaPath, JSON.stringify({ finalUrl }, null, 2), "utf8");
  console.log("[verify:underwrite] Artifacts saved:", {
    html: htmlPath,
    screenshot: screenshotPath,
    meta: metaPath,
  });
};

const printLedgerEvents = async (request) => {
  const timelineUrl = `${baseUrl}/api/deals/${dealId}/pipeline/timeline`;
  const timelineRes = await fetchJsonWithRequest(request, timelineUrl);
  if (!timelineRes.ok) {
    console.warn("[verify:underwrite] Unable to read pipeline timeline.");
    return;
  }
  const items = timelineRes.json?.events || timelineRes.json?.items || timelineRes.json?.timeline || [];
  if (!Array.isArray(items)) {
    console.warn("[verify:underwrite] Pipeline timeline format not recognized.");
    return;
  }
  const recent = items.slice(-50);
  console.log("[verify:underwrite] Last 50 pipeline events:");
  for (const event of recent) {
    console.log("-", {
      event_key: event.event_key || event.key || event.type,
      created_at: event.created_at || event.createdAt || event.inserted_at,
    });
  }
};

const runLogin = async () => {
  console.log(`[verify:underwrite] Using preview ${baseUrl}`);
  console.log(`[verify:underwrite] Login URL ${underwriteUrl}`);
  ensureDir(path.dirname(storagePath));
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(underwriteUrl, { waitUntil: "domcontentloaded" });
  while (true) {
    await promptEnter(
      "[verify:underwrite] Complete login in the opened browser, then press Enter here to continue."
    );
    const contextRes = await fetchJsonWithRequest(
      context.request,
      `${baseUrl}/api/deals/${dealId}/context`
    );
    if (contextRes.ok) {
      await context.storageState({ path: storagePath });
      console.log("[verify:underwrite] Auth detected. Saved storageState to", storagePath);
      await browser.close();
      return;
    }
    console.log("[verify:underwrite] Auth not detected yet. Try again.");
  }
};

const runVerify = async () => {
  console.log(`[verify:underwrite] Using preview ${baseUrl}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    args.storage ? { storageState: storagePath } : {}
  );
  const page = await context.newPage();
  const response = await page.goto(underwriteUrl, { waitUntil: "domcontentloaded" });
  const finalUrl = page.url();
  const status = response?.status() ?? 0;
  const underwriteHtml = await page.content();
  console.log("[verify:underwrite] Underwrite status", status);
  console.log("[verify:underwrite] Final URL", finalUrl);

  const failures = [];

  if (underwriteHtml.includes("Underwriting not started yet")) {
    failures.push("Underwrite page contains dead-end fallback text.");
  }

  const contextRes = await fetchJsonWithRequest(
    context.request,
    `${baseUrl}/api/deals/${dealId}/context`
  );
  console.log("[verify:underwrite] Context", {
    ok: contextRes.ok,
    status: contextRes.status,
    keys:
      contextRes.json && typeof contextRes.json === "object"
        ? Object.keys(contextRes.json)
        : [],
  });
  if (!contextRes.ok) {
    failures.push(`Context request unauthorized (status ${contextRes.status}).`);
  }

  let activationConfirmed = false;
  const pipelineRes = await fetchJsonWithRequest(
    context.request,
    `${baseUrl}/api/deals/${dealId}/pipeline/latest`
  );
  if (pipelineRes.ok) {
    const latestKey =
      pipelineRes.json?.latest?.event_key ||
      pipelineRes.json?.event_key ||
      null;
    console.log("[verify:underwrite] Pipeline latest", { latestKey });
    if (latestKey && okKeys.has(String(latestKey))) {
      activationConfirmed = true;
    }
  }

  if (!activationConfirmed) {
    const timelineRes = await fetchJsonWithRequest(
      context.request,
      `${baseUrl}/api/deals/${dealId}/pipeline/timeline`
    );
    if (timelineRes.ok) {
      const items =
        timelineRes.json?.events ||
        timelineRes.json?.items ||
        timelineRes.json?.timeline ||
        [];
      if (Array.isArray(items)) {
        activationConfirmed = items.some((event) =>
          okKeys.has(String(event.event_key || event.key || event.type || ""))
        );
      }
    }
  }

  if (!activationConfirmed) {
    failures.push("Underwriting activation signal not detected in pipeline events.");
  }

  let checklistCount = 0;
  let lastChecklist = null;
  for (let i = 0; i < 6; i += 1) {
    const checklistRes = await fetchJsonWithRequest(
      context.request,
      `${baseUrl}/api/deals/${dealId}/checklist`
    );
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
    failures.push("Checklist still empty after retry window.");
    console.error(JSON.stringify(lastChecklist?.json ?? {}, null, 2));
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error("[verify:underwrite] Assertion failed:", failure);
    }
    await saveArtifacts({ html: underwriteHtml, page, suffix: "failure", finalUrl });
    await printLedgerEvents(context.request);
    await browser.close();
    process.exit(1);
  }

  await saveArtifacts({ html: underwriteHtml, page, suffix: "success", finalUrl });
  await browser.close();
  console.log("[verify:underwrite] Success: checklist seeded and activation confirmed.");
};

if (args.login) {
  await runLogin();
  process.exit(0);
}

await runVerify();
