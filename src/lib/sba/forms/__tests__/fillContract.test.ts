import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Form 1919
import {
  FORM_1919_SECTION_I_TEXT_FIELDS,
  FORM_1919_SECTION_I_CHECKBOX_FIELDS,
  FORM_1919_SECTION_II_TEXT_FIELDS,
  FORM_1919_ROSTER_FIELDS,
  FORM_1919_VETERAN_CHECKBOX_FIELDS,
  FORM_1919_SEX_CHECKBOX_FIELDS,
  FORM_1919_RACE_CHECKBOX_FIELDS,
  FORM_1919_ETHNICITY_CHECKBOX_FIELDS,
  FORM_1919_YES_NO_QUESTIONS,
  FORM_1919_SIGNATURE_TEXT_FIELDS,
} from "@/lib/sba/forms/form1919/pdfFieldMap";

// Form 1244
import {
  FORM_1244_SECTION_I_TEXT_FIELDS,
  FORM_1244_SECTION_I_CHECKBOX_FIELDS,
  FORM_1244_APPLICANT_OWNER_ROSTER_FIELDS,
  FORM_1244_OC_OWNER_ROSTER_FIELDS,
  FORM_1244_SECTION_II_TEXT_FIELDS,
  FORM_1244_SECTION_II_CHECKBOX_FIELDS,
  FORM_1244_SECTION_III_TEXT_FIELDS,
} from "@/lib/sba/forms/form1244/pdfFieldMap";

// Form 413
import {
  FORM_413_TEXT_FIELDS,
  FORM_413_CHECKBOX_FIELDS,
  FORM_413_NOTES_PAYABLE_FIELDS,
  FORM_413_SECURITIES_FIELDS,
  FORM_413_REAL_ESTATE_FIELDS,
} from "@/lib/sba/forms/form413/pdfFieldMap";

// Form 912
import {
  FORM_912_TEXT_FIELDS,
  FORM_912_CHECKBOX_FIELDS,
  FORM_912_RADIO_FIELDS,
} from "@/lib/sba/forms/form912/pdfFieldMap";

// Form 4506-C
import {
  FORM_4506C_TEXT_FIELDS,
  FORM_4506C_TAX_PERIOD_FIELDS,
  FORM_4506C_CHECKBOX_FIELDS,
} from "@/lib/sba/forms/form4506c/pdfFieldMap";

// Form 155
import {
  FORM_155_TEXT_FIELDS,
  FORM_155_RADIO_FIELDS,
} from "@/lib/sba/forms/form155/pdfFieldMap";

// Form 601
import { FORM_601_TEXT_FIELDS } from "@/lib/sba/forms/form601/pdfFieldMap";

// Form 148 / 148L
import {
  FORM_148_TEXT_FIELDS,
  FORM_148L_TEXT_FIELDS,
  FORM_148L_CHECKBOX_FIELDS,
} from "@/lib/sba/forms/form148/pdfFieldMap";

// Form 159
import {
  FORM_159_TEXT_FIELDS,
  FORM_159_CHECKBOX_FIELDS,
} from "@/lib/sba/forms/form159/pdfFieldMap";

type FieldSpec = { name: string; type: string };

function loadFieldsJson(formName: string): { fieldCount: number; fields: FieldSpec[] } {
  const jsonPath = path.resolve(process.cwd(), `docs/sba-forms/${formName}-fields.json`);
  return JSON.parse(readFileSync(jsonPath, "utf-8"));
}

function fieldNameMap(json: { fields: FieldSpec[] }): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of json.fields) m.set(f.name, f.type);
  return m;
}

function valuesOf(...maps: Record<string, string>[]): string[] {
  return maps.flatMap((m) => Object.values(m));
}

function rosterValues(roster: Array<Record<string, string>>): string[] {
  return roster.flatMap((slot) => Object.values(slot));
}

