#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

const manifestPath = process.argv[2];
if (!manifestPath) die("Usage: node scripts/stitch/import-from-manifest.mjs <manifest.json>");

const absManifest = path.resolve(process.cwd(), manifestPath);
if (!fs.existsSync(absManifest)) die(`Manifest not found: ${absManifest}`);

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(absManifest, "utf8"));
} catch (e) {
  die(`Failed to parse JSON: ${e?.message ?? e}`);
}

if (!manifest?.items?.length) die("Manifest has no items[]. Did you generate stitch_route_manifest.json?");

const importer = path.resolve(process.cwd(), "scripts/stitch/import-stitch.mjs");
if (!fs.existsSync(importer)) die(`Missing importer script: ${importer}`);

let ok = 0;
let fail = 0;

for (const item of manifest.items) {
  const exp = item?.export ?? "(unknown)";
  const codeHtml = item?.codeHtml;
  const target = item?.target;
  const route = item?.route ?? "";

  if (!codeHtml || !target) {
    console.error(`⚠️  Skipping ${exp}: missing codeHtml/target`);
    fail++;
    continue;
  }

  const absCodeHtml = path.resolve(process.cwd(), codeHtml);
  if (!fs.existsSync(absCodeHtml)) {
    console.error(`❌ Missing code.html for ${exp}: ${absCodeHtml}`);
    fail++;
    continue;
  }

  const absTarget = path.resolve(process.cwd(), target);
  fs.mkdirSync(path.dirname(absTarget), { recursive: true });

  const res = spawnSync(process.execPath, [importer, absCodeHtml, absTarget], {
    stdio: "inherit",
  });

  if (res.status === 0) {
    ok++;
    console.log(`✅ Imported ${exp} → ${route || target}`);
  } else {
    fail++;
    console.error(`❌ Failed ${exp} → ${route || target}`);
  }
}

console.log(`\nDone. ✅ ${ok} imported, ❌ ${fail} failed.`);
process.exit(fail ? 1 : 0);
