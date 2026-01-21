import { readFileSync } from "node:fs";

const BASE = process.env.BASE;
const TOKEN = process.env.BUDDY_BUILDER_VERIFY_TOKEN;
if (!BASE || !TOKEN) throw new Error("missing BASE or token");

async function j(url, init) {
  const r = await fetch(url, init);
  const ct = r.headers.get("content-type") || "";
  const t = await r.text();
  if (!ct.includes("application/json")) {
    return { status: r.status, ct, matched: r.headers.get("x-matched-path"), body_prefix: t.slice(0, 160) };
  }
  return { status: r.status, json: JSON.parse(t) };
}

const deal = await j(`${BASE}/api/_builder/deals/latest`, { headers: { "x-buddy-builder-token": TOKEN } });
console.log("deals/latest:", JSON.stringify(deal, null, 2));

const dealId = deal?.json?.dealId;
if (!dealId) throw new Error("no dealId from deals/latest");

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
