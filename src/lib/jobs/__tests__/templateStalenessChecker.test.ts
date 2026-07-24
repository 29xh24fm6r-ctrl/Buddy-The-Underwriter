import { test } from "node:test";
import assert from "node:assert/strict";
import { findTemplateStaleness, writeTemplateStalenessFindings } from "@/lib/jobs/templateStalenessChecker";
import { OFFICIAL_TEMPLATE_SOURCES } from "@/lib/sba/templates/officialTemplateSources";

function fakeResponse(opts: { ok: boolean; status?: number; statusText?: string; text?: string; arrayBuffer?: ArrayBuffer }) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    statusText: opts.statusText ?? "",
    text: async () => opts.text ?? "",
    arrayBuffer: async () => opts.arrayBuffer ?? new ArrayBuffer(0),
  } as Response;
}

function withFetch(impl: (url: string) => Promise<Response>, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  // @ts-expect-error - test stub
  globalThis.fetch = (url: string) => impl(String(url));
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// Every source page resolves to the SAME live PDF content ("live-bytes"),
// regardless of templateKey — good enough to test the comparison logic
// without needing 10 distinct fixtures.
function stubAllSourcesToLiveBytes(liveBytes: string) {
  return async (url: string) => {
    const source = OFFICIAL_TEMPLATE_SOURCES.find((s) => s.sourcePageUrl === url);
    if (source) {
      return fakeResponse({
        ok: true,
        text: `<a href="https://www.sba.gov/sites/x/${source.templateKey}.pdf">PDF</a> Revision date: January 2026`,
      });
    }
    if (url.endsWith(".pdf")) {
      return fakeResponse({ ok: true, arrayBuffer: new TextEncoder().encode(liveBytes).buffer });
    }
    throw new Error(`unexpected url: ${url}`);
  };
}

function makeSb(storedRows: Record<string, { id: string; version: string; file_sha256: string }>) {
  return {
    from(table: string) {
      return {
        select() {
          return this;
        },
        is() {
          return this;
        },
        eq(_k: string, v: string) {
          this._templateKey = v;
          return this;
        },
        update(patch: Record<string, unknown>) {
          this._patch = patch;
          return this;
        },
        maybeSingle: async function () {
          if (table === "bank_document_templates" && !this._patch) {
            const row = storedRows[this._templateKey];
            return { data: row ?? null, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: any) {
          resolve({ data: null, error: null });
        },
      } as any;
    },
  } as any;
}

test("findTemplateStaleness: matching sha256 -> not stale", async () => {
  const liveBytes = "same-bytes";
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(liveBytes).digest("hex");

  const storedRows: Record<string, any> = {};
  for (const s of OFFICIAL_TEMPLATE_SOURCES) {
    storedRows[s.templateKey] = { id: `row-${s.templateKey}`, version: "January 2026", file_sha256: sha256 };
  }

  await withFetch(stubAllSourcesToLiveBytes(liveBytes), async () => {
    const findings = await findTemplateStaleness(makeSb(storedRows));
    assert.equal(findings.length, OFFICIAL_TEMPLATE_SOURCES.length);
    assert.ok(findings.every((f) => f.ok && !f.isStale));
  });
});

test("findTemplateStaleness: different sha256 -> stale", async () => {
  const storedRows: Record<string, any> = {};
  for (const s of OFFICIAL_TEMPLATE_SOURCES) {
    storedRows[s.templateKey] = { id: `row-${s.templateKey}`, version: "January 2020", file_sha256: "old-sha-that-will-never-match" };
  }

  await withFetch(stubAllSourcesToLiveBytes("new-live-bytes"), async () => {
    const findings = await findTemplateStaleness(makeSb(storedRows));
    assert.ok(findings.every((f) => f.ok && f.isStale));
  });
});

test("findTemplateStaleness: no stored row at all -> treated as stale, not a crash", async () => {
  await withFetch(stubAllSourcesToLiveBytes("whatever"), async () => {
    const findings = await findTemplateStaleness(makeSb({}));
    assert.ok(findings.every((f) => f.ok && f.isStale && f.templateRowId === null));
  });
});

test("findTemplateStaleness: a resolution failure is reported as !ok, not silently marked stale", async () => {
  const storedRows: Record<string, any> = {};
  for (const s of OFFICIAL_TEMPLATE_SOURCES) {
    storedRows[s.templateKey] = { id: `row-${s.templateKey}`, version: "January 2026", file_sha256: "whatever" };
  }

  await withFetch(
    async () => fakeResponse({ ok: false, status: 403, statusText: "Forbidden" }),
    async () => {
      const findings = await findTemplateStaleness(makeSb(storedRows));
      assert.ok(findings.every((f) => !f.ok && !f.isStale && f.error?.includes("403")));
    },
  );
});

test("writeTemplateStalenessFindings: updates last_checked_at + is_stale for rows with an id, skips rows without one", async () => {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const sb = {
    from(_table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_k: string, id: string) => {
              updates.push({ id, patch });
              return { data: null, error: null };
            },
          };
        },
      };
    },
  } as any;

  const written = await writeTemplateStalenessFindings(sb, [
    { templateKey: "SBA_1919", templateRowId: "row-1", ok: true, isStale: true, storedRevision: "x", liveRevision: "y", storedSha256: "a", liveSha256: "b" },
    { templateKey: "SBA_413", templateRowId: null, ok: false, isStale: false, storedRevision: null, liveRevision: null, storedSha256: null, liveSha256: null, error: "boom" },
  ]);

  assert.equal(written, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "row-1");
  assert.equal(updates[0].patch.is_stale, true);
  assert.ok(updates[0].patch.last_checked_at);
});
