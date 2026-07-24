import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCurrentTemplateRevision } from "@/lib/sba/templates/resolveCurrentTemplateRevision";

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

test("resolveCurrentTemplateRevision: resolves an sba.gov-hosted PDF link + revision date", async () => {
  await withFetch(
    async (url) => {
      if (url === "https://www.sba.gov/document/sba-form-1919-borrower-information-form") {
        return fakeResponse({
          ok: true,
          text: `<html><a href="https://www.sba.gov/sites/default/files/2026-01/SBA-Form-1919.pdf">PDF</a> Revision date: January 2026</html>`,
        });
      }
      if (url === "https://www.sba.gov/sites/default/files/2026-01/SBA-Form-1919.pdf") {
        return fakeResponse({ ok: true, arrayBuffer: new TextEncoder().encode("fake-pdf-bytes").buffer });
      }
      throw new Error(`unexpected url: ${url}`);
    },
    async () => {
      const result = await resolveCurrentTemplateRevision(
        "https://www.sba.gov/document/sba-form-1919-borrower-information-form",
      );
      assert.equal(result.pdfUrl, "https://www.sba.gov/sites/default/files/2026-01/SBA-Form-1919.pdf");
      assert.equal(result.revision, "January 2026");
      assert.equal(result.sha256.length, 64);
      assert.ok(result.pdfBytes.length > 0);
    },
  );
});

test("resolveCurrentTemplateRevision: resolves an irs.gov-hosted PDF link too (not just sba.gov)", async () => {
  await withFetch(
    async (url) => {
      if (url === "https://www.irs.gov/forms-pubs/about-form-4506-c") {
        return fakeResponse({
          ok: true,
          text: `<html><a href="https://www.irs.gov/pub/irs-pdf/f4506c.pdf">PDF</a></html>`,
        });
      }
      if (url === "https://www.irs.gov/pub/irs-pdf/f4506c.pdf") {
        return fakeResponse({ ok: true, arrayBuffer: new TextEncoder().encode("fake-irs-pdf").buffer });
      }
      throw new Error(`unexpected url: ${url}`);
    },
    async () => {
      const result = await resolveCurrentTemplateRevision("https://www.irs.gov/forms-pubs/about-form-4506-c");
      assert.equal(result.pdfUrl, "https://www.irs.gov/pub/irs-pdf/f4506c.pdf");
      assert.equal(result.revision, null);
    },
  );
});

test("resolveCurrentTemplateRevision: throws when the source page fetch fails", async () => {
  await withFetch(
    async () => fakeResponse({ ok: false, status: 403, statusText: "Forbidden" }),
    async () => {
      await assert.rejects(
        () => resolveCurrentTemplateRevision("https://www.sba.gov/document/whatever"),
        /source page fetch failed: 403/,
      );
    },
  );
});

test("resolveCurrentTemplateRevision: throws when no .pdf link is found on the page", async () => {
  await withFetch(
    async () => fakeResponse({ ok: true, text: "<html>no pdf here</html>" }),
    async () => {
      await assert.rejects(
        () => resolveCurrentTemplateRevision("https://www.sba.gov/document/whatever"),
        /could not locate a \.pdf link/,
      );
    },
  );
});

test("resolveCurrentTemplateRevision: throws when the PDF itself fails to fetch", async () => {
  await withFetch(
    async (url) => {
      if (url.endsWith(".pdf")) return fakeResponse({ ok: false, status: 404, statusText: "Not Found" });
      return fakeResponse({ ok: true, text: `<a href="https://www.sba.gov/sites/x/y.pdf">PDF</a>` });
    },
    async () => {
      await assert.rejects(
        () => resolveCurrentTemplateRevision("https://www.sba.gov/document/whatever"),
        /pdf fetch failed: 404/,
      );
    },
  );
});
