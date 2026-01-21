const BASE = process.env.BASE;
const LOG = process.env.LOG;
const TOKEN = process.env.BUDDY_BUILDER_VERIFY_TOKEN;
const DEAL_ID = process.env.DEAL_ID;

if (!BASE || !LOG || !TOKEN) {
  console.error("missing BASE, LOG, or BUDDY_BUILDER_VERIFY_TOKEN");
  process.exit(2);
}

import { appendFileSync } from "node:fs";

function append(title, body) {
  appendFileSync(LOG, `\n## ${title}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}

async function gate() {
  const N = 60, SLEEP = 5;
  append("preview:gate:start", `BASE=${BASE}\nUTC=${new Date().toISOString()}\ntries=${N} sleep=${SLEEP}s`);
  for (let i = 1; i <= N; i++) {
    const r = await fetch(`${BASE}/api/builder/token/status`, { headers: { "x-buddy-builder-token": TOKEN } }).catch(() => null);
    if (!r) { await new Promise(res => setTimeout(res, SLEEP * 1000)); continue; }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const matched = r.headers.get("x-matched-path") || "";
    const text = await r.text();
    if (ct.includes("application/json") && !matched.includes("/[[...slug]]")) {
      append("preview:gate:ready", `status=${r.status}\nct=${ct}\nmatched=${matched}\nbody=${text}`);
      return;
    }
    if (i === N) {
      append("preview:gate:timeout", `status=${r.status}\nct=${ct}\nmatched=${matched}\nbody_prefix=${text.slice(0,200)}`);
      throw new Error("preview still building");
    }
    await new Promise(res => setTimeout(res, SLEEP * 1000));
  }
}

async function run(cmd, env = {}) {
  const { spawnSync } = await import("node:child_process");
  const p = spawnSync(cmd[0], cmd.slice(1), { env: { ...process.env, ...env }, encoding: "utf8" });
  return (p.stdout || "") + (p.stderr || "");
}

(async () => {
  await gate();

  const probe = await run(["node", "scripts/tests/probe-builder-upload.mjs"], { BASE, DEAL_ID: DEAL_ID || "", BUDDY_BUILDER_VERIFY_TOKEN: TOKEN });
  append("probe:builder_upload:output", probe);

  // ensure dummy pdf exists
  await run(["python", "-c", `
from reportlab.pdfgen import canvas
p="/tmp/buddy_dummy.pdf"
c=canvas.Canvas(p); c.drawString(72,720,"Dummy PDF for builder upload validation."); c.save()
print(p)
`]);

  const val = await run(["node", "scripts/tests/run-terminal-validation.mjs"], { BASE, BUDDY_BUILDER_VERIFY_TOKEN: TOKEN });
  append("validation:terminal:output", val);

  console.log(`appended probe+validation to ${LOG}`);
})();