function assertAllExist(
  label: string,
  acroNames: string[],
  expectedType: string,
  pdfFields: Map<string, string>,
) {
  const missing: string[] = [];
  const typeMismatches: string[] = [];
  for (const name of acroNames) {
    const actualType = pdfFields.get(name);
    if (!actualType) {
      missing.push(name);
    } else if (actualType !== expectedType) {
      typeMismatches.push(`${name}: expected ${expectedType}, got ${actualType}`);
    }
  }
  assert.deepStrictEqual(missing, [], `${label}: missing from fields.json: [${missing.join(", ")}]`);
  assert.deepStrictEqual(typeMismatches, [], `${label}: type mismatches: [${typeMismatches.join("; ")}]`);
}

describe("Fill contract: every renderer field name exists in its form's fields.json", () => {
  test("Form 1919", () => {
    const json = loadFieldsJson("1919");
    const pdf = fieldNameMap(json);

    const textNames = [
      ...valuesOf(FORM_1919_SECTION_I_TEXT_FIELDS, FORM_1919_SECTION_II_TEXT_FIELDS, FORM_1919_SIGNATURE_TEXT_FIELDS),
      ...rosterValues(FORM_1919_ROSTER_FIELDS),
    ];
    assertAllExist("1919 text", textNames, "PDFTextField", pdf);

    const checkboxNames = [
      ...valuesOf(
        FORM_1919_SECTION_I_CHECKBOX_FIELDS,
        FORM_1919_VETERAN_CHECKBOX_FIELDS,
        FORM_1919_SEX_CHECKBOX_FIELDS,
        FORM_1919_RACE_CHECKBOX_FIELDS,
        FORM_1919_ETHNICITY_CHECKBOX_FIELDS,
      ),
      ...Object.values(FORM_1919_YES_NO_QUESTIONS).flatMap((q) => [q.yes, q.no]),
    ];
    assertAllExist("1919 checkbox", checkboxNames, "PDFCheckBox", pdf);

    assert.ok(
      textNames.length + checkboxNames.length > 50,
      `1919: expected >50 mapped fields, got ${textNames.length + checkboxNames.length}`,
    );
  });

  test("Form 1244", () => {
    const json = loadFieldsJson("1244");
    const pdf = fieldNameMap(json);

    const textNames = [
      ...valuesOf(
        FORM_1244_SECTION_I_TEXT_FIELDS as unknown as Record<string, string>,
        FORM_1244_SECTION_II_TEXT_FIELDS as unknown as Record<string, string>,
        FORM_1244_SECTION_III_TEXT_FIELDS as unknown as Record<string, string>,
      ),
      ...rosterValues(FORM_1244_APPLICANT_OWNER_ROSTER_FIELDS),
      ...rosterValues(FORM_1244_OC_OWNER_ROSTER_FIELDS),
    ];
    assertAllExist("1244 text", textNames, "PDFTextField", pdf);

    const checkboxNames = valuesOf(
      FORM_1244_SECTION_I_CHECKBOX_FIELDS as unknown as Record<string, string>,
      FORM_1244_SECTION_II_CHECKBOX_FIELDS as unknown as Record<string, string>,
    );
    assertAllExist("1244 checkbox", checkboxNames, "PDFCheckBox", pdf);
  });

  test("Form 413", () => {
    const json = loadFieldsJson("413");
    const pdf = fieldNameMap(json);

    const textNames = [
      ...valuesOf(FORM_413_TEXT_FIELDS),
      ...FORM_413_NOTES_PAYABLE_FIELDS.flatMap((r) => Object.values(r)),
      ...FORM_413_SECURITIES_FIELDS.flatMap((r) => Object.values(r)),
      ...(["A", "B", "C"] as const).flatMap((k) => Object.values(FORM_413_REAL_ESTATE_FIELDS[k])),
    ];
    assertAllExist("413 text", textNames, "PDFTextField", pdf);

    const checkboxNames = valuesOf(FORM_413_CHECKBOX_FIELDS);
    assertAllExist("413 checkbox", checkboxNames, "PDFCheckBox", pdf);
  });

  test("Form 912", () => {
    const json = loadFieldsJson("912");
    const pdf = fieldNameMap(json);

    const textNames = valuesOf(FORM_912_TEXT_FIELDS);
    assertAllExist("912 text", textNames, "PDFTextField", pdf);

    const checkboxNames = valuesOf(FORM_912_CHECKBOX_FIELDS);
    assertAllExist("912 checkbox", checkboxNames, "PDFCheckBox", pdf);

    // Radio fields — verify the group field names exist as PDFRadioGroup
    for (const [key, radio] of Object.entries(FORM_912_RADIO_FIELDS)) {
      const actualType = pdf.get(radio.fieldName);
      assert.ok(actualType, `912 radio: "${radio.fieldName}" (${key}) not found in fields.json`);
      assert.strictEqual(
        actualType,
        "PDFRadioGroup",
        `912 radio: "${radio.fieldName}" expected PDFRadioGroup, got ${actualType}`,
      );
    }
  });

  test("Form 4506-C", () => {
    const json = loadFieldsJson("4506c");
    const pdf = fieldNameMap(json);

    const textNames = [
      ...valuesOf(FORM_4506C_TEXT_FIELDS),
      ...FORM_4506C_TAX_PERIOD_FIELDS.flatMap((p) => [p.month, p.day, p.year]),
    ];
    assertAllExist("4506c text", textNames, "PDFTextField", pdf);

    const checkboxNames = valuesOf(FORM_4506C_CHECKBOX_FIELDS);
    assertAllExist("4506c checkbox", checkboxNames, "PDFCheckBox", pdf);
  });

  test("Form 155", () => {
    const json = loadFieldsJson("155");
    const pdf = fieldNameMap(json);

    const textNames = valuesOf(FORM_155_TEXT_FIELDS as unknown as Record<string, string>);
    assertAllExist("155 text", textNames, "PDFTextField", pdf);

    // Radio group
    const radioFieldName = FORM_155_RADIO_FIELDS.agree_option.fieldName;
    const actualType = pdf.get(radioFieldName);
    assert.ok(actualType, `155 radio: "${radioFieldName}" not found in fields.json`);
    assert.strictEqual(actualType, "PDFRadioGroup", `155 radio: expected PDFRadioGroup, got ${actualType}`);
  });

  test("Form 601", () => {
    const json = loadFieldsJson("601");
    const pdf = fieldNameMap(json);

    const textNames = valuesOf(FORM_601_TEXT_FIELDS as unknown as Record<string, string>);
    assertAllExist("601 text", textNames, "PDFTextField", pdf);
  });

  test("Form 148 (unconditional)", () => {
    const json = loadFieldsJson("148");
    const pdf = fieldNameMap(json);

    const textNames = valuesOf(FORM_148_TEXT_FIELDS as unknown as Record<string, string>);
    assertAllExist("148 text", textNames, "PDFTextField", pdf);
  });

  test("Form 148L (limited)", () => {
    const json = loadFieldsJson("148l");
    const pdf = fieldNameMap(json);

    const textNames = valuesOf(FORM_148L_TEXT_FIELDS as unknown as Record<string, string>);
    assertAllExist("148L text", textNames, "PDFTextField", pdf);

    const checkboxNames = valuesOf(FORM_148L_CHECKBOX_FIELDS as unknown as Record<string, string>);
    assertAllExist("148L checkbox", checkboxNames, "PDFCheckBox", pdf);
  });

  test("Form 159", () => {
    const json = loadFieldsJson("159");
    const pdf = fieldNameMap(json);

    const textNames = valuesOf(FORM_159_TEXT_FIELDS);
    assertAllExist("159 text", textNames, "PDFTextField", pdf);

    const checkboxNames = valuesOf(FORM_159_CHECKBOX_FIELDS);
    assertAllExist("159 checkbox", checkboxNames, "PDFCheckBox", pdf);

    assert.ok(
      textNames.length + checkboxNames.length > 30,
      `159: expected >30 mapped fields, got ${textNames.length + checkboxNames.length}`,
    );
  });

  test("SBA_NOTE, SBA_AUTHORIZATION, SBA_722 are not AcroForm-filled (no contract needed)", () => {
    // SBA_NOTE: generated from scratch with PDFKit
    // SBA_AUTHORIZATION: generated from scratch with PDFKit
    // SBA_722: static poster PDF, no fill
    assert.ok(true);
  });
});
