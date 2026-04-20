/**
 * Preload shim — neutralizes `import "server-only"` at module-resolve time.
 *
 * The `server-only` package throws at import in any non-Next.js context.
 * That's the right behavior for production code but it blocks probe scripts
 * that import gatekeeper/pipeline modules (which legitimately use `server-only`
 * to assert server boundary). This shim intercepts the resolver before Node
 * reads the real package's throwing module, substituting this (empty) file
 * instead.
 *
 * Usage — required via NODE_OPTIONS at the command line:
 *   NODE_OPTIONS="--require=./scripts/preload-server-only-shim.cjs" \
 *     npx tsx scripts/<some-probe>.ts
 *
 * Safety bounds: only affects the process launched with it. Does NOT change
 * production behavior, does NOT commit anywhere in the build pipeline, does
 * NOT alter the installed `server-only` package. Import-only from `scripts/`.
 */
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return __filename;
  return originalResolve.call(this, request, ...rest);
};
module.exports = {};
