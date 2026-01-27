#!/usr/bin/env node
/**
 * Gate Probe: Omega MCP Connected Wiring
 *
 * Verifies that the real MCP transport, Buddy MCP server, resource handlers,
 * and tool handlers are structurally wired correctly.
 *
 * Assertions:
 * 1. invokeOmega uses real HTTP JSON-RPC transport (no stub)
 * 2. Buddy MCP server module exists with dispatcher + auth
 * 3. Buddy MCP API route exists at /api/mcp
 * 4. All 4 resource handlers exported from resources.ts
 * 5. All 3 tool handlers exported from tools.ts
 * 6. JSON-RPC protocol elements present (jsonrpc, id, method, params)
 * 7. Auth validation function exported
 * 8. Environment variables referenced (OMEGA_MCP_URL, OMEGA_MCP_API_KEY, BUDDY_MCP_API_KEY)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let pass = 0;
let fail = 0;

function ok(msg) { pass++; console.log(`  PASS: ${msg}`); }
function notOk(msg) { fail++; console.error(`  FAIL: ${msg}`); }

console.log("\n=== Gate Probe: Omega Connected ===\n");

// 1. invokeOmega has real transport
console.log("1) Real MCP transport");
try {
  const src = readFileSync(resolve(ROOT, "src/lib/omega/invokeOmega.ts"), "utf-8");

  if (src.includes("OMEGA_MCP_URL")) {
    ok("invokeOmega references OMEGA_MCP_URL");
  } else {
    notOk("invokeOmega missing OMEGA_MCP_URL reference");
  }

  if (src.includes("OMEGA_MCP_API_KEY")) {
    ok("invokeOmega references OMEGA_MCP_API_KEY");
  } else {
    notOk("invokeOmega missing OMEGA_MCP_API_KEY reference");
  }

  if (src.includes("jsonrpc") && src.includes('"2.0"')) {
    ok("invokeOmega uses JSON-RPC 2.0 protocol");
  } else {
    notOk("invokeOmega missing JSON-RPC 2.0 protocol elements");
  }

  if (src.includes("fetch(baseUrl")) {
    ok("invokeOmega uses fetch() for HTTP transport");
  } else {
    notOk("invokeOmega missing fetch() transport");
  }

  if (src.includes("Bearer")) {
    ok("invokeOmega sends Bearer token auth");
  } else {
    notOk("invokeOmega missing Bearer auth");
  }

  // Verify stub is removed
  if (!src.includes("omega_not_connected: ${resource}")) {
    ok("Old stub throw removed");
  } else {
    notOk("Old stub 'omega_not_connected: ${resource}' still present");
  }

  // Verify JSON-RPC error handling
  if (src.includes("omega_rpc_error")) {
    ok("Handles JSON-RPC error responses");
  } else {
    notOk("Missing JSON-RPC error handling");
  }

  if (src.includes("omega_http_")) {
    ok("Handles HTTP error responses");
  } else {
    notOk("Missing HTTP error handling");
  }

  // Verify existing invariants preserved
  if (src.includes("isOmegaKilled") && src.includes("isOmegaEnabled")) {
    ok("Kill switch and enabled check preserved");
  } else {
    notOk("Kill switch or enabled check missing");
  }

  if (src.includes("safeWithTimeout")) {
    ok("Timeout wrapper preserved");
  } else {
    notOk("Timeout wrapper missing");
  }

  if (src.includes("ok: true") && src.includes("ok: false")) {
    ok("Never-throw sealed result pattern preserved");
  } else {
    notOk("Sealed result pattern missing");
  }
} catch (e) {
  notOk(`Cannot read invokeOmega.ts: ${e.message}`);
}

// 2. Buddy MCP server module
console.log("\n2) Buddy MCP server module");
try {
  const serverSrc = readFileSync(resolve(ROOT, "src/lib/mcp/server.ts"), "utf-8");

  if (serverSrc.includes("dispatchMcpRequest")) {
    ok("dispatchMcpRequest function exists");
  } else {
    notOk("dispatchMcpRequest function missing");
  }

  if (serverSrc.includes("validateMcpAuth")) {
    ok("validateMcpAuth function exists");
  } else {
    notOk("validateMcpAuth function missing");
  }

  if (serverSrc.includes("parseJsonRpcBody")) {
    ok("parseJsonRpcBody function exists");
  } else {
    notOk("parseJsonRpcBody function missing");
  }

  if (serverSrc.includes("BUDDY_MCP_API_KEY")) {
    ok("Server uses BUDDY_MCP_API_KEY for auth");
  } else {
    notOk("Server missing BUDDY_MCP_API_KEY auth");
  }

  if (serverSrc.includes("parseMethod")) {
    ok("URI parsing function exists");
  } else {
    notOk("URI parsing function missing");
  }

  // Verify all resource routes
  const resourceRoutes = [
    "buddy://case/",
    "buddy://workflows/recent",
    "buddy://tools/",
  ];
  for (const route of resourceRoutes) {
    if (serverSrc.includes(route)) {
      ok(`Route pattern '${route}' mapped`);
    } else {
      notOk(`Route pattern '${route}' NOT mapped`);
    }
  }
} catch (e) {
  notOk(`Cannot read server.ts: ${e.message}`);
}

// 3. Buddy MCP API route
console.log("\n3) API route");
try {
  const routeSrc = readFileSync(resolve(ROOT, "src/app/api/mcp/route.ts"), "utf-8");

  if (routeSrc.includes("POST")) {
    ok("POST handler exists in /api/mcp/route.ts");
  } else {
    notOk("POST handler missing");
  }

  if (routeSrc.includes("validateMcpAuth")) {
    ok("Route calls validateMcpAuth");
  } else {
    notOk("Route missing auth check");
  }

  if (routeSrc.includes("dispatchMcpRequest")) {
    ok("Route calls dispatchMcpRequest");
  } else {
    notOk("Route missing dispatch call");
  }

  if (routeSrc.includes("bankId")) {
    ok("Route extracts bankId for tenant isolation");
  } else {
    notOk("Route missing bankId tenant isolation");
  }

  if (routeSrc.includes('force-dynamic')) {
    ok("Route is force-dynamic");
  } else {
    notOk("Route missing force-dynamic");
  }
} catch (e) {
  notOk(`Cannot read mcp/route.ts: ${e.message}`);
}

// 4. Resource handlers
console.log("\n4) Resource handlers");
try {
  const resSrc = readFileSync(resolve(ROOT, "src/lib/mcp/resources.ts"), "utf-8");

  const handlers = [
    "handleCaseResource",
    "handleCaseDocumentsResource",
    "handleCaseSignalsResource",
    "handleWorkflowsRecentResource",
  ];

  for (const h of handlers) {
    if (resSrc.includes(`export async function ${h}`)) {
      ok(`${h} exported`);
    } else {
      notOk(`${h} NOT exported`);
    }
  }

  if (resSrc.includes("supabaseAdmin")) {
    ok("Resources use supabaseAdmin for queries");
  } else {
    notOk("Resources missing supabaseAdmin");
  }

  if (resSrc.includes("maskEin")) {
    ok("Resources apply EIN masking");
  } else {
    notOk("Resources missing EIN masking");
  }

  if (resSrc.includes("bank_id")) {
    ok("Resources filter by bank_id (tenant isolation)");
  } else {
    notOk("Resources missing bank_id filter");
  }
} catch (e) {
  notOk(`Cannot read resources.ts: ${e.message}`);
}

// 5. Tool handlers
console.log("\n5) Tool handlers");
try {
  const toolSrc = readFileSync(resolve(ROOT, "src/lib/mcp/tools.ts"), "utf-8");

  const tools = [
    "handleReplayCase",
    "handleValidateCase",
    "handleGenerateMissingDocsEmail",
  ];

  for (const t of tools) {
    if (toolSrc.includes(`export async function ${t}`)) {
      ok(`${t} exported`);
    } else {
      notOk(`${t} NOT exported`);
    }
  }

  if (toolSrc.includes("mirrorEventToOmega")) {
    ok("Replay tool uses mirrorEventToOmega");
  } else {
    notOk("Replay tool missing mirrorEventToOmega");
  }

  if (toolSrc.includes("bank_id")) {
    ok("Tools filter by bank_id (tenant isolation)");
  } else {
    notOk("Tools missing bank_id filter");
  }
} catch (e) {
  notOk(`Cannot read tools.ts: ${e.message}`);
}

// 6. Cross-module wiring
console.log("\n6) Cross-module wiring");
try {
  const serverSrc = readFileSync(resolve(ROOT, "src/lib/mcp/server.ts"), "utf-8");

  if (serverSrc.includes("./resources") && serverSrc.includes("./tools")) {
    ok("Server imports both resources and tools");
  } else {
    notOk("Server missing resource or tool imports");
  }

  const routeSrc = readFileSync(resolve(ROOT, "src/app/api/mcp/route.ts"), "utf-8");
  if (routeSrc.includes("@/lib/mcp/server")) {
    ok("API route imports from @/lib/mcp/server");
  } else {
    notOk("API route missing @/lib/mcp/server import");
  }
} catch (e) {
  notOk(`Cross-module wiring check failed: ${e.message}`);
}

// Summary
console.log("\n=== Summary ===\n");
if (fail > 0) {
  console.error(`FAILED: ${fail} check(s) failed, ${pass} passed.`);
  process.exit(1);
} else {
  console.log(`PASSED: All ${pass} checks passed.`);
  process.exit(0);
}
