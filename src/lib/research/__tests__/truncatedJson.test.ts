import test from "node:test";
import assert from "node:assert/strict";
import { closeTruncatedJson } from "../truncatedJson";

// Gemini stopped at MAX_TOKENS mid-document; the provider used to throw the
// whole reply away. The closer must yield parseable JSON without inventing values.

test("closes an object cut inside a string value", () => {
  const out = closeTruncatedJson('{"executive_credit_thesis": "Strong operator with lim');
  assert.deepEqual(JSON.parse(out), {});
});

test("keeps completed fields and drops the dangling key", () => {
  const out = closeTruncatedJson('{"a": "done", "b": [1, 2], "c":');
  assert.deepEqual(JSON.parse(out), { a: "done", b: [1, 2] });
});

test("closes nested arrays and objects", () => {
  const out = closeTruncatedJson('{"a": {"b": ["x", "y", {"c": 1');
  assert.deepEqual(JSON.parse(out), { a: { b: ["x", "y", { c: 1 }] } });
});

test("drops a trailing comma and a partial literal", () => {
  assert.deepEqual(JSON.parse(closeTruncatedJson('{"a": 1, "b": tru')), { a: 1 });
  assert.deepEqual(JSON.parse(closeTruncatedJson('{"a": 1,')), { a: 1 });
  assert.deepEqual(JSON.parse(closeTruncatedJson('["x", "y",')), ["x", "y"]);
});

test("handles escaped quotes inside strings", () => {
  const out = closeTruncatedJson('{"a": "he said \\"hi\\"", "b": "cut he');
  assert.deepEqual(JSON.parse(out), { a: 'he said "hi"' });
});

test("a complete document is returned unchanged", () => {
  const doc = '{"a": [1, {"b": "c"}], "d": null}';
  assert.equal(closeTruncatedJson(doc), doc);
});

test("realistic synthesis cut-off keeps the thesis", () => {
  const partial =
    '{"executive_credit_thesis": "Buff Guys is a private detailer with limited public footprint.", ' +
    '"key_strengths": ["owner expertise", "repeat customers"], ' +
    '"three_year_outlook": "Base case: steady growth; downside: discretionary spend falls; key assumptions: ret';
  const parsed = JSON.parse(closeTruncatedJson(partial));
  assert.match(parsed.executive_credit_thesis, /private detailer/);
  assert.deepEqual(parsed.key_strengths, ["owner expertise", "repeat customers"]);
  assert.equal("three_year_outlook" in parsed, false);
});
