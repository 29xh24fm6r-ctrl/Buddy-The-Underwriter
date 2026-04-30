// Repo-owned stub for the `server-only` package, used in test contexts.
// Returned by test/utils/mockServerOnly.ts when patching Module._resolveFilename.
// Not relying on node_modules/server-only/empty.js avoids CI/install-layout
// fragility; this file is guaranteed to exist because the repo owns it.
module.exports = {};
