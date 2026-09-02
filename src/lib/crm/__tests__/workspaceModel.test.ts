import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkQueue,
  CLOSED_LEADS,
  humanLabel,
  leadTitle,
} from "../workspaceModel";
import { TERMINAL_STAGES } from "../../leads/stages";

test("workspace uses canonical closed lead states including withdrawn", () => {
  assert.deepEqual([...CLOSED_LEADS], [...TERMINAL_STAGES]);
  assert.deepEqual(
    buildWorkQueue(
      [],
      [...CLOSED_LEADS].map((status) => ({ id: status, status })),
      [],
    ),
    [],
  );
});
test("all nonterminal stages remain visible including discovery and unresponsive", () => {
  const queue = buildWorkQueue(
    [],
    [
      { id: "1", status: "discovery_scheduled", business_name: "Discovery" },
      { id: "2", status: "unresponsive", business_name: "Reconnect" },
    ],
    [],
  );
  assert.equal(queue.length, 2);
  assert.ok(queue.every((item) => item.recordKind === "lead"));
});
test("queue prioritizes dated commitments without mutating inputs or inventing next steps", () => {
  const tasks = [
    {
      id: "t",
      title: "Call",
      due_at: "2026-09-02T00:00:00Z",
      organizationId: "o",
      organizationName: "Company",
    },
  ];
  const leads = [
    {
      id: "l",
      status: "contacted",
      business_name: "Business",
      next_action: "Send checklist",
      next_action_due_at: "2026-09-01T00:00:00Z",
    },
  ];
  const before = JSON.stringify({ tasks, leads });
  const queue = buildWorkQueue(tasks, leads, [
    { id: "o2", name: "Partner", health: "cooling" },
  ]);
  assert.deepEqual(
    queue.map((i) => i.kind),
    ["lead", "task", "relationship"],
  );
  assert.equal(queue[0].title, "Send checklist");
  assert.equal(queue[1].recordId, "o");
  assert.equal(JSON.stringify({ tasks, leads }), before);
});
test("missing and invalid due dates do not outrank recorded due dates", () => {
  const queue = buildWorkQueue(
    [],
    [
      { id: "bad", status: "new", next_action_due_at: "bad" },
      { id: "good", status: "new", next_action_due_at: "2026-09-10" },
    ],
    [],
  );
  assert.equal(queue[0].recordId, "good");
  assert.match(queue[1].why, /no next action/);
});
test("labels expose human names rather than storage enums", () => {
  assert.equal(
    humanLabel("preliminary_qualification"),
    "Preliminary Qualification",
  );
  assert.equal(
    leadTitle({ id: "l", status: "new", first_name: "Dana", last_name: "Lee" }),
    "Dana Lee",
  );
});
