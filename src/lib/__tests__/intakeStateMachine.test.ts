import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionIntakeState } from "@/lib/deals/intakeState";

test("intake state machine allows upload flow", () => {
  assert.equal(canTransitionIntakeState("CREATED", "UPLOAD_SESSION_READY"), true);
  assert.equal(canTransitionIntakeState("UPLOAD_SESSION_READY", "UPLOADING"), true);
  assert.equal(canTransitionIntakeState("UPLOADING", "UPLOAD_COMPLETE"), true);
  assert.equal(canTransitionIntakeState("UPLOAD_COMPLETE", "INTAKE_RUNNING"), true);
  assert.equal(canTransitionIntakeState("INTAKE_RUNNING", "READY_FOR_UNDERWRITE"), true);
});

test("intake state machine blocks invalid transitions", () => {
  assert.equal(canTransitionIntakeState("CREATED", "UPLOAD_COMPLETE"), false);
  assert.equal(canTransitionIntakeState("UPLOAD_COMPLETE", "UPLOADING"), false);
});
