import assert from "node:assert/strict";
import test from "node:test";

import {
  rankLenders,
  scoreLender,
  summarizeHistory,
  toCreditBox,
  toDealCriteria,
  type DealCriteria,
  type LenderCreditBox,
} from "@/lib/crm/lenderMatch";
import { normalizeStateCode, parseStateList } from "@/lib/crm/geography";

function box(overrides: Partial<LenderCreditBox> = {}): LenderCreditBox {
  return {
    lenderProfileId: "profile-1",
    organizationId: "org-1",
    name: "T Bank",
    relationshipStatus: "active",
    geographyMode: "states",
    stateCodes: ["TX"],
    excludedStateCodes: [],
    naicsCodes: [],
    excludedNaicsCodes: [],
    minLoanAmount: 250_000,
    maxLoanAmount: 5_000_000,
    minDscr: 1.25,
    maxLtv: 0.9,
    minimumFico: 680,
    sba7aAppetite: true,
    sba504Appetite: false,
    conventionalAppetite: false,
    responseSlaDays: 3,
    legacyGeographies: [],
    ...overrides,
  };
}

function deal(overrides: Partial<DealCriteria> = {}): DealCriteria {
  return {
    stateCode: "TX",
    amount: 2_400_000,
    productType: "SBA_7A",
    naicsCode: null,
    dscr: null,
    ltv: null,
    fico: null,
    ...overrides,
  };
}

// ── geography ───────────────────────────────────────────────────────────

test("a state-limited bank is disqualified for a deal outside its states", () => {
  const match = scoreLender(box({ stateCodes: ["TX", "OK"] }), deal({ stateCode: "FL" }));
  assert.equal(match.eligible, false);
  assert.deepEqual(match.disqualifiers, ["Does not lend in FL"]);
  assert.equal(match.score, 0);
});

test("a state-limited bank fits a deal inside its states, and says so", () => {
  const match = scoreLender(box(), deal());
  assert.equal(match.eligible, true);
  assert.ok(match.reasons.includes("Lends in TX"));
});

test("an explicit exclusion beats nationwide", () => {
  const match = scoreLender(
    box({ geographyMode: "nationwide", stateCodes: [], excludedStateCodes: ["TX"] }),
    deal(),
  );
  assert.equal(match.eligible, false);
  assert.deepEqual(match.disqualifiers, ["Excludes TX"]);
});

test("nationwide fits anywhere it does not exclude", () => {
  const match = scoreLender(
    box({ geographyMode: "nationwide", stateCodes: [] }),
    deal({ stateCode: "RI" }),
  );
  assert.equal(match.eligible, true);
  assert.ok(match.reasons.includes("Lends nationwide"));
});

test("unrecorded geography warns rather than disqualifying", () => {
  const match = scoreLender(box({ stateCodes: [] }), deal());
  assert.equal(match.eligible, true);
  assert.ok(match.warnings.includes("Lending geography not recorded"));
});

test("a bank whose appetite is still free text is flagged for cleanup", () => {
  const match = scoreLender(box({ stateCodes: [], legacyGeographies: ["Southeast"] }), deal());
  assert.ok(match.warnings.some((w) => w.includes("still free-text")));
});

// ── program ─────────────────────────────────────────────────────────────

test("a bank with no 7(a) appetite is disqualified from a 7(a) deal", () => {
  const match = scoreLender(box({ sba7aAppetite: false }), deal({ productType: "SBA_7A" }));
  assert.equal(match.eligible, false);
  assert.deepEqual(match.disqualifiers, ["No SBA 7(a) appetite"]);
});

test("SBA Express is judged against 7(a) appetite", () => {
  assert.equal(scoreLender(box(), deal({ productType: "SBA_EXPRESS" })).eligible, true);
  assert.equal(
    scoreLender(box({ sba7aAppetite: false }), deal({ productType: "SBA_EXPRESS" })).eligible,
    false,
  );
});

test("a non-SBA product is judged against conventional appetite", () => {
  const match = scoreLender(box(), deal({ productType: "TERM_LOAN" }));
  assert.equal(match.eligible, false);
  assert.deepEqual(match.disqualifiers, ["No conventional appetite"]);
});

// ── loan size ───────────────────────────────────────────────────────────

