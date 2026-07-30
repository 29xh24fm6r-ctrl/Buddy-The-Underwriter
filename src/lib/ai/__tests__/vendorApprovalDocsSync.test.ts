/**
 * SPEC-M1 AI-GATEWAY-1 — keeps docs/vendors/<provider>.md's `Status:` field
 * in sync with VENDOR_NPI_APPROVAL (vendorApproval.ts). Referenced by both
 * files' doc comments as the mechanism preventing drift between "what the
 * doc says" and "what the gateway actually enforces."
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { VENDOR_NPI_APPROVAL } from "../vendorApproval";

const PROVIDERS = ["google", "anthropic", "openai"] as const;

function readDocStatus(provider: string): string {
  const path = resolve(process.cwd(), `docs/vendors/${provider}.md`);
  const src = readFileSync(path, "utf8");
  const match = src.match(/\*\*Status:\s*(PENDING|APPROVED)\*\*/);
  if (!match) {
    throw new Error(`docs/vendors/${provider}.md has no "**Status: PENDING|APPROVED**" line`);
  }
  return match[1];
}

describe("vendor approval docs stay in sync with code", () => {
  for (const provider of PROVIDERS) {
    it(`docs/vendors/${provider}.md Status matches VENDOR_NPI_APPROVAL.${provider}`, () => {
      assert.equal(
        readDocStatus(provider),
        VENDOR_NPI_APPROVAL[provider],
        `docs/vendors/${provider}.md says one thing, vendorApproval.ts enforces another`,
      );
    });
  }

  it("every provider has a doc with a parseable Status line", () => {
    for (const provider of PROVIDERS) {
      assert.doesNotThrow(() => readDocStatus(provider));
    }
  });
});
