import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function arg(i) {
  const v = process.argv[i];
  return v && String(v).trim() ? String(v).trim() : null;
}

function looksLikeUrl(s) {
  return /^https?:\/\/\S+$/.test(s);
}

function tryPnpmPreviewUrl({ spawnSyncImpl = spawnSync } = {}) {
  const r = spawnSyncImpl("pnpm", ["-s", "vercel:preview:url"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const lines = (r.stdout || "").split("\n").map((x) => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (looksLikeUrl(lines[i])) return lines[i];
  }
  return null;
}

function resolveBase(
  argvBase,
  { spawnSyncImpl = spawnSync, envBase = process.env.BASE, previewUrl } = {}
) {
  const resolvedPreviewUrl =
    previewUrl ?? (!argvBase && !envBase ? tryPnpmPreviewUrl({ spawnSyncImpl }) : null);
  return argvBase || envBase || resolvedPreviewUrl || "http://localhost:3000";
}

function resolveToken(argvToken) {
  return argvToken || process.env.BUDDY_BUILDER_VERIFY_TOKEN || "";
}

function usage() {
  console.error("usage: node scripts/tests/run-terminal-validation.mjs [BASE] [TOKEN]");
}

function looksLikeHtml(s) {
  return /<!doctype html|<html/i.test(s);
}

async function j(url, init) {
  const r = await fetch(url, init);
  const ct = r.headers.get("content-type") || "";
  const t = await r.text();
  if (!ct.includes("application/json")) {
    return { status: r.status, ct, matched: r.headers.get("x-matched-path"), body_prefix: t.slice(0, 160) };
  }
  return { status: r.status, json: JSON.parse(t) };
}

async function main() {
  const argvBase = arg(2);
  const argvToken = arg(3);
  const previewUrl = !argvBase && !process.env.BASE ? tryPnpmPreviewUrl() : null;
  const BASE = resolveBase(argvBase, { previewUrl });
  const TOKEN = resolveToken(argvToken);

  console.log(`[terminal-validation] BASE=${BASE}`);
  console.log(`[terminal-validation] builderTokenPresent=${Boolean(TOKEN)}`);

  const resolvedToLocalhost = BASE === "http://localhost:3000" && !argvBase && !process.env.BASE && !previewUrl;

  if (resolvedToLocalhost) {
    console.warn("[terminal-validation] BASE not provided; using localhost.");
  }

  const buildMetaRes = await fetch(`${BASE}/api/build-meta`);
  const buildMetaCt = buildMetaRes.headers.get("content-type") || "";
  const buildMetaText = await buildMetaRes.text();
  if (buildMetaRes.status !== 200 || !buildMetaCt.includes("application/json")) {
    throw new Error("BASE does not serve /api/build-meta JSON (likely wrong preview URL).");
  }

  let buildMeta;
  try {
    buildMeta = JSON.parse(buildMetaText);
  } catch {
    throw new Error("BASE does not serve /api/build-meta JSON (likely wrong preview URL).");
  }

  console.log(
    `[terminal-validation] build-meta sha=${buildMeta?.sha ?? "unknown"} ref=${buildMeta?.ref ?? "unknown"}`,
  );

  if (!TOKEN) {
    console.error("missing TOKEN (set BUDDY_BUILDER_VERIFY_TOKEN env var or pass as argv[3])");
    usage();
    process.exit(2);
  }

  const latestRes = await fetch(`${BASE}/api/_builder/deals/latest`, {
    headers: { "x-buddy-builder-token": TOKEN },
  });
  const latestCt = latestRes.headers.get("content-type") || "";
  const latestText = await latestRes.text();
  if (latestCt.startsWith("text/html") || looksLikeHtml(latestText)) {
    throw new Error("/api/_builder/deals/latest returned HTML; routing is broken on this deployment.");
  }

  let deal;
  if (!latestCt.includes("application/json")) {
    deal = {
      status: latestRes.status,
      ct: latestCt,
      matched: latestRes.headers.get("x-matched-path"),
      body_prefix: latestText.slice(0, 160),
    };
  } else {
    deal = { status: latestRes.status, json: JSON.parse(latestText) };
  }
  console.log("deals/latest:", JSON.stringify(deal, null, 2));

  const dealId = process.env.DEAL_ID || deal?.json?.dealId;
  if (!dealId) throw new Error("no dealId (set DEAL_ID or enable deals/latest)");

  const seed = await j(`${BASE}/api/builder/deals/${dealId}/seed-intake`, {
    method: "POST",
    headers: { "x-buddy-builder-token": TOKEN, "content-type": "application/json" },
    body: "{}",
  });
  console.log("seed-intake:", JSON.stringify(seed, null, 2));

  const verify1 = await j(`${BASE}/api/_builder/verify/underwrite?dealId=${dealId}`, {
    headers: { "x-buddy-builder-token": TOKEN },
  });
  console.log("verify(after_seed):", JSON.stringify(verify1, null, 2));

  const pdf = readFileSync("/tmp/buddy_dummy.pdf");
  const upload = await j(`${BASE}/api/builder/deals/${dealId}/documents/upload`, {
    method: "POST",
    headers: { "x-buddy-builder-token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify({
      filename: "buddy_dummy.pdf",
      mimeType: "application/pdf",
      base64: Buffer.from(pdf).toString("base64"),
    }),
  });
  console.log("upload:", JSON.stringify(upload, null, 2));

  const verify2 = await j(`${BASE}/api/_builder/verify/underwrite?dealId=${dealId}`, {
    headers: { "x-buddy-builder-token": TOKEN },
  });
  console.log("verify(after_upload):", JSON.stringify(verify2, null, 2));
}

if (process.env.NODE_ENV !== "test") {
  await main();
}

export { resolveBase, resolveToken, looksLikeUrl };
