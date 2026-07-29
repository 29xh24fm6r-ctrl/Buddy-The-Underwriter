/**
 * SPEC-M1 AI-GATEWAY-1 — verify.ts (verifyClaims) unit tests.
 *
 * Mocks the gateway's anthropic provider implementation (the `verifier`
 * role's default) via gateway.ts's test-only seam, so no live network call
 * is made. Exercises the challenger primitive against fixture facts/drafts.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// verify.ts and gateway.ts (transitively) have `import "server-only"` —
// patch the CJS resolver before requiring them, same pattern as
// geminiClient.test.ts.
mockServerOnly();
const require = createRequire(import.meta.url);
const { verifyClaims } = require("../verify") as typeof import("../verify");
const { __setProviderImplForTests, __setLogGatewayCallForTests, __resetGatewayTestOverrides } =
  require("../gateway") as typeof import("../gateway");

afterEach(() => {
  __resetGatewayTestOverrides();
});

describe("verifyClaims", () => {
  it("flags a planted unsupported claim against fixture facts", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("anthropic", async () => ({
      text: JSON.stringify({
        flaggedClaims: [
          {
            claim: "Revenue grew 40% year over year",
            reason: "Facts show revenue grew 12%, not 40%.",
            severity: "critical",
          },
        ],
      }),
      tokensIn: 50,
      tokensOut: 30,
    }));

    const result = await verifyClaims({
      facts: { revenue_prior_year: 1_000_000, revenue_current_year: 1_120_000 },
      draft: "This business is thriving — revenue grew 40% year over year.",
    });

    assert.equal(result.verdict, "flagged");
    assert.equal(result.flaggedClaims.length, 1);
    assert.equal(result.flaggedClaims[0].severity, "critical");
    assert.match(result.flaggedClaims[0].reason, /12%/);
  });

  it("passes when the verifier finds nothing unsupported", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("anthropic", async () => ({
      text: JSON.stringify({ flaggedClaims: [] }),
      tokensIn: 40,
      tokensOut: 5,
    }));

    const result = await verifyClaims({
      facts: { dscr: 1.35 },
      draft: "DSCR is comfortably above the 1.25x policy minimum.",
    });

    assert.equal(result.verdict, "pass");
    assert.deepEqual(result.flaggedClaims, []);
  });

  it("treats malformed verifier output as a critical flag, not a silent pass", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("anthropic", async () => ({
      text: "not valid json at all",
      tokensIn: 10,
      tokensOut: 5,
    }));

    const result = await verifyClaims({
      facts: { dscr: 1.35 },
      draft: "DSCR is fine.",
    });

    assert.equal(result.verdict, "flagged");
    assert.equal(result.flaggedClaims.length, 1);
    assert.equal(result.flaggedClaims[0].severity, "critical");
  });

  it("accepts a string facts payload as well as an object", async () => {
    __setLogGatewayCallForTests(async () => {});
    let sentPrompt = "";
    __setProviderImplForTests("anthropic", async (req) => {
      sentPrompt = req.prompt;
      return { text: JSON.stringify({ flaggedClaims: [] }), tokensIn: 1, tokensOut: 1 };
    });

    await verifyClaims({ facts: "DSCR: 1.35, LTV: 0.72", draft: "Deal looks strong." });
    assert.match(sentPrompt, /DSCR: 1\.35, LTV: 0\.72/);
  });
});
