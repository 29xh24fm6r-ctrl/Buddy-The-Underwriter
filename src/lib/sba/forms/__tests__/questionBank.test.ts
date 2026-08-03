import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  questionsForForm,
  requiredQuestionsForForm,
  questionsForForms,
  fullQuestionBank,
  CHARACTER_QUESTION_KEYS,
  PII_VAULT_KEYS,
  type FormQuestion,
} from "@/lib/sba/forms/questionBank";

import { BORROWER_FIELD_REGISTRY } from "@/lib/sba/forms/borrowerFieldRegistry";

describe("Question bank", () => {
  test("every registry entry with appliesToForms has a question", () => {
    const bank = fullQuestionBank();
    const bankKeys = new Set(bank.map((q) => q.key));
    const registryWithForms = BORROWER_FIELD_REGISTRY.filter((e) => e.appliesToForms.length > 0);

    const missing = registryWithForms.filter((e) => !bankKeys.has(e.key));
    assert.deepStrictEqual(
      missing.map((e) => e.key),
      [],
      `Registry entries missing from question bank: ${missing.map((e) => e.key).join(", ")}`,
    );
  });

  test("every question has non-empty question text", () => {
    const bank = fullQuestionBank();
    const empty = bank.filter((q) => !q.question || q.question.trim().length === 0);
    assert.deepStrictEqual(
      empty.map((q) => q.key),
      [],
      `Questions with empty text: ${empty.map((q) => q.key).join(", ")}`,
    );
  });

  test("character questions are flagged for explicit confirmation", () => {
    const bank = fullQuestionBank();
    const characterQs = bank.filter((q) => CHARACTER_QUESTION_KEYS.has(q.key));

    assert.ok(characterQs.length >= 20, `Expected >= 20 character questions, got ${characterQs.length}`);

    const notFlagged = characterQs.filter((q) => !q.requiresExplicitConfirmation);
    assert.deepStrictEqual(
      notFlagged.map((q) => q.key),
      [],
      `Character questions not flagged for confirmation: ${notFlagged.map((q) => q.key).join(", ")}`,
    );
  });

  test("PII vault questions are flagged", () => {
    const bank = fullQuestionBank();
    const piiQs = bank.filter((q) => PII_VAULT_KEYS.has(q.key));

    assert.strictEqual(piiQs.length, 2, "Expected 2 PII vault questions (full_ssn, spouse_full_ssn)");
    for (const q of piiQs) {
      assert.ok(q.requiresPiiVault, `${q.key} should require PII vault`);
      assert.strictEqual(q.inputType, "ssn", `${q.key} should have inputType 'ssn'`);
    }
  });

  test("questionsForForm returns only questions applicable to that form", () => {
    const q1919 = questionsForForm("1919");
    assert.ok(q1919.length > 30, `1919 should have > 30 questions, got ${q1919.length}`);

    for (const q of q1919) {
      assert.ok(
        q.registryEntry.appliesToForms.includes("1919"),
        `${q.key} should apply to 1919`,
      );
    }
  });

  test("requiredQuestionsForForm is a subset of questionsForForm", () => {
    for (const code of ["1919", "1244", "912", "4506c", "148", "155", "601", "413"]) {
      const all = new Set(questionsForForm(code).map((q) => q.key));
      const required = requiredQuestionsForForm(code);
      const extra = required.filter((q) => !all.has(q.key));
      assert.deepStrictEqual(
        extra.map((q) => q.key),
        [],
        `${code}: required questions not in full set: ${extra.map((q) => q.key).join(", ")}`,
      );
    }
  });

  test("questionsForForms deduplicates across forms", () => {
    const combined = questionsForForms(["1919", "912"]);
    const keys = combined.map((q) => q.key);
    const unique = new Set(keys);
    assert.strictEqual(keys.length, unique.size, "questionsForForms should not have duplicate keys");
  });

  test("Form 1919 character questions are all 13", () => {
    const q1919 = questionsForForm("1919");
    const character = q1919.filter((q) => q.group === "owner_character_1919");
    assert.strictEqual(character.length, 13, `Expected 13 Form 1919 character questions, got ${character.length}`);
  });

  test("Form 1244 character questions are all 5", () => {
    const q1244 = questionsForForm("1244");
    const character = q1244.filter((q) => q.group === "owner_character_1244");
    assert.strictEqual(character.length, 5, `Expected 5 Form 1244 character questions, got ${character.length}`);
  });

  test("Form 912 character questions are at least 2", () => {
    const q912 = questionsForForm("912");
    const character = q912.filter((q) => q.group === "owner_character_912");
    assert.ok(character.length >= 2, `Expected >= 2 Form 912 character questions, got ${character.length}`);
  });

  test("conditional questions reference valid keys", () => {
    const bank = fullQuestionBank();
    const allKeys = new Set(BORROWER_FIELD_REGISTRY.map((e) => e.key));
    const withConditional = bank.filter((q) => q.conditionalOn);
    for (const q of withConditional) {
      assert.ok(
        allKeys.has(q.conditionalOn!),
        `${q.key} has conditionalOn "${q.conditionalOn}" which is not a registry key`,
      );
    }
  });

  test("no question maps to an empty group", () => {
    const bank = fullQuestionBank();
    const emptyGroup = bank.filter((q) => !q.group);
    assert.strictEqual(emptyGroup.length, 0, "All questions should have a group");
  });
});
