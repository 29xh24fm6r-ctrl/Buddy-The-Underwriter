import fs from "node:fs";
import path from "node:path";

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && ent.name === "route.ts") out.push(p);
  }
  return out;
}

function main() {
  const base = path.join(process.cwd(), "src", "app", "api", "admin");
  if (!fs.existsSync(base)) {
    console.log("admin-routes-guard: no admin routes found (ok)");
    process.exit(0);
  }

  const files = walk(base);
  const missing = [];

  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    const hasImport = txt.includes(`requireSuperAdmin`) && txt.includes(`@/lib/auth/requireAdmin`);
    const hasCall = txt.match(/requireSuperAdmin\(\)\s*;?/);

    if (!hasImport || !hasCall) missing.push(f);
  }

  if (missing.length) {
    console.error("admin-routes-guard: FAILED. Missing requireSuperAdmin() in:");
    for (const f of missing) console.error(" - " + f);
    process.exit(1);
  }

  console.log(`admin-routes-guard: OK (${files.length} route files checked)`);
}

main();
