import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("sms send module uses lazy Twilio import", () => {
  const filePath = join(process.cwd(), "src/lib/sms/send.ts");
  const content = readFileSync(filePath, "utf8");

  assert.ok(!/from\s+["']twilio["']/.test(content), "Twilio must not be imported at module scope");
  assert.ok(/import\(\s*["']twilio["']\s*\)/.test(content), "Twilio must be imported lazily");
});
