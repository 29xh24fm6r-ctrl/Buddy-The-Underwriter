import process from "node:process";

const baseUrl = process.env.SMOKE_BASE_URL;
const dealId = process.env.SMOKE_DEAL_ID;

if (!baseUrl) {
  console.error("Missing env SMOKE_BASE_URL (e.g. http://localhost:3000)");
  process.exit(1);
}
if (!dealId) {
  console.error("Missing env SMOKE_DEAL_ID (a valid deal UUID in the target env)");
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/api/deals/${dealId}/files/record`;

const headers = {
  "Content-Type": "application/json",
};

if (process.env.SMOKE_AUTH_COOKIE) {
  headers["Cookie"] = process.env.SMOKE_AUTH_COOKIE;
}
if (process.env.SMOKE_BEARER) {
  headers["Authorization"] = `Bearer ${process.env.SMOKE_BEARER}`;
}

// Minimal payload that should pass DB constraints:
// - object_path/storage_path should be plausible (no need to exist if record route doesn't verify storage)
const payload = {
  file_id: `smoke_${Date.now()}`,
  object_path: `${dealId}/smoke_${Date.now()}.pdf`,
  original_filename: `smoke_${Date.now()}.pdf`,
  mime_type: "application/pdf",
  size_bytes: 12345,
  sha256: "smoke_sha256_placeholder",
  source: "smoke_test",
};

console.log("Sending smoke upload-record request to:", url);

const res = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text };
}

if (!res.ok) {
  console.error("❌ Smoke upload-record FAILED", { status: res.status, json });
  process.exit(1);
}

console.log("✅ Smoke upload-record OK", { status: res.status, json });
