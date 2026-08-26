/**
 * SPEC-FRANCHISE-SYNC-HYGIENE-1 tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runFranchiseSyncJanitor } from "../franchiseSyncJanitor";

const DAY = 86_400_000;

function makeSb(opts: {
  orphanIds?: string[];
  runs?: Array<Record<string, unknown>>;
  updateError?: string;
}) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    from(table: string) {
      if (table !== "franchise_sync_runs") throw new Error(`unexpected table ${table}`);
      const chain: any = {
        _update: null as Record<string, unknown> | null,
        update(patch: Record<string, unknown>) {
          chain._update = patch;
          calls.push({ op: "update", patch });
          return chain;
        },
        eq() { return chain; },
        lt() { return chain; },
        gte() { return chain; },
        limit() {
          return Promise.resolve({ data: opts.runs ?? [], error: null });
        },
        select() {
          if (chain._update) {
            return Promise.resolve(
              opts.updateError
                ? { data: null, error: { message: opts.updateError } }
                : { data: (opts.orphanIds ?? []).map((id) => ({ id })), error: null },
            );
          }
          return chain;
        },
      };
      return chain;
    },
  };
}

describe("runFranchiseSyncJanitor", () => {
  it("finalizes orphaned 'running' rows as failed", async () => {
    const sb = makeSb({ orphanIds: ["a", "b", "c"] });
    const r = await runFranchiseSyncJanitor(sb as any);
    assert.equal(r.orphansFinalized, 3);
    const update = sb.calls.find((c) => c.op === "update")!.patch as Record<string, any>;
    assert.equal(update.status, "failed");
    assert.ok(update.completed_at, "must stamp completed_at so it stops looking in-flight");
  });

  it("flags a source whose runs report complete but carry errors", async () => {
    const now = new Date().toISOString();
    const sb = makeSb({
      runs: [
        { source: "nasaa_efd", status: "complete", error_count: 4, completed_at: now },
        { source: "nasaa_efd", status: "complete", error_count: 7, completed_at: now },
        { source: "nasaa_efd", status: "complete", error_count: 0, completed_at: now },
        { source: "fdd_extraction", status: "complete", error_count: 0, completed_at: now },
      ],
    });
    const r = await runFranchiseSyncJanitor(sb as any);
    const degraded = r.degradedSources.map((d) => d.source);
    assert.ok(degraded.includes("nasaa_efd"), JSON.stringify(r.degradedSources));
    assert.ok(!degraded.includes("fdd_extraction"));
  });

  it("flags a source that has gone quiet", async () => {
    const stale = new Date(Date.now() - 30 * DAY).toISOString();
    const fresh = new Date().toISOString();
    const sb = makeSb({
      runs: [
        { source: "sba_directory", status: "complete", error_count: 0, completed_at: stale },
        { source: "fdd_extraction", status: "complete", error_count: 0, completed_at: fresh },
      ],
    });
    const r = await runFranchiseSyncJanitor(sb as any);
    const quiet = r.staleSources.map((s) => s.source);
    assert.ok(quiet.includes("sba_directory"), JSON.stringify(r.staleSources));
    assert.ok(!quiet.includes("fdd_extraction"));
  });

  it("reports errors without throwing so the nightly job continues", async () => {
    const sb = makeSb({ updateError: "permission denied" });
    const r = await runFranchiseSyncJanitor(sb as any);
    assert.equal(r.orphansFinalized, 0);
    assert.match(r.errors.join(" "), /permission denied/);
  });
});
