#!/usr/bin/env node
/**
 * Gate Probe: Omega Event Mapping Completeness
 *
 * Verifies that every mapped Buddy signal has a corresponding omega event entry
 * and that the mirror wiring is structurally sound.
 *
 * Assertions:
 * 1. Every event in mapping.json has valid omega_event_type
 * 2. Every event has a redaction_profile that exists
 * 3. All entity_links reference valid entity types
 * 4. No duplicate omega_event_type values
 * 5. Mirror function exists and references mapping
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

console.log("\n=== Gate Probe: Omega Events ===\n");

const raw = readFileSync(resolve(ROOT, "docs/omega/mapping.json"), "utf-8");
const mapping = JSON.parse(raw);

const entityTypes = new Set(mapping.entities.map(e => e.entity_type));
const profileNames = new Set(mapping.redaction.map(r => r.profile_name));

// 1. Every event has valid structure
console.log("1) Event structure validation");
const seenOmegaTypes = new Set();

for (const evt of mapping.events) {
  const label = evt.buddy_event_type;

  if (!evt.omega_event_type) {
    notOk(`${label}: missing omega_event_type`);
  } else if (seenOmegaTypes.has(evt.omega_event_type)) {
    notOk(`${label}: duplicate omega_event_type '${evt.omega_event_type}'`);
  } else {
    seenOmegaTypes.add(evt.omega_event_type);
    ok(`${label} → ${evt.omega_event_type}`);
  }

  if (!evt.omega_write_resource) {
    notOk(`${label}: missing omega_write_resource`);
  }
}

// 2. Redaction profiles valid
console.log("\n2) Redaction profile references");
for (const evt of mapping.events) {
  if (!profileNames.has(evt.redaction_profile)) {
    notOk(`${evt.buddy_event_type}: unknown profile '${evt.redaction_profile}'`);
  } else {
    ok(`${evt.buddy_event_type}: profile '${evt.redaction_profile}' exists`);
  }
}

// 3. Entity links reference valid types
console.log("\n3) Entity link validation");
for (const evt of mapping.events) {
  for (const link of (evt.entity_links || [])) {
    if (!entityTypes.has(link.entity_type)) {
      notOk(`${evt.buddy_event_type}: entity_link '${link.entity_type}' not in entities`);
    } else {
      ok(`${evt.buddy_event_type}: link to '${link.entity_type}'`);
    }
  }
}

// 4. Mirror module references getEventMapping
console.log("\n4) Mirror module structure");
try {
  const mirrorSrc = readFileSync(resolve(ROOT, "src/lib/omega/mirrorEventToOmega.ts"), "utf-8");
  if (mirrorSrc.includes("getEventMapping")) {
    ok("Mirror uses getEventMapping (mapping-driven)");
  } else {
    notOk("Mirror does NOT use getEventMapping");
  }
  if (mirrorSrc.includes("redactPayload")) {
    ok("Mirror uses redactPayload");
  } else {
    notOk("Mirror does NOT use redactPayload");
  }
  if (mirrorSrc.includes("invokeOmega")) {
    ok("Mirror uses invokeOmega");
  } else {
    notOk("Mirror does NOT use invokeOmega");
  }
} catch (e) {
  notOk(`Cannot read mirrorEventToOmega.ts: ${e.message}`);
}

// 5. No orphaned events (every omega type has buddy prefix)
console.log("\n5) Naming convention");
for (const evt of mapping.events) {
  if (!evt.omega_event_type.startsWith("buddy.")) {
    notOk(`${evt.omega_event_type} does not start with 'buddy.' prefix`);
  } else {
    ok(`${evt.omega_event_type} follows naming convention`);
  }
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
