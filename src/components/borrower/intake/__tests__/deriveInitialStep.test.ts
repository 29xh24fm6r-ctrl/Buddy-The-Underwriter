import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const client = require("../IntakeFormClient") as typeof import("../IntakeFormClient");
const { deriveInitialStep } = client;

type Section = { section_key: string; data: Record<string, unknown>; completed: boolean };

function section(key: string, completed: boolean): Section {
  return { section_key: key, data: {}, completed };
}

test("brand-new borrower (no sections) starts at step 1", () => {
  assert.equal(deriveInitialStep([], false), 1);
  assert.equal(deriveInitialStep([], true), 1);
});

test("non-SBA: resumes at first incomplete data step", () => {
  const sections = [section("business", true), section("address", true)];
  assert.equal(deriveInitialStep(sections, false), 3); // owners
});

test("non-SBA: all data steps complete resumes at Documents (step 5)", () => {
  const sections = [
    section("business", true),
    section("address", true),
    section("owners", true),
    section("loan", true),
  ];
  assert.equal(deriveInitialStep(sections, false), 5);
});

test("SBA: resumes at compliance step (5) once loan is done", () => {
  const sections = [
    section("business", true),
    section("address", true),
    section("owners", true),
    section("loan", true),
  ];
  assert.equal(deriveInitialStep(sections, true), 5);
});

test("SBA: all data steps complete resumes at Documents (step 7)", () => {
  const sections = [
    section("business", true),
    section("address", true),
    section("owners", true),
    section("loan", true),
    section("compliance", true),
    section("projections", true),
  ];
  assert.equal(deriveInitialStep(sections, true), 7);
});

test("owners section present but not completed (0 owners) stops resume there", () => {
  const sections = [
    section("business", true),
    section("address", true),
    section("owners", false),
    section("loan", true),
  ];
  assert.equal(deriveInitialStep(sections, false), 3);
});
