async function main() {
  const url = process.env.GEMINI_OCR_TEST_URL || "http://localhost:3000/api/dev/gemini-ocr-test";
  const token = process.env.DEV_INTERNAL_TOKEN;

  const res = await fetch(url, {
    method: "GET",
    headers: token ? { "x-dev-token": token } : {},
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // fall through
  }

  if (!res.ok) {
    console.error("Request failed", { status: res.status, body: json ?? text });
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(json, null, 2));

  if (!json?.ok) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("\nTEST FAILED:", e?.message || e);
  process.exitCode = 1;
});
