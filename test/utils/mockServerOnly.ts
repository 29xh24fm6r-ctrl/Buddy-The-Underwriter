import Module from "node:module";
import { join } from "node:path";

// Capture the original resolver at module load, before any patching.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const original = (Module as any)._resolveFilename;

let installed = false;

/**
 * Redirect `import "server-only"` to a repo-owned empty stub so test files
 * can require modules that include `import "server-only"` without the
 * `server-only` package's runtime guard throwing.
 *
 * Idempotent — calling more than once is a no-op. Node's --test mode shares
 * a single process across test files, so any one test calling this is enough
 * to satisfy subsequent loads in that process; we still recommend each test
 * call it explicitly to remove ordering assumptions.
 */
export function mockServerOnly(): void {
  if (installed) return;
  installed = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Module as any)._resolveFilename = function (
    request: string,
    parent: NodeModule | null,
    isMain: boolean,
    options?: object,
  ): string {
    if (request === "server-only") {
      return join(process.cwd(), "test/shims/server-only.js");
    }
    return original.call(this, request, parent, isMain, options);
  };
}