test("a deal under the minimum or over the maximum is disqualified", () => {
  assert.deepEqual(
    scoreLender(box(), deal({ amount: 100_000 })).disqualifiers,
    ["Below $250,000 minimum"],
  );
  assert.deepEqual(
    scoreLender(box(), deal({ amount: 9_000_000 })).disqualifiers,
    ["Above $5,000,000 maximum"],
  );
});

test("a one-sided band judges distance from the bound the bank actually stated", () => {
  // A bank with only a minimum has no upper bound to be near. Deriving a span
  // from the missing bound made every such deal read "at the edge".
  const minOnly = scoreLender(box({ minLoanAmount: 250_000, maxLoanAmount: null }), deal({ amount: 5_000_000 }));
  assert.ok(minOnly.reasons.includes("Comfortably inside its size band"));

  const justAboveMin = scoreLender(box({ minLoanAmount: 250_000, maxLoanAmount: null }), deal({ amount: 260_000 }));
  assert.ok(justAboveMin.reasons.includes("At the edge of its size band"));

  const maxOnly = scoreLender(box({ minLoanAmount: null, maxLoanAmount: 50_000_000 }), deal({ amount: 5_000_000 }));
  assert.ok(maxOnly.reasons.includes("Comfortably inside its size band"));

  const justUnderMax = scoreLender(box({ minLoanAmount: null, maxLoanAmount: 5_200_000 }), deal({ amount: 5_000_000 }));
  assert.ok(justUnderMax.reasons.includes("At the edge of its size band"));
});

test("a deal near the edge of the band scores below one in the middle", () => {
  const middle = scoreLender(box(), deal({ amount: 2_400_000 }));
  const edge = scoreLender(box(), deal({ amount: 300_000 }));
  assert.ok(middle.score > edge.score);
  assert.ok(edge.reasons.includes("At the edge of its size band"));
});

// ── industry ────────────────────────────────────────────────────────────

test("an excluded NAICS prefix disqualifies by prefix, not exact match", () => {
  const match = scoreLender(
    box({ excludedNaicsCodes: ["7225"] }),
    deal({ naicsCode: "722511" }),
  );
  assert.equal(match.eligible, false);
  assert.deepEqual(match.disqualifiers, ["Excludes NAICS 7225"]);
});

test("a preferred NAICS prefix raises the score and is named", () => {
  const preferred = scoreLender(box({ naicsCodes: ["6212"] }), deal({ naicsCode: "621210" }));
  const neutral = scoreLender(box({ naicsCodes: ["6212"] }), deal({ naicsCode: "441110" }));
  assert.ok(preferred.reasons.includes("Preferred industry (NAICS 6212)"));
  assert.ok(preferred.score > neutral.score);
  assert.ok(neutral.warnings.includes("Outside its stated preferred industries"));
  assert.equal(neutral.eligible, true);
});

// ── soft credit metrics ─────────────────────────────────────────────────

test("a thin DSCR warns and lowers the score but never disqualifies", () => {
  const match = scoreLender(box(), deal({ dscr: 1.05 }));
  assert.equal(match.eligible, true);
  assert.ok(match.warnings.some((w) => w.includes("DSCR 1.05 under its 1.25 floor")));
  assert.ok(match.score < scoreLender(box(), deal({ dscr: 1.6 })).score);
});

test("LTV and FICO misses warn without excluding the bank", () => {
  const match = scoreLender(box(), deal({ ltv: 0.95, fico: 640 }));
  assert.equal(match.eligible, true);
  assert.ok(match.warnings.some((w) => w.includes("LTV 95% over its 90% ceiling")));
  assert.ok(match.warnings.some((w) => w.includes("FICO 640 under its 680 floor")));
});

// ── ranking ─────────────────────────────────────────────────────────────

test("eligible banks rank above ineligible ones, best score first", () => {
  const ranked = rankLenders(
    [
      box({ lenderProfileId: "wrong-state", name: "Shoreham Bank", stateCodes: ["RI"] }),
      box({ lenderProfileId: "prospect", name: "Grasshopper Bank", relationshipStatus: "prospect" }),
      box({ lenderProfileId: "preferred", name: "T Bank", relationshipStatus: "preferred" }),
    ],
    deal(),
  );

  assert.deepEqual(
    ranked.map((r) => r.lenderProfileId),
    ["preferred", "prospect", "wrong-state"],
  );
  assert.equal(ranked[2].eligible, false);
});

