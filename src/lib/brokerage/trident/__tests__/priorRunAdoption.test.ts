import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Behavioural cover for the cross-run ratchet. A regex on
 * `existing.projections_xlsx_path` used to stand in for this; it asserted one
 * spelling of the read and said nothing about whether a retry actually reuses
 * what a prior run produced.
 *
 * acquire_trident_bundle_run inserts a fresh row per attempt, so without
 * adoption a failed run discarded artifacts it had already built and re-earned
 * all three review verdicts from scratch — with the gates measuring ~39% each,
 * that is why 916 runs published nothing.
 */

type Row = Record<string, unknown>;

function stubClient(opts: { prior: Row | null; leaseHeld?: boolean }) {
  const writes: Row[] = [];
  return {
    writes,
    client: {
      from() {
        const state: { isUpdate: boolean; patch: Row } = { isUpdate: false, patch: {} };
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          neq: () => q,
          order: () => q,
          limit: () => q,
          update(patch: Row) {
            state.isUpdate = true;
            state.patch = patch;
            return q;
          },
          async maybeSingle() {
            if (!state.isUpdate) return { data: opts.prior, error: null };
            if (opts.leaseHeld === false) return { data: null, error: null };
            writes.push(state.patch);
            return { data: { id: "bundle-new" }, error: null };
          },
        };
        return q;
      },
    },
  };
}

const CURRENT_EMPTY: Row = {
  source_sba_package_id: null,
  business_plan_pdf_path: null,
  projections_pdf_path: null,
  projections_xlsx_path: null,
  source_feasibility_id: null,
  feasibility_pdf_path: null,
};

const PRIOR_COMPLETE: Row = {
  source_sba_package_id: "pkg-1",
  business_plan_pdf_path: "bp.pdf",
  projections_pdf_path: null,
  projections_xlsx_path: "proj.xlsx",
  source_feasibility_id: "feas-1",
  feasibility_pdf_path: "feas.pdf",
};

const ARGS = {
  bundleId: "bundle-new",
  dealId: "d4b7104f-7f4b-4ae8-ac39-c2dbbdad3562",
  bankId: "d8a4cf3a-7575-45df-9926-f31eaed99f3c",
  mode: "final" as const,
  inputHash: "a".repeat(64),
  leaseToken: "lease-1",
};

const { adoptPriorRunArtifacts } =
  require("../generateTridentBundle") as typeof import("../generateTridentBundle");

test("a retry adopts the artifacts a prior run built on the same inputs", async () => {
  const { client, writes } = stubClient({ prior: PRIOR_COMPLETE });

  const adopted = await adoptPriorRunArtifacts(client as never, {
    ...ARGS,
    current: { ...CURRENT_EMPTY },
  });

  assert.equal(adopted.source_sba_package_id, "pkg-1");
  assert.equal(adopted.projections_xlsx_path, "proj.xlsx");
  assert.equal(adopted.source_feasibility_id, "feas-1");
  assert.equal(writes.length, 1, "adoption must be persisted, not just held in memory");
});

test("a fresh SBA checkpoint cannot inherit another plan's reviewed PDF or workbook", async () => {
  const { client, writes } = stubClient({ prior: PRIOR_COMPLETE });

  const adopted = await adoptPriorRunArtifacts(client as never, {
    ...ARGS,
    current: { ...CURRENT_EMPTY, source_sba_package_id: "pkg-fresh" },
  });

  assert.equal(adopted.source_sba_package_id, "pkg-fresh");
  assert.equal(adopted.business_plan_pdf_path, null, "the fresh plan must go through review and rendering");
  assert.equal(adopted.projections_xlsx_path, null);
  assert.equal(adopted.source_feasibility_id, "feas-1", "an independent coherent group can still resume");
  assert.deepEqual(writes, [{ source_feasibility_id: "feas-1", feasibility_pdf_path: "feas.pdf" }]);
});

test("a retry bound to the same source can reuse that source's completed files", async () => {
  const { client } = stubClient({ prior: PRIOR_COMPLETE });
  const adopted = await adoptPriorRunArtifacts(client as never, {
    ...ARGS, current: { ...CURRENT_EMPTY, source_sba_package_id: "pkg-1" },
  });
  assert.equal(adopted.business_plan_pdf_path, "bp.pdf");
  assert.equal(adopted.projections_xlsx_path, "proj.xlsx");
});

test("a fresh feasibility study cannot inherit another study's PDF", async () => {
  const { client } = stubClient({ prior: PRIOR_COMPLETE });
  const adopted = await adoptPriorRunArtifacts(client as never, {
    ...ARGS, current: { ...CURRENT_EMPTY, source_feasibility_id: "feas-fresh" },
  });
  assert.equal(adopted.source_feasibility_id, "feas-fresh");
  assert.equal(adopted.feasibility_pdf_path, null);
  assert.equal(adopted.business_plan_pdf_path, "bp.pdf");
});

test("orphan artifacts are never rebound to an inferred source", async () => {
  for (const prior of [
    { ...PRIOR_COMPLETE, source_sba_package_id: null },
    PRIOR_COMPLETE,
  ]) {
    const { client } = stubClient({ prior });
    const current = { ...CURRENT_EMPTY, business_plan_pdf_path: "orphan.pdf" };
    const adopted = await adoptPriorRunArtifacts(client as never, { ...ARGS, current });
    assert.equal(adopted.source_sba_package_id, null);
    assert.equal(adopted.business_plan_pdf_path, "orphan.pdf");
    assert.equal(adopted.projections_xlsx_path, null);
  }
});

test("a run that already has everything does not touch the database", async () => {
  const { client, writes } = stubClient({ prior: PRIOR_COMPLETE });

  const current = { ...PRIOR_COMPLETE, projections_pdf_path: "p.pdf" };
  const adopted = await adoptPriorRunArtifacts(client as never, { ...ARGS, current });

  assert.deepEqual(adopted, current);
  assert.equal(writes.length, 0);
});

test("with no prior run the current state is returned untouched", async () => {
  const { client, writes } = stubClient({ prior: null });

  const adopted = await adoptPriorRunArtifacts(client as never, {
    ...ARGS,
    current: { ...CURRENT_EMPTY },
  });

  assert.deepEqual(adopted, CURRENT_EMPTY);
  assert.equal(writes.length, 0);
});

test("a lost lease means nothing is adopted, not silently adopted in memory", async () => {
  // Claiming to have adopted while the write was refused would leave the run
  // believing it had artifacts the row does not carry.
  const { client } = stubClient({ prior: PRIOR_COMPLETE, leaseHeld: false });

  const adopted = await adoptPriorRunArtifacts(client as never, {
    ...ARGS,
    current: { ...CURRENT_EMPTY },
  });

  assert.deepEqual(adopted, CURRENT_EMPTY);
});

test("adoption never fails a run", async () => {
  const exploding = {
    from() {
      throw new Error("connection reset");
    },
  };

  const adopted = await adoptPriorRunArtifacts(exploding as never, {
    ...ARGS,
    current: { ...CURRENT_EMPTY },
  });

  assert.deepEqual(adopted, CURRENT_EMPTY, "an optimisation must not be why a run dies");
});
