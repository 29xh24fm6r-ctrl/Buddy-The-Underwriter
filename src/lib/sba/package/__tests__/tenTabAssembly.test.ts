import { test } from "node:test";
import assert from "node:assert/strict";
import { tabForTemplateCode, orderItemsByTab, TEN_TAB_STRUCTURE } from "@/lib/sba/package/tenTabAssembly";

test("tabForTemplateCode: SBA_NOTE -> tab 1 (Closing Documents)", () => {
  const tab = tabForTemplateCode("SBA_NOTE");
  assert.equal(tab.tab, 1);
  assert.equal(tab.label, "Closing Documents");
});

test("tabForTemplateCode: SBA_AUTHORIZATION -> same tab 1 as SBA_NOTE (both closing documents)", () => {
  assert.equal(tabForTemplateCode("SBA_AUTHORIZATION").tab, 1);
});

test("tabForTemplateCode: SBA_1919 -> tab 2 (Loan Application)", () => {
  const tab = tabForTemplateCode("SBA_1919");
  assert.equal(tab.tab, 2);
  assert.equal(tab.label, "Loan Application");
});

test("tabForTemplateCode: SBA_1244 -> same tab 2 as SBA_1919 (both loan applications)", () => {
  assert.equal(tabForTemplateCode("SBA_1244").tab, 2);
});

test("tabForTemplateCode: unmapped template code -> falls back to tab 11 (Supporting Documents)", () => {
  const tab = tabForTemplateCode("SOME_UNKNOWN_FORM");
  assert.equal(tab.tab, 11);
  assert.equal(tab.label, "Supporting Documents");
});

test("TEN_TAB_STRUCTURE: has exactly 11 tabs, 1-11 in order", () => {
  assert.equal(TEN_TAB_STRUCTURE.length, 11);
  TEN_TAB_STRUCTURE.forEach((t, i) => assert.equal(t.tab, i + 1));
});

test("orderItemsByTab: excludes non-generated items", () => {
  const items = [
    { id: "1", template_code: "SBA_1919", title: "1919", status: "generated", output_storage_path: "path/1.pdf" },
    { id: "2", template_code: "SBA_413", title: "413", status: "failed", output_storage_path: null },
  ];
  const result = orderItemsByTab(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].item.id, "1");
});

test("orderItemsByTab: sorts by tab order regardless of input order", () => {
  const items = [
    { id: "148", template_code: "SBA_148", title: "148", status: "generated", output_storage_path: "path/148.pdf" }, // tab 8
    { id: "note", template_code: "SBA_NOTE", title: "Note", status: "generated", output_storage_path: "path/note.pdf" }, // tab 1
    { id: "1919", template_code: "SBA_1919", title: "1919", status: "generated", output_storage_path: "path/1919.pdf" }, // tab 2
    { id: "413", template_code: "SBA_413", title: "413", status: "generated", output_storage_path: "path/413.pdf" }, // tab 3
  ];
  const result = orderItemsByTab(items);
  assert.deepEqual(result.map((r) => r.item.id), ["note", "1919", "413", "148"]);
});

test("orderItemsByTab: empty input -> empty output", () => {
  assert.deepEqual(orderItemsByTab([]), []);
});
