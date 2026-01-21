const BASE = process.env.BASE;
const DEAL_ID = process.env.DEAL_ID;
const TOKEN = process.env.BUDDY_BUILDER_VERIFY_TOKEN;

if (!BASE || !DEAL_ID || !TOKEN) {
  console.error("missing BASE, DEAL_ID, or BUDDY_BUILDER_VERIFY_TOKEN");
  process.exit(2);
}

const targets = [
  `${BASE}/api/builder/deals/${DEAL_ID}/documents/upload`,
  `${BASE}/api/_builder/deals/${DEAL_ID}/documents/upload`,
];

async function probe(url) {
  const res = await fetch(url, {
    method: "OPTIONS",
    headers: { "x-buddy-builder-token": TOKEN },
  });

  const allow = res.headers.get("allow");
  const matched = res.headers.get("x-matched-path");
  const ct = res.headers.get("content-type");
  const text = await res.text();

  return { url, status: res.status, allow, matched, ct, body_prefix: text.slice(0, 120) };
}

(async () => {
  for (const url of targets) {
    const r = await probe(url);
    console.log(JSON.stringify(r, null, 2));
  }
})();
