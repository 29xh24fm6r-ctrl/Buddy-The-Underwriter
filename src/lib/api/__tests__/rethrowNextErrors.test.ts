import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * rethrowNextErrors — regression tests
 *
 * Tests the digest-based detection of Next.js framework errors
 * that must never be swallowed by API route catch blocks.
 */

// Import the actual function (pure, no side effects)
import { rethrowNextErrors } from "../rethrowNextErrors";

describe("rethrowNextErrors", () => {
  it("re-throws errors with NEXT_REDIRECT digest", () => {
    const redirectError = new Error("NEXT_REDIRECT");
    (redirectError as any).digest = "NEXT_REDIRECT;replace;/deals;307;";

    assert.throws(
      () => rethrowNextErrors(redirectError),
      (err: any) => err === redirectError,
      "must re-throw the exact redirect error",
    );
  });

  it("re-throws errors with NEXT_NOT_FOUND digest", () => {
    const notFoundError = new Error("NEXT_NOT_FOUND");
    (notFoundError as any).digest = "NEXT_NOT_FOUND";

    assert.throws(
      () => rethrowNextErrors(notFoundError),
      (err: any) => err === notFoundError,
      "must re-throw the exact notFound error",
    );
  });

  it("passes through regular errors (no re-throw)", () => {
    const regularError = new Error("something went wrong");
    // Should NOT throw
    rethrowNextErrors(regularError);
  });

  it("passes through errors with non-framework digest", () => {
    const customError = new Error("custom");
    (customError as any).digest = "CUSTOM_ERROR_CODE";
    // Should NOT throw
    rethrowNextErrors(customError);
  });

  it("passes through null/undefined", () => {
    rethrowNextErrors(null);
    rethrowNextErrors(undefined);
  });

  it("passes through non-Error objects", () => {
    rethrowNextErrors("string error");
    rethrowNextErrors(42);
    rethrowNextErrors({ message: "object error" });
  });

  it("handles objects with digest property that aren't Error instances", () => {
    const objWithDigest = { digest: "NEXT_REDIRECT;replace;/deals;307;" };
    assert.throws(
      () => rethrowNextErrors(objWithDigest),
      (err: any) => err === objWithDigest,
      "must re-throw objects with NEXT_REDIRECT digest even if not Error instances",
    );
  });

  it("does not import from next/dist internals (source check)", () => {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const source = readFileSync(
      resolve(__dirname, "../rethrowNextErrors.ts"),
      "utf-8",
    );

    assert.ok(
      !source.includes("next/dist"),
      "must NOT import from next/dist internals — use digest-based detection only",
    );
  });
});