test("a bank the deal already went to sorts behind equally-scored banks", () => {
  const ranked = rankLenders(
    [box({ lenderProfileId: "a", name: "Alpha" }), box({ lenderProfileId: "b", name: "Beta" })],
    deal(),
    { alreadySentProfileIds: ["a"] },
  );
  assert.deepEqual(ranked.map((r) => r.lenderProfileId), ["b", "a"]);
  assert.ok(ranked[1].warnings.includes("Already sent this deal"));
});

test("outcome history lifts a responsive bank above an unproven one", () => {
  const responsive = summarizeHistory([
    { status: "closed", sent_at: "2026-01-01T00:00:00Z", responded_at: "2026-01-03T00:00:00Z", closed_amount: 1_000_000 },
    { status: "approved", sent_at: "2026-02-01T00:00:00Z", responded_at: "2026-02-02T00:00:00Z" },
  ]);
  const ranked = rankLenders(
    [box({ lenderProfileId: "proven", name: "Alpha" }), box({ lenderProfileId: "unproven", name: "Beta" })],
    deal(),
    { historyByProfileId: { proven: responsive } },
  );
  assert.equal(ranked[0].lenderProfileId, "proven");
  assert.ok(ranked[0].reasons.includes("Responded to 2 of 2"));
});

// ── history rollup ──────────────────────────────────────────────────────

test("planned submissions are not counted as sent", () => {
  const history = summarizeHistory([
    { status: "planned" },
    { status: "sent", sent_at: "2026-01-01T00:00:00Z" },
  ]);
  assert.equal(history.sent, 1);
  assert.equal(history.responded, 0);
  assert.equal(history.responseRate, 0);
});

test("average turnaround uses only rows with both timestamps", () => {
  const history = summarizeHistory([
    { status: "declined", sent_at: "2026-01-01T00:00:00Z", responded_at: "2026-01-05T00:00:00Z" },
    { status: "reviewing", sent_at: "2026-01-01T00:00:00Z", responded_at: null },
  ]);
  assert.equal(history.avgDaysToRespond, 4);
  assert.equal(history.sent, 2);
  assert.equal(history.responded, 1);
});

test("closed volume sums only closed rows", () => {
  const history = summarizeHistory([
    { status: "closed", closed_amount: 1_500_000 },
    { status: "approved", approved_amount: 900_000 },
  ]);
  assert.equal(history.closedVolume, 1_500_000);
  assert.equal(history.closed, 1);
});

// ── row adapters ────────────────────────────────────────────────────────

test("toCreditBox reads a lender profile row and defaults 7(a) appetite on", () => {
  const flattened = toCreditBox({
    id: "p1",
    organization_id: "o1",
    organization: { name: "Shoreham Bank" },
    geography_mode: "nationwide",
    state_codes: ["ri"],
    min_loan_amount: "500000",
    response_sla_days: "5",
  });
  assert.equal(flattened.name, "Shoreham Bank");
  assert.equal(flattened.geographyMode, "nationwide");
  assert.deepEqual(flattened.stateCodes, ["RI"]);
  assert.equal(flattened.minLoanAmount, 500_000);
  assert.equal(flattened.responseSlaDays, 5);
  assert.equal(flattened.sba7aAppetite, true);
  assert.equal(flattened.sba504Appetite, false);
});

test("toDealCriteria normalizes a full state name into a code", () => {
  const criteria = toDealCriteria({ state: "New York", loan_amount: "750000", product_type: "SBA_504" });
  assert.equal(criteria.stateCode, "NY");
  assert.equal(criteria.amount, 750_000);
  assert.equal(criteria.productType, "SBA_504");
});

// ── geography helpers ───────────────────────────────────────────────────

test("state normalization accepts codes and full names, rejects anything else", () => {
  assert.equal(normalizeStateCode("tx"), "TX");
  assert.equal(normalizeStateCode(" New York "), "NY");
  assert.equal(normalizeStateCode("Nationwide"), null);
  assert.equal(normalizeStateCode("ZZ"), null);
  assert.equal(normalizeStateCode(null), null);
});

test("a legacy prose geography list splits into codes plus a nationwide flag", () => {
  assert.deepEqual(parseStateList("GA, FL, Nationwide"), {
    codes: ["FL", "GA"],
    nationwide: true,
  });
  assert.deepEqual(parseStateList(["Texas", "TX", "bogus"]), { codes: ["TX"], nationwide: false });
});
